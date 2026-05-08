-- ============================================================
-- 0006_admin_api_accounts.sql
-- Adds every Chart of Accounts entry the SwagPrint Admin API
-- integration needs to post journal entries. Inserts are
-- idempotent (`on conflict (account_code) do nothing`), so
-- this is safe to re-run on an environment where some of the
-- accounts already exist.
--
-- Code map (one global account per concept; entity scoping
-- happens via journal_entries.entity_id and ledger_entries.entity_id):
--
-- Counterparties / clearing:
--   1100 — Accounts receivable             (asset, current,     DR-normal)
--   1140 — Stripe clearing                 (asset, current,     DR-normal)
--   1150 — PayPal clearing                 (asset, current,     DR-normal)
--   2010 — Accounts payable                (liability, current, CR-normal)
--
-- Revenue (credited):
--   4010 — Gross revenue — Stripe          (revenue, revenue,   CR-normal)
--   4020 — Gross revenue — PayPal          (revenue, revenue,   CR-normal)
--   4030 — Gross revenue — Wire/Check      (revenue, revenue,   CR-normal)
--   4900 — Returns and cancellations       (revenue, contra,    DR-normal)
--
-- Expenses (debited):
--   5010 — Cost of goods sold              (expense, cogs,        DR-normal)
--   6010 — Google Ads                      (expense, advertising, DR-normal)
--   6020 — Meta Ads                        (expense, advertising, DR-normal)
--   6040 — Bing Ads                        (expense, advertising, DR-normal)
--   6050 — ASI Ads                         (expense, advertising, DR-normal)
--
-- Note: only the core columns are set (`account_code`,
-- `account_name`, `account_type`, `account_subtype`,
-- `normal_balance`). Whatever defaults the live schema has on
-- columns the legacy seed used (`line`, `is_active`, etc.) will
-- apply if they exist.
-- ============================================================

insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  ('1100', 'Accounts receivable',         'asset',     'current',     'DEBIT'),
  ('1140', 'Stripe clearing',             'asset',     'current',     'DEBIT'),
  ('1150', 'PayPal clearing',             'asset',     'current',     'DEBIT'),
  ('2010', 'Accounts payable',            'liability', 'current',     'CREDIT'),
  ('4010', 'Gross revenue — Stripe',      'revenue',   'revenue',     'CREDIT'),
  ('4020', 'Gross revenue — PayPal',      'revenue',   'revenue',     'CREDIT'),
  ('4030', 'Gross revenue — Wire/Check',  'revenue',   'revenue',     'CREDIT'),
  ('4900', 'Returns and cancellations',   'revenue',   'contra',      'DEBIT'),
  ('5010', 'Cost of goods sold',          'expense',   'cogs',        'DEBIT'),
  ('6010', 'Google Ads',                  'expense',   'advertising', 'DEBIT'),
  ('6020', 'Meta Ads',                    'expense',   'advertising', 'DEBIT'),
  ('6040', 'Bing Ads',                    'expense',   'advertising', 'DEBIT'),
  ('6050', 'ASI Ads',                     'expense',   'advertising', 'DEBIT')
on conflict (account_code) do nothing;
