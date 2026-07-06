# Credit-Card Settlements — Separation Plan

> **Status:** ✅ Implemented in code (2026-06-30), pending migration apply to live DB.
> **Branch context:** `classification__rules_category`
> **Author:** drafted with Claude, 2026-06-30
> **Decision owner:** Anisha Maredia (finance) — final posting destination TBD by her team.

## 0. Implementation status (2026-06-30)

- ✅ **Step A** — `supabase/migrations/0019_cc_settlement_suspense_account.sql` adds account
  `2999 / "Credit Card Settlements (unposted)"` (`liability` / subtype `current` / `CREDIT`).
  Confirmed against live CoA: `2999` was free; existing liabilities are `2010/2100/2200/2300`
  and per-entity CC payables `2400 (LP) / 2410 (KP) / 2420 (BP)` — the likely eventual reclass target.
- ✅ **Step B** — `markAsCcPayment` ([`actions/transactions.ts`](../actions/transactions.ts)) now
  posts a signed `transactions` row per id into `2999` (memo `cc_settlement:unposted`), resolving
  entity from `entity_id` → `detectEntityFromBankAccount` → `"WB"`, skipping GL posting for
  closed periods, and deduping via the checksum upsert. Then flips raw rows to classified as before.
- ✅ **Step C** — *no code needed*: the balance sheet ([`app/(app)/balance/page.tsx`](../app/(app)/balance/page.tsx))
  already renders every liability account as its own line, so `2999` shows up automatically.
- ⏳ **Remaining:** apply migration 0019 to the live DB (idempotent insert); then Step D (reclass) when finance decides.
- ✅ Typecheck passes (`npm run typecheck`).

---

## 1. What triggered this

Slack thread (paraphrased, 2026-06-30):

- **Ahmed Farooq:** "The credit card settlement that we make should be separated from
  actual expenses. These usually would be big amounts and in positive. Will they be
  listed as a big number in P&L or Balance Sheet?" (cc: Khushbakht Tahir, Komal K, Anisha Maredia)
- **Anisha Maredia:** "The settlements? For now, **just separate them, we'll let you
  know where it should be posted.**"

**Operative directive:** segregate credit-card settlements into their own bucket now.
Do **not** commit them to a final P&L or balance-sheet line yet — that destination is
explicitly deferred to Anisha's team.

---

## 2. What a "settlement" is (terminology)

There is **no literal "settlement" string anywhere in the codebase.** What the finance
team calls a "credit-card settlement" is what the app already models as a **CC payment**:
the bank → credit-card transfer that pays down (settles) the card's outstanding balance.

Accounting reality — a settlement touches **two balance-sheet accounts**, neither of which
is an expense:

- Cash (asset) ↓
- Credit-card payable (liability) ↓

The expense already hit the P&L when the card was **charged**. Paying the card later is a
balance-sheet transfer, not a new expense.

Why "big amounts and in positive": a card liability normally carries a negative/credit
balance (money owed); a settlement posts a large **positive** amount against it to bring
it back toward zero — the opposite sign of the purchases. That opposite sign is exactly
why it must never be netted into expenses: a $50k payoff would otherwise wrongly cancel
$50k of real spend.

**Answer to Ahmed's P&L-vs-BS question (for when the decision comes):** it belongs on the
**Balance Sheet** (reduces the card liability), **not** the P&L. But per Anisha, do not
hard-wire that yet.

---

## 3. How the app handles it TODAY (the gap)

Detection — pure description-pattern matching in
[`lib/classify-rules.ts`](../lib/classify-rules.ts) (`detectTxnKind`, `CC_PAYMENT_PATTERNS`):
matches "Capital One Online", "Amex Payment", "Chase (Card) Payment", "Citibank Online
Payment", "Discover Payment", "Bank of America Credit Card Payment", "Credit Card Payment",
"CC Payment". Used only for **inbox grouping**.

