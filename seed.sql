-- ============================================================
-- WB BRANDS FINANCE OS — Supabase Seed Data
-- Run this in the Supabase SQL Editor AFTER running the schema
-- and RLS policy SQL from the plan document.
-- ============================================================

-- ---- ENTITIES ----
insert into entities (code, name, entity_type, is_active) values
  ('WB',     'WB Brands LLC',           'PARENT',    true),
  ('LP',     'Lanyard Promo LLC',        'OPERATING', true),
  ('KP',     'Koolers Promo LLC',        'OPERATING', true),
  ('BP',     'Band Promo LLC',           'OPERATING', true),
  ('WBP',    'WB Promo LLC',             'OPERATING', true),
  ('ONEOPS', 'One Operations Mgmt',      'SERVICE',   true)
on conflict (code) do nothing;

-- ---- CHART OF ACCOUNTS ----
-- normal_balance: DEBIT for assets/expenses, CREDIT for liabilities/equity/revenue
insert into accounts (account_code, account_name, account_type, account_subtype, normal_balance, line, is_elimination, is_active) values
  ('1010', 'Cash — LP checking',           'asset',    'current',     'DEBIT',  'Cash',                    false, true),
  ('1020', 'Cash — KP checking',           'asset',    'current',     'DEBIT',  'Cash',                    false, true),
  ('1030', 'Cash — BP checking',           'asset',    'current',     'DEBIT',  'Cash',                    false, true),
  ('1040', 'Cash — WBP checking',          'asset',    'current',     'DEBIT',  'Cash',                    false, true),
  ('1050', 'Cash — One Ops checking',      'asset',    'current',     'DEBIT',  'Cash',                    false, true),
  ('1100', 'Accounts receivable',          'asset',    'current',     'DEBIT',  'A/R',                     false, true),
  ('1200', 'Inventory',                    'asset',    'current',     'DEBIT',  'Inventory',               false, true),
  ('1300', 'Prepaid expenses',             'asset',    'current',     'DEBIT',  'Prepaid',                 false, true),
  ('1400', 'Intercompany receivable',      'asset',    'current',     'DEBIT',  'Eliminated',              true,  true),
  ('2010', 'Accounts payable',             'liability','current',     'CREDIT', 'A/P',                     false, true),
  ('2100', 'Payroll liabilities',          'liability','current',     'CREDIT', 'Payroll liabilities',     false, true),
  ('2200', 'Accrued expenses',             'liability','current',     'CREDIT', 'Accrued expenses',        false, true),
  ('2300', 'Intercompany payable',         'liability','current',     'CREDIT', 'Eliminated',              true,  true),
  ('2400', 'Credit card payable — LP',     'liability','current',     'CREDIT', 'A/P',                     false, true),
  ('2410', 'Credit card payable — KP',     'liability','current',     'CREDIT', 'A/P',                     false, true),
  ('2420', 'Credit card payable — BP',     'liability','current',     'CREDIT', 'A/P',                     false, true),
  ('3010', 'Owner equity',                 'equity',   'equity',      'CREDIT', 'Owner equity',            false, true),
  ('3020', 'Retained earnings',            'equity',   'equity',      'CREDIT', 'Retained earnings',       false, true),
  ('3030', 'Partner distributions',        'equity',   'equity',      'CREDIT', 'Distributions',           false, true),
  ('4010', 'Gross revenue — Stripe',       'revenue',  'revenue',     'CREDIT', 'Gross revenue',           false, true),
  ('4020', 'Gross revenue — PayPal',       'revenue',  'revenue',     'CREDIT', 'Gross revenue',           false, true),
  ('4030', 'Gross revenue — Wire/Check',   'revenue',  'revenue',     'CREDIT', 'Gross revenue',           false, true),
  ('4900', 'Returns and cancellations',    'revenue',  'contra',      'DEBIT',  'Returns',                 false, true),
  ('4950', 'Commission income — One Ops',  'revenue',  'revenue',     'CREDIT', 'Eliminated',              true,  true),
  ('5010', 'Cost of goods sold',           'expense',  'cogs',        'DEBIT',  'COGS',                    false, true),
  ('5020', 'Shipping costs',               'expense',  'cogs',        'DEBIT',  'Shipping',                false, true),
  ('6010', 'Google Ads',                   'expense',  'advertising', 'DEBIT',  'Advertisement',           false, true),
  ('6020', 'Meta Ads',                     'expense',  'advertising', 'DEBIT',  'Advertisement',           false, true),
  ('6030', 'Ad agency fees',               'expense',  'advertising', 'DEBIT',  'Ad agencies',             false, true),
  ('6100', 'Wages — W2',                   'expense',  'payroll',     'DEBIT',  'Wages',                   false, true),
  ('6110', 'Contractor — 1099',            'expense',  'payroll',     'DEBIT',  'Wages',                   false, true),
  ('6120', 'Payroll tax',                  'expense',  'payroll',     'DEBIT',  'Payroll tax',             false, true),
  ('6200', 'Dues and subscriptions',       'expense',  'opex',        'DEBIT',  'Dues and subscriptions',  false, true),
  ('6300', 'Rent expense',                 'expense',  'opex',        'DEBIT',  'Rent',                    false, true),
  ('6400', 'Utilities',                    'expense',  'opex',        'DEBIT',  'Utility expense',         false, true),
  ('6500', 'Stripe fees',                  'expense',  'platform',    'DEBIT',  'Platform fees',           false, true),
  ('6510', 'PayPal fees',                  'expense',  'platform',    'DEBIT',  'Platform fees',           false, true),
  ('6600', 'Office supplies',              'expense',  'opex',        'DEBIT',  'Other opex',              false, true),
  ('6610', 'Repairs and maintenance',      'expense',  'opex',        'DEBIT',  'Other opex',              false, true),
  ('6620', 'Telephone and internet',       'expense',  'opex',        'DEBIT',  'Other opex',              false, true),
  ('6630', 'Bank fees',                    'expense',  'opex',        'DEBIT',  'Other opex',              false, true),
  ('6640', 'Computers and software',       'expense',  'opex',        'DEBIT',  'Other opex',              false, true),
  ('6700', 'Commission expense — WB',      'expense',  'commission',  'DEBIT',  'Eliminated',              true,  true)
