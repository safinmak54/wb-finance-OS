-- ============================================================
-- 0020_chart_of_accounts_v2.sql
-- Creates the Chart of Accounts defined in the finance spec
-- (§4.2 Income Statement, 35 accounts; §4.3 Balance Sheet,
-- 35 accounts). "Create, and replace if it already exists."
--
-- Each row is UPSERTed on the unique `account_code`:
--   - if the code is new, the row is inserted;
--   - if the code already exists, its name/type/subtype/normal
--     balance are overwritten and it is re-activated, while the
--     row's UUID is preserved (so any transactions / ledger
--     entries / journal lines already linked to it stay linked).
--
-- account_subtype uses the snake_case vocabulary already in the
-- codebase (see lib/pnl/structure.ts). Income-statement subtypes:
--   gross_revenue, sales_return, platform_fee, sales_tax, cogs,
--   marketing, labour, opex.
-- Balance-sheet subtypes:
--   cash, accounts_receivable, ar_intercompany, inventory,
--   prepaid, ap_salaries, ap_intercompany, ap_other, ap_cogs,
--   ap_marketing, ap_sales_tax, owner_equity.
--
-- NOTE (data hazard): codes 6001/6002/6003 currently exist as
-- Meta Ads / Bing Ads / ASI Ads (marketing), and 6004 as Sage Ads
-- (marketing). This spec reuses those same codes for Wages /
-- Contractor / Payroll Tax / Contractor-Other (Overseas), so the
-- UPSERT repurposes those exact rows — any historical marketing
-- transactions on them will then read as compensation. In this
-- spec the ad accounts move to the 50xx range (Meta 5012, Bing
-- 5013, ASI folded into 5015 "ASI/Sage Ads"), so the old 6001-6004
-- ad rows should be migrated/deactivated, not silently overwritten.
-- Confirm with finance before applying.
--
-- NOTE (reporting): the P&L (lib/pnl/structure.ts) and Balance
-- Sheet (lib/balance/structure.ts) map accounts to report sections
-- by hardcoded account_code lists on the OLD numbering. Creating
-- these accounts does NOT make them appear correctly in those
-- reports — the two code→section maps must be updated to the new
-- numbers as a follow-up.
-- ============================================================

-- ---- §4.2 Income Statement (35 accounts) ----
insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  -- Gross Revenue
  ('4001', 'Gross Revenue - Stripe',       'revenue', 'gross_revenue', 'CREDIT'),
  ('4002', 'Gross Revenue - PayPal',       'revenue', 'gross_revenue', 'CREDIT'),
  ('4003', 'Gross Revenue - Direct',       'revenue', 'gross_revenue', 'CREDIT'),
  -- Sales Returns (contra-revenue, debit-normal)
  ('4011', 'Sales Return - Stripe',        'revenue', 'sales_return',  'DEBIT'),
  ('4012', 'Sales Return - Paypal',        'revenue', 'sales_return',  'DEBIT'),
  ('4013', 'Sales Return - Direct',        'revenue', 'sales_return',  'DEBIT'),
  -- Platform Fees (contra-revenue, debit-normal)
  ('4021', 'Platform Fee - Stripe',        'revenue', 'platform_fee',  'DEBIT'),
  ('4022', 'Platform Fee - PayPal',        'revenue', 'platform_fee',  'DEBIT'),
  ('4023', 'Platform Fee - Other',         'revenue', 'platform_fee',  'DEBIT'),
  -- Sales Tax (contra-revenue, debit-normal)
  ('4031', 'Sales Tax',                    'revenue', 'sales_tax',     'DEBIT'),
  -- COGS
  ('5001', 'COGS - WB+SP',                 'expense', 'cogs',          'DEBIT'),
  ('5002', 'COGS - RP',                    'expense', 'cogs',          'DEBIT'),
  -- Marketing
  ('5011', 'Google Ads',                   'expense', 'marketing',     'DEBIT'),
  ('5012', 'Meta Ads',                     'expense', 'marketing',     'DEBIT'),
  ('5013', 'Bing Ads',                     'expense', 'marketing',     'DEBIT'),
  ('5015', 'ASI/Sage Ads',                 'expense', 'marketing',     'DEBIT'),
  ('5016', 'MTNT/Amazon Ads',              'expense', 'marketing',     'DEBIT'),
  ('5017', 'Ad Agency Fee',                'expense', 'marketing',     'DEBIT'),
  -- Compensation
  ('6001', 'Wages — W2',                   'expense', 'labour',        'DEBIT'),
  ('6002', 'Contractor — 1099',            'expense', 'labour',        'DEBIT'),
  ('6003', 'Payroll Tax Expense',          'expense', 'labour',        'DEBIT'),
  ('6004', 'Contractor- Other (Overseas)', 'expense', 'labour',        'DEBIT'),
  -- Other Operating Expense
  ('7001', 'Rent expense',                 'expense', 'opex',          'DEBIT'),
  ('7002', 'Utilities',                    'expense', 'opex',          'DEBIT'),
  ('7003', 'Office supplies',              'expense', 'opex',          'DEBIT'),
  ('7004', 'Repairs and maintenance',      'expense', 'opex',          'DEBIT'),
  ('7005', 'Telephone and internet',       'expense', 'opex',          'DEBIT'),
  ('7006', 'Mis Exp',                      'expense', 'opex',          'DEBIT'),
  ('7007', 'Computers and Software',       'expense', 'opex',          'DEBIT'),
  ('7008', 'Subscriptions',                'expense', 'opex',          'DEBIT'),
  ('7009', 'Domain Fee',                   'expense', 'opex',          'DEBIT'),
  ('7010', 'Contractor- Other (Upwork)',   'expense', 'opex',          'DEBIT'),
  ('7011', 'Professional Fee',             'expense', 'opex',          'DEBIT'),
  ('7012', 'Bank fees',                    'expense', 'opex',          'DEBIT'),
  ('7013', 'Management Fee - One Ops',     'expense', 'opex',          'DEBIT')
