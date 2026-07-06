-- ============================================================
-- 0019_cc_settlement_suspense_account.sql
-- Adds a suspense/clearing account for credit-card settlements
-- (a.k.a. CC payments: the bank→card transfer that pays down the
-- card balance).
--
-- Per finance (Anisha, 2026-06-30 Slack): "separate them for now,
-- we'll let you know where it should be posted." Settlements are a
-- balance-sheet event (they reduce the CC liability), NOT a P&L
-- expense. Until the final destination is decided, they are parked
-- here so they're booked, visible, and reconcilable rather than
-- silently dropped (which is what markAsCcPayment did before).
--
-- Modeled as a liability so it lands on the Balance Sheet and off
-- the P&L. subtype 'current' matches the existing liability rows
-- (2010/2100/2200/2300/2400-series) — no new subtype vocabulary.
-- Eventual reclass target is most likely the per-entity "Credit
-- card payable" accounts (2400 LP / 2410 KP / 2420 BP), TBD by finance.
--
-- 2999 verified free against the live Chart of Accounts (2026-06-30).
-- Idempotent via `on conflict (account_code) do nothing`.
-- See plan/credit-card-settlements-separation.md for full context.
-- ============================================================

insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  ('2999', 'Credit Card Settlements (unposted)', 'liability', 'current', 'CREDIT')
on conflict (account_code) do nothing;
