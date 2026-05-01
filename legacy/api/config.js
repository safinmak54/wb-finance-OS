// Returns Supabase config from server-side environment variables
// Keys never appear in client-side source code
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return res.status(500).json({ error: 'Supabase not configured in Vercel env vars' });
  }

  return res.json({ url, key });
}
