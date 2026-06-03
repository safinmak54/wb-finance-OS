-- ============================================================
-- 0011_cashbook_snapshot_checksum.sql
-- Add a content checksum to cashbook snapshots so a re-sync can
-- detect whether the Admin API payload actually changed since the
-- last fetch. When the checksum matches, the refresh action skips
-- the source entirely (no new snapshot, no re-synthesized
-- transactions). When it differs, the prior snapshot for that
-- (period_start, period_end, source) is deleted — cascading to its
-- synthesized `transactions` rows — and a fresh one inserted, so
-- the base tables never accumulate duplicate Admin API rows.
--
-- Existing rows get a NULL checksum; the next sync treats NULL as
-- "changed" and replaces them with checksummed snapshots.
-- ============================================================

alter table public.cashbook_snapshots
  add column if not exists payload_checksum text;

create index if not exists cashbook_snapshots_period_source_checksum_idx
  on public.cashbook_snapshots (period_start, period_end, source, payload_checksum);
