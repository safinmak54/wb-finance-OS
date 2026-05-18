-- Manual P&L overrides for accounts the Admin API doesn't source.
--
-- One row per (account_id, entity_code, month). Upserts replace the
-- previous amount for that key. Read by app/(app)/pnl/page.tsx alongside
-- cashbook_snapshots and merged into the same AccountAggregate map.

CREATE TABLE IF NOT EXISTS pnl_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_code text NOT NULL,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  amount numeric(14, 2) NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, entity_code, month)
);

CREATE INDEX IF NOT EXISTS pnl_manual_entries_month_idx
  ON pnl_manual_entries (month);
CREATE INDEX IF NOT EXISTS pnl_manual_entries_account_idx
  ON pnl_manual_entries (account_id);

-- RLS is enabled project-wide in 0002. Match the same authenticated-only
-- read/write policy used for accounts/journal_entries until a finer policy
-- is needed.
ALTER TABLE pnl_manual_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY pnl_manual_entries_read
  ON pnl_manual_entries
  FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY pnl_manual_entries_write
  ON pnl_manual_entries
  FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