on conflict (account_code) do update set
  account_name    = excluded.account_name,
  account_type    = excluded.account_type,
  account_subtype = excluded.account_subtype,
  normal_balance  = excluded.normal_balance,
  is_active       = true;

-- ---- §4.3 Balance Sheet (35 accounts) ----
insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  -- Cash
  ('1001', 'Cash — LP checking',             'asset',     'cash',                'DEBIT'),
  ('1002', 'Cash — KP checking',             'asset',     'cash',                'DEBIT'),
  ('1003', 'Cash — BP checking',             'asset',     'cash',                'DEBIT'),
  ('1004', 'Cash — WBP checking',            'asset',     'cash',                'DEBIT'),
  ('1005', 'Cash — SP checking',             'asset',     'cash',                'DEBIT'),
  ('1006', 'Cash — One Ops checking',        'asset',     'cash',                'DEBIT'),
  ('1007', 'Cash — WB Brands checking',      'asset',     'cash',                'DEBIT'),
  -- Accounts Receivable (processor clearing)
  ('1011', 'AR-Stripe Clearing',             'asset',     'accounts_receivable', 'DEBIT'),
  ('1012', 'AR-Paypal Clearing',             'asset',     'accounts_receivable', 'DEBIT'),
  ('1013', 'AR-Wires/Checks Clearing',       'asset',     'accounts_receivable', 'DEBIT'),
  ('1014', 'AR- Pay Later',                  'asset',     'accounts_receivable', 'DEBIT'),
  -- Intercompany receivable
  ('1021', 'Account Receivable - I/C',       'asset',     'ar_intercompany',     'DEBIT'),
  -- Inventory / Prepaid
  ('1031', 'Inventory',                      'asset',     'inventory',           'DEBIT'),
  ('1041', 'Prepaid expenses',               'asset',     'prepaid',             'DEBIT'),
  -- Accounts Payable — Salaries (clearing)
  ('2001', 'AP Salaries Clearing',           'liability', 'ap_salaries',         'CREDIT'),
  ('2002', 'AP-Tax Withholding - Clearing',  'liability', 'ap_salaries',         'CREDIT'),
  ('2003', 'AP-Medicare & SS Clearing',      'liability', 'ap_salaries',         'CREDIT'),
  ('2004', 'AP-SUTA & FUTA Clearing',        'liability', 'ap_salaries',         'CREDIT'),
  -- Intercompany payable
  ('2011', 'Accounts Payable - I/C',         'liability', 'ap_intercompany',     'CREDIT'),
  -- Accounts Payable — Others (credit cards)
  ('2021', 'Credit card payable — LP',       'liability', 'ap_other',            'CREDIT'),
  ('2022', 'Credit card payable — KP',       'liability', 'ap_other',            'CREDIT'),
  ('2023', 'Credit card payable — BP',       'liability', 'ap_other',            'CREDIT'),
  ('2024', 'Credit card payable — One Ops',  'liability', 'ap_other',            'CREDIT'),
  -- Accounts Payable — COGS (clearing)
  ('2031', 'AP-COGS Clearing',               'liability', 'ap_cogs',             'CREDIT'),
  ('2032', 'AP- Shipping Clearing',          'liability', 'ap_cogs',             'CREDIT'),
  ('2033', 'AP-Tariff Clearing',             'liability', 'ap_cogs',             'CREDIT'),
  -- Accounts Payable — Marketing (clearing)
  ('2041', 'AP-Google Ads Clearing',         'liability', 'ap_marketing',        'CREDIT'),
  ('2042', 'AP-Meta Ads Clearing',           'liability', 'ap_marketing',        'CREDIT'),
  ('2043', 'AP-Bing Ads Clearing',           'liability', 'ap_marketing',        'CREDIT'),
  ('2044', 'AP-ASI/Sage Clearing',           'liability', 'ap_marketing',        'CREDIT'),
  ('2045', 'AP-MNTN/Amazon Clearing',        'liability', 'ap_marketing',        'CREDIT'),
  -- Accounts Payable — Sales Tax
  ('2046', 'Accounts Payable - Sales Tax',   'liability', 'ap_sales_tax',        'CREDIT'),
  -- Owner's Equity
  ('3001', 'Retained earnings',              'equity',    'owner_equity',        'CREDIT'),
  ('3002', 'Net Income',                     'equity',    'owner_equity',        'CREDIT'),
  ('3003', 'Owners Distribution',            'equity',    'owner_equity',        'DEBIT')
on conflict (account_code) do update set
  account_name    = excluded.account_name,
  account_type    = excluded.account_type,
  account_subtype = excluded.account_subtype,
  normal_balance  = excluded.normal_balance,
  is_active       = true;