on conflict (account_code) do nothing;

-- ---- VENDORS ----
insert into vendors (name, vendor_type, ytd_spend, open_invoices, overdue_count, last_payment, status, is_active) values
  ('Google',               'ad_agency', 218400, 1, 0, '2025-03-31', 'active',  true),
  ('Meta',                 'ad_agency', 174600, 1, 1, '2025-02-28', 'overdue', true),
  ('UPS',                  'shipping',  128400, 1, 1, '2025-02-28', 'overdue', true),
  ('FedEx',                'shipping',   62800, 1, 1, '2025-02-25', 'overdue', true),
  ('Promo Direct',         'cogs',      985000, 2, 0, '2025-03-22', 'active',  true),
  ('ADP',                  'software',   74500, 0, 0, '2025-03-30', 'active',  true),
  ('Shopify',              'software',    9600, 0, 0, '2025-03-24', 'active',  true),
  ('Amazon Web Services',  'software',    8400, 0, 0, '2025-03-18', 'active',  true),
  ('Realty Partners LLC',  'utility',    24000, 0, 0, '2025-03-01', 'active',  true),
  ('Studio 44',            'ad_agency',  25500, 1, 0, '2025-03-21', 'active',  true)
on conflict do nothing;

-- ---- INVOICES ----
-- Link vendor by name lookup
insert into invoices (vendor_id, invoice_number, invoice_date, due_date, amount, amount_paid, status) values
  ((select id from vendors where name = 'Meta'),          'META-2025-03',  '2025-02-28', '2025-03-28', 44600,  0,      'overdue'),
  ((select id from vendors where name = 'UPS'),           'UPS-MAR-001',   '2025-02-28', '2025-03-28', 18200,  0,      'overdue'),
  ((select id from vendors where name = 'FedEx'),         'FX-2025-0312',  '2025-02-26', '2025-03-26', 12800,  0,      'overdue'),
  ((select id from vendors where name = 'Promo Direct'),  'PD-20250301',   '2025-03-01', '2025-04-01', 128000, 128000, 'paid'),
  ((select id from vendors where name = 'Google'),        'G-ADS-MAR25',   '2025-03-01', '2025-04-15', 52100,  0,      'open'),
  ((select id from vendors where name = 'Studio 44'),     'S44-0021',      '2025-03-15', '2025-04-15', 8500,   4000,   'partial'),
  ((select id from vendors where name = 'Promo Direct'),  'PD-20250315',   '2025-03-15', '2025-04-15', 95000,  0,      'open')
