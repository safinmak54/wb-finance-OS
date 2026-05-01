/**
 * Hand-written Database types.
 *
 * These mirror the live Supabase schema as understood from
 * legacy/app.js usage and legacy/seed.sql. Replace this file with the
 * output of `supabase gen types typescript --project-id …` once CLI
 * access is available — the API surface should match.
 *
 * Convention: Row / Insert / Update follow the Supabase generator. We
 * include only columns the app touches; unknown columns are tolerated
 * via `Record<string, unknown>` casts at the call site.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Direction = "DEBIT" | "CREDIT";
export type RawTxnStatus = "review" | "confirmed" | "ignored";
export type JournalStatus = "POSTED" | "draft";
export type InvoiceStatus = "open" | "partial" | "paid" | "overdue";
export type RoleName = "coo" | "bookkeeper" | "cpa" | "admin";

// ---------- table rows ----------

export type Entity = {
  id: string;
  code: string;
  name: string;
  entity_type: string | null;
  is_active: boolean;
}

export type Account = {
  id: string;
  account_code: string;
  account_name: string;
  account_type: "asset" | "liability" | "equity" | "revenue" | "expense";
  account_subtype: string | null;
  normal_balance: "DEBIT" | "CREDIT";
  line: string | null;
  is_elimination: boolean;
  is_active: boolean;
}

export type Vendor = {
  id: string;
  name: string;
  ytd_spend: number | null;
  open_invoices: number | null;
  overdue_count: number | null;
  last_payment: string | null;
  status: string | null;
  is_active: boolean;
}

export type Invoice = {
  id: string;
  vendor_id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  amount_paid: number | null;
  status: InvoiceStatus | string;
}

/** Bank/CC statement side. Pre-classification. */
export type RawTransaction = {
  id: string;
  entity_id: string | null;
  source: string;
  external_id: string | null;
  transaction_date: string;
  accounting_date: string | null;
  amount: number;
  direction: Direction;
  description: string | null;
  vendor: string | null;
  txn_type: string | null;
  category: string | null;
  status: string | null;
  classified: boolean;
  classified_at: string | null;
}

/** Book side — posted to the ledger / P&L. */
export type Transaction = {
  id: string;
  raw_transaction_id: string | null;
  entity: string;
  account_id: string | null;
  amount: number;
  txn_date: string;
  acc_date: string;
  description: string | null;
  memo: string | null;
}

export type JournalEntry = {
  id: string;
  entity: string | null;
  entity_id: string | null;
  transaction_date: string | null;
  accounting_date: string;
  description: string;
  entry_type: string;
  period: string | null;
  source: string | null;
  status: JournalStatus | string;
  is_intercompany: boolean | null;
}

export type LedgerEntry = {
  id: string;
  journal_entry_id: string;
  account_id: string;
  entity: string | null;
  entity_id: string | null;
  debit_amount: number;
  credit_amount: number;
  memo: string | null;
}

export type ClassificationRule = {
  id: string;
  pattern: string;
  account_id: string | null;
  vendor_id: string | null;
  is_active: boolean;
  created_at: string;
}

export type ClosedPeriod = {
  id: string;
  period: string;
  entity: string | null;
  closed_at: string;
}

export type CashBalance = {
  entity: string;
  col_key: string;
  value: number | null;
  updated_at: string;
}

export type ReconciliationMatch = {
  id: string;
  statement_txn_id: string;
  book_txn_id: string;
  match_status: string;
  amount: number;
}

export type ApItem = {
  id: string;
  vendor: string;
  entity: string | null;
  invoice_date: string | null;
  due_date: string;
  amount: number;
  paid: boolean;
  dispute_note: string | null;
  created_at: string | null;
}

export type Profile = {
  user_id: string;
  role: RoleName | null;
  email: string | null;
  display_name: string | null;
}

export type CfoNote = {
  id: string;
  period: string;
  entity: string | null;
  content: string;
  created_at: string;
  updated_at: string | null;
}

export type BankConnection = {
  id: string;
  institution: string;
  entity: string | null;
  account_number: string | null;
  current_balance: number | null;
  last_synced: string | null;
  status: string | null;
}

/** Append-only audit trail. Phase E. */
export type AuditLogRow = {
  id: string;
  actor_user_id: string | null;
  table_name: string;
  row_id: string | null;
  op: "INSERT" | "UPDATE" | "DELETE";
  before: Json | null;
  after: Json | null;
  at: string;
}

// ---------- Database shape (subset of supabase-generated `Database`) ----------

type TableShape<R, I = Partial<R>, U = Partial<R>> = {
  Row: R;
  Insert: I;
  Update: U;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      entities: TableShape<Entity>;
      accounts: TableShape<Account>;
      vendors: TableShape<Vendor>;
      invoices: TableShape<Invoice>;
      raw_transactions: TableShape<RawTransaction>;
      transactions: TableShape<Transaction>;
      journal_entries: TableShape<JournalEntry>;
      ledger_entries: TableShape<LedgerEntry>;
      classification_rules: TableShape<ClassificationRule>;
      closed_periods: TableShape<ClosedPeriod>;
      cash_balances: TableShape<CashBalance>;
      reconciliation_matches: TableShape<ReconciliationMatch>;
      ap_items: TableShape<ApItem>;
      profiles: TableShape<Profile>;
      cfo_notes: TableShape<CfoNote>;
      bank_connections: TableShape<BankConnection>;
      audit_log: TableShape<AuditLogRow>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export type TableName = keyof Database["public"]["Tables"];
export type Row<T extends TableName> = Database["public"]["Tables"][T]["Row"];
export type Insert<T extends TableName> = Database["public"]["Tables"][T]["Insert"];
export type Update<T extends TableName> = Database["public"]["Tables"][T]["Update"];
