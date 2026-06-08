-- Add an explicit category classification to classification rules.
--
-- Each rule is tagged with one of four buckets so the admin can see, on the
-- Rules screen, which financial statement a rule's transactions belong to:
--   bs_asset / bs_liability  -> Balance Sheet
--   pnl_revenue / pnl_expense -> P&L
-- Placement of posted transactions is unchanged (it still flows from the
-- linked account); this column is for classification/display on the rules UI.
--
-- Nullable so pre-existing rows stay valid; backfilled below from the type of
-- each rule's linked account (equity / unmapped left NULL).

ALTER TABLE classification_rules
  ADD COLUMN IF NOT EXISTS category text
  CHECK (category IN ('bs_asset', 'bs_liability', 'pnl_revenue', 'pnl_expense'));

UPDATE classification_rules cr
SET category = CASE acc.account_type
    WHEN 'asset'     THEN 'bs_asset'
    WHEN 'liability' THEN 'bs_liability'
    WHEN 'revenue'   THEN 'pnl_revenue'
    WHEN 'expense'   THEN 'pnl_expense'
  END
FROM accounts acc
WHERE cr.account_id = acc.id
  AND cr.category IS NULL
  AND acc.account_type IN ('asset', 'liability', 'revenue', 'expense');