on conflict do nothing;

-- ---- RAW TRANSACTIONS ----
-- direction: CREDIT = money in (income/transfer received), DEBIT = money out (expense/payroll/cogs)
insert into raw_transactions (entity_id, source, external_id, transaction_date, accounting_date, amount, direction, description, vendor, txn_type, category, status) values
  ((select id from entities where code='WB'),     'stripe', 'seed-T001', '2025-03-31', '2025-03-31', 62400,  'CREDIT', 'Stripe payout — consolidated',      'Stripe',               'income',   'Gross Revenue — Stripe',          'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T002', '2025-03-31', '2025-03-31', 18200,  'DEBIT',  'UPS bulk shipment Mar',             'UPS',                  'expense',  'Shipping Costs',                  'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T003', '2025-03-31', '2025-03-31', 52100,  'DEBIT',  'Google Ads — March billing',        'Google',               'expense',  'Google Ads',                      'confirmed'),
  ((select id from entities where code='LP'),     'bank',   'seed-T004', '2025-03-30', '2025-03-30', 140000, 'CREDIT', 'LP → One Ops transfer',             '',                     'transfer', 'Intercompany — eliminated',       'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T005', '2025-03-30', '2025-03-30', 74500,  'DEBIT',  'ADP payroll run — Mar',             'ADP',                  'payroll',  'Wages — W2',                      'confirmed'),
  ((select id from entities where code='WB'),     'paypal', 'seed-T006', '2025-03-29', '2025-03-29', 21800,  'CREDIT', 'PayPal payout batch',               'PayPal',               'income',   'Gross Revenue — PayPal',          'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T007', '2025-03-28', '2025-03-28', 4200,   'DEBIT',  'Unknown ACH — vendor unidentified', 'Unknown',              'expense',  'Unclassified',                    'review'),
  ((select id from entities where code='WB'),     'bank',   'seed-T008', '2025-03-28', '2025-03-28', 59151,  'CREDIT', '2% commission transfer — ZT Brands','ZT Brands',            'transfer', 'Eliminated on consolidation',     'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T009', '2025-03-27', '2025-03-27', 44600,  'DEBIT',  'Meta Ads — March',                  'Meta',                 'expense',  'Meta Ads',                        'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T010', '2025-03-26', '2025-03-26', 12800,  'DEBIT',  'FedEx shipping batch',              'FedEx',                'expense',  'Shipping Costs',                  'confirmed'),
  ((select id from entities where code='LP'),     'stripe', 'seed-T011', '2025-03-25', '2025-03-25', 38200,  'CREDIT', 'Stripe payout — Lanyard',           'Stripe',               'income',   'Gross Revenue — Stripe',          'confirmed'),
  ((select id from entities where code='KP'),     'stripe', 'seed-T012', '2025-03-25', '2025-03-25', 26400,  'CREDIT', 'Stripe payout — Koolers',           'Stripe',               'income',   'Gross Revenue — Stripe',          'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T013', '2025-03-24', '2025-03-24', 3200,   'DEBIT',  'Shopify platform fee',              'Shopify',              'expense',  'Platform Fees',                   'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T014', '2025-03-22', '2025-03-22', 128000, 'DEBIT',  'COGS — promo products batch',       'Promo Direct',         'cogs',     'Cost of Goods Sold',              'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T015', '2025-03-21', '2025-03-21', 8500,   'DEBIT',  'Contractor payment — creative',     'Studio 44',            'payroll',  'Contractor — 1099',               'review'),
  ((select id from entities where code='BP'),     'bank',   'seed-T016', '2025-03-20', '2025-03-20', 44000,  'CREDIT', 'Wire payment received',             '',                     'income',   'Gross Revenue — Wire/Check',      'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T017', '2025-03-18', '2025-03-18', 2800,   'DEBIT',  'AWS cloud services',               'Amazon Web Services',  'expense',  'Computers and Software',          'confirmed'),
  ((select id from entities where code='WBP'),    'paypal', 'seed-T018', '2025-03-15', '2025-03-15', 18600,  'CREDIT', 'PayPal payout — WB Promo',          'PayPal',               'income',   'Gross Revenue — PayPal',          'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T019', '2025-03-01', '2025-03-01', 8000,   'DEBIT',  'Office rent — March',               'Realty Partners LLC',  'expense',  'Rent Expense',                    'confirmed'),
  ((select id from entities where code='ONEOPS'), 'bank',   'seed-T020', '2025-03-14', '2025-03-14', 240,    'DEBIT',  'Unknown charge — ATM',              'Unknown',              'expense',  'Unclassified',                    'review')