Action — [`markAsCcPayment`](../actions/transactions.ts#L399) (and its twin
[`markAsInternalTransfer`](../actions/transactions.ts#L371)):

```
update raw_transactions set classified = true, classified_at = now(), status = 'confirmed'
```

…and **posts NO `transactions` (GL) row at all.** It just flips the raw row and the
settlement disappears from the inbox.

**Why that fails the directive:** "no GL row" suppresses it from the P&L (good) but also
makes it **vanish** — there is no bucket, no balance, nothing to review or re-post. You
cannot "separate" something you've deleted. To satisfy "separate them, we'll tell you
where to post," they must land somewhere visible and re-postable.

### Posting pattern to mirror

A normal classification ([`classifyTransaction`](../actions/transactions.ts#L23)) posts a
**single signed `transactions` row** to an `account_id`:

```
amount = direction === 'DEBIT' ? -abs(amount) : +abs(amount)   // signed; negative = debit/outflow
upsert into transactions { raw_transaction_id, entity, account_id, amount, txn_date, acc_date, description, memo }
  on conflict (checksum) ignoreDuplicates
```

The balance sheet ([`fetchBalanceSheetData`](../lib/queries/reports.ts#L197)) sums these
signed `transactions.amount` by `account_id` / `account_type`. So routing settlements to a
dedicated account makes them accumulate there as a visible balance-sheet line.

---

## 4. Approaches considered

### Approach #1 — Suspense / clearing account  ✅ CHOSEN

Create a dedicated balance-sheet holding account (e.g. `2999 — Credit Card Settlements
(unposted)`). Change `markAsCcPayment` to **post a signed `transactions` row into that
account** instead of posting nothing. Surface it as its own line on the balance sheet.
When Anisha's team names the final destination, reclassify the whole suspense balance in
one journal entry.

- **Pros:** money is actually booked (running balance, audit trail, reconcilable); interim
  state is already accounting-correct (off P&L, on BS); re-posting later is one move;
  hard to lose — the balance sits there until someone clears it. This is the textbook
  suspense-account pattern, which is precisely "park it now, reclassify later."
- **Cons:** needs a new account + a change to the posting logic + a report line.

### Approach #2 — Report-only "Settlements" line

Keep the current flag (`cc_payment`, no GL row); just surface a "Settlements" total in the
reports computed from the flagged raw rows.

- **Pros:** least work; no new account; no GL change.
- **Cons:** nothing is ever booked, so "post it to X later" means re-classifying every raw
  row by hand; it's only a view (easy to overlook, not reconcilable); doesn't truly
  separate — it re-derives a number from suppressed rows.

**Decision: Approach #1.** Anisha's "separate now, post later" is the literal definition of
a suspense account. #2's only advantage (less upfront work) is exactly what defers the real
work and does it the hard way.

---

## 5. Implementation plan (Approach #1)

> ⚠️ **Confirm against live data first:** the Chart of Accounts is seeded in the live
> Supabase DB, **not** in migrations ([`0001_baseline_schema.sql`](../supabase/migrations/0001_baseline_schema.sql)
> is an intentionally empty placeholder). Before coding, confirm: (a) the real CC-liability
> account code(s), and (b) that `2999` is free. Account-type / subtype vocabulary lives in
> [`0007_pnl_account_structure.sql`](../supabase/migrations/0007_pnl_account_structure.sql).

### Step A — Migration: add the suspense account

New file `supabase/migrations/0019_cc_settlement_suspense_account.sql`, mirroring the
idempotent style of [`0015_mntn_ads_account.sql`](../supabase/migrations/0015_mntn_ads_account.sql):

```sql
insert into public.accounts
  (account_code, account_name, account_type, account_subtype, normal_balance)
values
  ('2999', 'Credit Card Settlements (unposted)', 'liability', 'suspense', 'CREDIT')
on conflict (account_code) do nothing;
```

- `account_type = 'liability'` → lands on the Balance Sheet, off the P&L (satisfies the
  directive's interim correctness).
- `account_subtype = 'suspense'` is a **new** subtype value — decide whether to extend the
  recognised set documented in 0007, or reuse an existing one. Flag for review.
- Pick the final code/name with finance; `2999` is a placeholder.

### Step B — Change `markAsCcPayment` to post into the suspense account

In [`actions/transactions.ts`](../actions/transactions.ts#L399), make `markAsCcPayment`
post a signed `transactions` row per id (looking up the `2999` account_id once), reusing
the `classifyTransaction` signed-amount + checksum-upsert pattern, **then** flip the raw
row to classified. Keep `markAsInternalTransfer` unchanged (true internal transfers stay
no-GL). Set a recognizable `memo`, e.g. `cc_settlement:unposted`, so the suspense balance
is filterable and the eventual reclass JE can target it.

Open question: bulk ids may span multiple entities / periods — respect the closed-period
guard that `classifyTransaction` enforces, and resolve `entity` per raw row.

### Step C — Balance-sheet "Settlements" line

Surface account `2999` as its own line (not folded into general liabilities) in the
balance-sheet view so the parked total is visible and auditable. Touch points:
[`fetchBalanceSheetData`](../lib/queries/reports.ts#L197) and its grouping/section logic.

### Step D — (later, when Anisha decides) Reclass out of suspense

One journal entry moving the `2999` balance to the named destination. Not built now —
this is the whole reason for the suspense bucket.

---

## 6. Open questions / decisions deferred

1. **Final destination** of settlements — P&L vs which BS account. Owner: Anisha's team.
   (Accounting-correct answer: reduce the CC-liability account on the BS — likely the
   per-entity `2400/2410/2420` "Credit card payable" accounts that already exist.)
2. ~~**Account code & name**~~ — RESOLVED: `2999 / "Credit Card Settlements (unposted)"`,
   confirmed free against the live CoA on 2026-06-30.
3. ~~**New `suspense` subtype**~~ — RESOLVED: reused existing liability subtype `current`;
   no new vocabulary added.
4. **Detection coverage** — separation only fires for rows identified as `cc_payment`.
   Detection is description-pattern only; unmatched settlements still risk landing in an
   expense account. Consider flagging large unmatched positive amounts for review.
5. **Backfill** — existing already-marked CC payments posted no GL row; decide whether to
   backfill them into suspense or only apply going forward.

---

## 7. Key code references

- [`lib/classify-rules.ts`](../lib/classify-rules.ts) — `detectTxnKind`, `CC_PAYMENT_PATTERNS`
- [`actions/transactions.ts:399`](../actions/transactions.ts#L399) — `markAsCcPayment` (the function to change)
- [`actions/transactions.ts:371`](../actions/transactions.ts#L371) — `markAsInternalTransfer` (leave as-is)
- [`actions/transactions.ts:23`](../actions/transactions.ts#L23) — `classifyTransaction` (posting pattern to mirror)
- [`lib/queries/reports.ts:197`](../lib/queries/reports.ts#L197) — `fetchBalanceSheetData`
- [`supabase/migrations/0015_mntn_ads_account.sql`](../supabase/migrations/0015_mntn_ads_account.sql) — account-insert migration template
- [`supabase/migrations/0007_pnl_account_structure.sql`](../supabase/migrations/0007_pnl_account_structure.sql) — account_subtype vocabulary
- [`app/(app)/inbox/InboxClient.tsx`](../app/(app)/inbox/InboxClient.tsx) — "Mark as CC Payment" UI
