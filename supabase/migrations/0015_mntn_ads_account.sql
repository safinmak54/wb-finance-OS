-- ============================================================
-- 0015_mntn_ads_account.sql
-- Adds the MNTN / CTV ad-spend account introduced by the CB
-- Admin API v2 doc (June 2026). The API now reports MNTN spend
-- under platform_costs.mn; we book it to its own marketing
-- account so per-platform ad accounts sum back to total ad spend.
--
-- 6004 is already taken ("Sage Ads"), so MNTN gets 6005.
-- Idempotent via `on conflict (account_code) do nothing`.
-- ============================================================

insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  ('6005', 'MNTN Ads', 'expense', 'marketing', 'DEBIT')
on conflict (account_code) do nothing;