on conflict (source, external_id) do nothing;

-- ---- JOURNAL ENTRIES ----
-- JE-001: March commission elimination
with je1 as (
  insert into journal_entries (entity_id, transaction_date, accounting_date, description, entry_type, source, status, is_intercompany)
  values (
    (select id from entities where code = 'WB'),
    '2025-03-31', '2025-03-31',
    'March commission — WB Brands / One Ops elimination',
    'elimination', 'MANUAL', 'POSTED', true
  )
  returning id
)
insert into ledger_entries (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, memo)
values
  ((select id from je1), (select id from accounts where account_code = '6700'), (select id from entities where code = 'WB'),     59151, 0,     'March commission — WB Brands'),
  ((select id from je1), (select id from accounts where account_code = '4950'), (select id from entities where code = 'ONEOPS'), 0,     59151, 'March commission — One Ops');

-- JE-002: Accrued shipping
with je2 as (
  insert into journal_entries (entity_id, transaction_date, accounting_date, description, entry_type, source, status)
  values (
    (select id from entities where code = 'WB'),
    '2025-03-31', '2025-03-31',
    'Accrued shipping — unpaid invoices',
    'accrual', 'MANUAL', 'POSTED'
  )
  returning id
)
insert into ledger_entries (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, memo)
values
  ((select id from je2), (select id from accounts where account_code = '2200'), (select id from entities where code = 'WB'), 31000, 0,     'Accrued shipping — unpaid invoices'),
  ((select id from je2), (select id from accounts where account_code = '2010'), (select id from entities where code = 'WB'), 0,     31000, 'Accrued shipping — unpaid invoices');

-- JE-003: Partner distribution
with je3 as (
  insert into journal_entries (entity_id, transaction_date, accounting_date, description, entry_type, source, status)
  values (
    (select id from entities where code = 'WB'),
    '2025-03-31', '2025-03-31',
    'Partner distribution — March',
    'distribution', 'MANUAL', 'POSTED'
  )
  returning id
)
insert into ledger_entries (journal_entry_id, account_id, entity_id, debit_amount, credit_amount, memo)
values
  ((select id from je3), (select id from accounts where account_code = '3030'), (select id from entities where code = 'WB'), 120000, 0,      'Partner distribution — March'),
  ((select id from je3), (select id from accounts where account_code = '1050'), (select id from entities where code = 'WB'), 0,      120000, 'Partner distribution — March');
