-- ============================================================
-- 0007_pnl_account_structure.sql
-- Aligns the Chart of Accounts to the finance team's P&L
-- spreadsheet exactly.
--
-- Recognised account_subtype values:
--   gross_revenue, sales_return, platform_fee, cogs, sales_tax,
--   marketing, labour, opex, distribution.
--
-- Existing accounts are re-coded in place (UPDATE keeps each row's
-- UUID so historical transactions stay linked). New rows are
-- inserted idempotently via `on conflict (account_code) do nothing`.
-- ============================================================

-- ---- 1) Re-code + relabel existing accounts to match the spreadsheet ----
--
-- Each rename is guarded with `and not exists (... target code)` so the
-- migration is safe to re-run after a partial apply: if the target code
-- already exists, the rename is skipped and the existing target row is
-- left alone.

-- Gross Revenue: 4010/4020/4030 → 4040/4050/4060
update public.accounts set
  account_code = '4040',
  account_name = 'Gross Revenue - Stripe',
  account_subtype = 'gross_revenue'
where account_code = '4010'
  and not exists (select 1 from public.accounts where account_code = '4040');

update public.accounts set
  account_code = '4050',
  account_name = 'Gross Revenue - PayPal',
  account_subtype = 'gross_revenue'
where account_code = '4020'
  and not exists (select 1 from public.accounts where account_code = '4050');

update public.accounts set
  account_code = '4060',
  account_name = 'Gross Revenue - Direct',
  account_subtype = 'gross_revenue'
where account_code = '4030'
  and not exists (select 1 from public.accounts where account_code = '4060');

-- Legacy combined returns line: keep as a sales_return bucket so any
-- pre-existing transactions still classify under Sales Return.
update public.accounts set
  account_subtype = 'sales_return'
where account_code = '4900';

-- COGS: 5010 → 5000
update public.accounts set
  account_code = '5000',
  account_name = 'COGS - WB+SP',
  account_subtype = 'cogs'
where account_code = '5010'
  and not exists (select 1 from public.accounts where account_code = '5000');

-- Ad spend: 6010/6020/6040/6050 → 6000/6001/6002/6003 (Google/Meta/Bing/ASI)
update public.accounts set
  account_code = '6000',
  account_name = 'Google Ads',
  account_subtype = 'marketing'
where account_code = '6010'
  and not exists (select 1 from public.accounts where account_code = '6000');

update public.accounts set
  account_code = '6001',
  account_name = 'Meta Ads',
  account_subtype = 'marketing'
where account_code = '6020'
  and not exists (select 1 from public.accounts where account_code = '6001');

update public.accounts set
  account_code = '6002',
  account_name = 'Bing Ads',
  account_subtype = 'marketing'
where account_code = '6040'
  and not exists (select 1 from public.accounts where account_code = '6002');

update public.accounts set
  account_code = '6003',
  account_name = 'ASI Ads',
  account_subtype = 'marketing'
where account_code = '6050'
  and not exists (select 1 from public.accounts where account_code = '6003');

-- Make sure the already-recoded rows have the right name + subtype even
-- if they were created manually before this migration ran.
update public.accounts set account_name = 'Gross Revenue - Stripe',  account_subtype = 'gross_revenue' where account_code = '4040';
update public.accounts set account_name = 'Gross Revenue - PayPal',  account_subtype = 'gross_revenue' where account_code = '4050';
update public.accounts set account_name = 'Gross Revenue - Direct',  account_subtype = 'gross_revenue' where account_code = '4060';
update public.accounts set account_name = 'COGS - WB+SP',            account_subtype = 'cogs'          where account_code = '5000';
update public.accounts set account_name = 'Google Ads',              account_subtype = 'marketing'     where account_code = '6000';
update public.accounts set account_name = 'Meta Ads',                account_subtype = 'marketing'     where account_code = '6001';
update public.accounts set account_name = 'Bing Ads',                account_subtype = 'marketing'     where account_code = '6002';
update public.accounts set account_name = 'ASI Ads',                 account_subtype = 'marketing'     where account_code = '6003';

-- ---- 2) Insert new accounts (idempotent) ----

insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  -- Gross Revenue (additional channels)
  ('4070', 'Gross Revenue - RP',          'revenue',   'gross_revenue', 'CREDIT'),
  ('4080', 'Misc Income',                  'revenue',   'gross_revenue', 'CREDIT'),

  -- Sales Returns (split by channel)
  ('4045', 'Sales Return - Stripe',        'revenue',   'sales_return',  'DEBIT'),
  ('4055', 'Sales Return - PayPal',        'revenue',   'sales_return',  'DEBIT'),
  ('4065', 'Sales Return - Direct',        'revenue',   'sales_return',  'DEBIT'),

  -- Platform Fees
  ('4075', 'Platform Fee - Stripe',        'expense',   'platform_fee',  'DEBIT'),
  ('4076', 'Platform Fee - PayPal',        'expense',   'platform_fee',  'DEBIT'),

  -- COGS (additional channel) + Sales Tax
  ('5005', 'COGS - RP',                    'expense',   'cogs',          'DEBIT'),
  ('5040', 'Sales Tax',                    'expense',   'sales_tax',     'DEBIT'),

  -- Marketing (Sage + Agency)
  ('6004', 'Sage Ads',                     'expense',   'marketing',     'DEBIT'),
  ('6030', 'Ad Agency Fee',                'expense',   'marketing',     'DEBIT'),

  -- Labour cost
  ('6100', 'Wages - W2',                   'expense',   'labour',        'DEBIT'),
  ('6110', 'Contractors - 1099',           'expense',   'labour',        'DEBIT'),
  ('6112', 'Contractor - Other (Upwork)',  'expense',   'labour',        'DEBIT'),
  ('6120', 'Payroll Tax',                  'expense',   'labour',        'DEBIT'),
  ('6121', 'Wise Platform Fee',            'expense',   'labour',        'DEBIT'),

  -- Other operating expenses
  ('6200', 'Subscriptions',                'expense',   'opex',          'DEBIT'),
  ('6300', 'Rent Expense',                 'expense',   'opex',          'DEBIT'),
  ('6400', 'Utilities',                    'expense',   'opex',          'DEBIT'),
  ('6450', 'Domain Fee',                   'expense',   'opex',          'DEBIT'),
  ('6600', 'Office Supplies',              'expense',   'opex',          'DEBIT'),
  ('6615', 'Bank Fees',                    'expense',   'opex',          'DEBIT'),
  ('6620', 'Telephone and Internet',       'expense',   'opex',          'DEBIT'),
  ('6640', 'Computers and Software',       'expense',   'opex',          'DEBIT'),
  ('6646', 'Misc Expense',                 'expense',   'opex',          'DEBIT'),
  ('6648', 'Professional Fee',             'expense',   'opex',          'DEBIT'),

  -- Equity / informational
  ('3100', 'Owner Distribution',           'equity',    'distribution',  'DEBIT')
on conflict (account_code) do nothing;
