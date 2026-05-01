import "server-only";
import Papa from "papaparse";
import ExcelJS from "exceljs";

export type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

/** Parse a CSV/XLSX file (Buffer) into headers + rows. */
export async function parseSpreadsheet(
  filename: string,
  data: Buffer,
): Promise<ParsedSheet> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    return parseCsv(data);
  }
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    return parseXlsx(data);
  }
  // Fall back to CSV
  return parseCsv(data);
}

function parseCsv(data: Buffer): ParsedSheet {
  const text = data.toString("utf8");
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: true,
  });
  const matrix = (result.data as string[][]).filter(
    (row) => row && row.some((c) => String(c ?? "").trim() !== ""),
  );
  if (matrix.length === 0) return { headers: [], rows: [] };

  const headerIdx = pickHeaderRow(matrix);
  const headers = matrix[headerIdx].map((c) => String(c ?? "").trim());
  const rows = matrix.slice(headerIdx + 1).map((r) =>
    r.slice(0, headers.length).map((c) => String(c ?? "")),
  );
  return { headers, rows };
}

async function parseXlsx(data: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
  );
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      if (v == null) cells.push("");
      else if (typeof v === "object" && "text" in v) cells.push(String(v.text));
      else if (typeof v === "object" && "result" in v) cells.push(String(v.result));
      else if (v instanceof Date) cells.push(v.toISOString().slice(0, 10));
      else cells.push(String(v));
    });
    matrix.push(cells);
  });

  if (matrix.length === 0) return { headers: [], rows: [] };
  const headerIdx = pickHeaderRow(matrix);
  const headers = matrix[headerIdx].map((c) => c.trim());
  const rows = matrix.slice(headerIdx + 1).map((r) =>
    r.slice(0, headers.length).map((c) => String(c ?? "")),
  );
  return { headers, rows };
}

/**
 * Bank/CC statement files often have a few preamble rows before the
 * actual header. Score each candidate row by how many "expected"
 * column words it contains, return the best.
 */
function pickHeaderRow(matrix: string[][]): number {
  const keywords = [
    "date",
    "amount",
    "description",
    "vendor",
    "memo",
    "type",
    "credit",
    "debit",
    "balance",
  ];
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(10, matrix.length); i++) {
    const row = matrix[i].map((c) => c.toLowerCase());
    const score = keywords.reduce(
      (s, kw) => (row.some((c) => c.includes(kw)) ? s + 1 : s),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * Smart detection of which header columns map to which fields. Returns
 * the index in `headers` for each known field, or -1 if not found.
 */
export function detectColumns(headers: string[]): {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  vendor: number;
  type: number;
} {
  const lower = headers.map((h) => h.toLowerCase());
  const find = (...keys: string[]) =>
    lower.findIndex((h) => keys.some((k) => h.includes(k)));
  return {
    date: find("date", "posted"),
    description: find("description", "memo", "narrative", "details"),
    amount: find("amount"),
    debit: find("debit", "withdrawal"),
    credit: find("credit", "deposit"),
    vendor: find("vendor", "payee", "merchant"),
    type: find("type"),
  };
}
