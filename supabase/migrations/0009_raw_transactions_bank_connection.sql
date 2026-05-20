-- Link raw_transactions to the specific bank_connection they came from
-- so the Bank Transactions inbox can be filtered by a single account
-- (e.g. "Chase …1234") and not just by entity or source type.
--
-- Nullable: existing rows imported before this column existed remain
-- untagged. New imports populate it from the bank-account picker in
-- the upload modal.
--
-- The bank_connections table exists in production (created by the
-- legacy app) but the baseline migration 0001 is a placeholder, so we
-- create it here defensively for environments that don't have it yet.
-- Shape matches the BankConnection type in lib/supabase/types.ts.

CREATE TABLE IF NOT EXISTS bank_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution text NOT NULL,
  entity text,
  account_number text,
  current_balance numeric,
  last_synced timestamptz,
  status text
);

ALTER TABLE raw_transactions
  ADD COLUMN IF NOT EXISTS bank_connection_id uuid
    REFERENCES bank_connections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS raw_transactions_bank_connection_idx
  ON raw_transactions (bank_connection_id);
