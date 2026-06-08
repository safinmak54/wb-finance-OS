-- Remove the category column from classification rules.
--
-- The category bucket (added in 0012) was only used for display on the Rules
-- admin screen and never drove posting/placement (that flows from the linked
-- account). It is being removed; the rules UI no longer shows a category.

ALTER TABLE classification_rules
  DROP COLUMN IF EXISTS category;
