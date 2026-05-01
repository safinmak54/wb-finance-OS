// Vercel serverless function — proxies all Supabase REST API requests
// Supabase URL and key are stored in Vercel environment variables, never exposed to the client

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Table, X-Select, X-Filter, X-Order, X-Prefer, X-Count');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  try {
    const table = req.headers['x-table'] || req.query.table;
    if (!table) return res.status(400).json({ error: 'Missing table name' });

    // Build the Supabase REST URL
    let url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`;

    // Forward query string (filters, selects, ordering)
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== 'table') params.append(key, value);
    }
    const qs = params.toString();
    if (qs) url += '?' + qs;

    // Build headers for Supabase
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    };

    // Forward Prefer header (for upserts, count, etc.)
    if (req.headers['x-prefer']) headers['Prefer'] = req.headers['x-prefer'];
    if (req.headers['x-select']) url += (url.includes('?') ? '&' : '?') + 'select=' + encodeURIComponent(req.headers['x-select']);

    const fetchOpts = {
      method: req.method,
      headers,
    };

    // Forward body for POST/PATCH/DELETE
    if (req.method !== 'GET' && req.body) {
      fetchOpts.body = JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOpts);
    const contentType = response.headers.get('content-type') || '';

    // Forward response
    res.status(response.status);

    // Forward content-range header (for count queries)
    const contentRange = response.headers.get('content-range');
    if (contentRange) res.setHeader('content-range', contentRange);

    if (contentType.includes('json')) {
      const data = await response.json();
      return res.json(data);
    } else {
      const text = await response.text();
      return res.send(text);
    }
  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
