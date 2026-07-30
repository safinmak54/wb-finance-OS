# Classification — Generalized Backend Flow

> **Scope:** the target design for auto-classification in a decoupled backend
> (REST/RPC service + worker), replacing the Next.js Server Action implementation
> in `actions/classify.ts` + `lib/classify-rules.ts`.
> **Companion doc:** [APIs-Needed.md](APIs-Needed.md) §2–3.

The current implementation works but is hard-wired to one shape: a rule is
`pattern → account_id`, matched only against `description`, evaluated only in
`created_at` order, with the outcome collapsed to `{ tagged, skipped }`. Kinds
(`transfer` / `cc_payment`) live in a hardcoded array in code, not in data.

This spec generalizes four things:

1. **The rule** — from one pattern/one field to a scoped, multi-condition rule.
2. **The engine** — one pure, deterministic evaluator shared by API and worker.
3. **The flow** — an explicit `preview → apply` pipeline with typed outcomes
   instead of a silent skip counter.
4. **The record** — every apply produces an auditable run, not a return value.

---

## 1. Domain model

### 1.1 Canonical transaction (engine input)

The engine must not know about `raw_transactions`, Admin-API rows, or CC feeds.
Every ingest adapter normalizes to one shape:

```ts
type CanonicalTxn = {
  id: string;
  entity_id: string | null;        // may be null — a real, common case
  source: string;                  // 'bank' | 'cc' | 'admin_api' | 'import' | …
  external_id: string | null;      // for idempotent re-ingest
  date: string;                    // ISO date, txn date
  acc_date: string;                // ISO date, accounting date (defaults to date)
  amount: number;                  // always positive magnitude
  direction: 'DEBIT' | 'CREDIT';   // sign lives here, not in amount
  description: string | null;
  vendor: string | null;
  bank_account: string | null;
  account_number: string | null;
  memo: string | null;
  classified: boolean;
};
```

**Normalization** (applied once, before matching, and cached per txn):

```
norm(s) = s ?? ''
        |> uppercase
        |> collapse runs of whitespace to a single space
        |> trim
```

Matching runs against `norm()`ed field values so `"GOOGLE  ADS"` and
`"google ads"` behave identically. Raw values are kept for display and regex
rules that care about punctuation (`DBT=D/`), so the engine exposes both:
conditions declare `normalized: true` (default) or `false`.

### 1.2 Rule

```ts
type Rule = {
  id: string;
  name: string;                    // human label, independent of the pattern
  description: string | null;
  is_active: boolean;
  priority: number;                // lower runs first; default 100

  scope: RuleScope;                // cheap gate — evaluated before conditions
  match: { mode: 'all' | 'any'; conditions: Condition[] };
  action: RuleAction;

  // observability, maintained by the engine
  match_count: number;
  last_matched_at: string | null;

  created_by: string; created_at: string;
  updated_by: string | null; updated_at: string | null;
};

type RuleScope = {
  entity_ids: string[] | null;     // null = any entity
  sources: string[] | null;        // null = any source
  directions: ('DEBIT' | 'CREDIT')[] | null;
  amount_min: number | null;       // inclusive, on magnitude
  amount_max: number | null;
  date_from: string | null;        // rule only applies to txns in this window
  date_to: string | null;
};

type Condition = {
  field: 'description' | 'vendor' | 'bank_account' | 'account_number'
       | 'memo' | 'source' | 'amount' | 'date';
  op: 'contains' | 'not_contains' | 'equals' | 'starts_with' | 'ends_with'
    | 'regex' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between';
  value: string | number | string[] | [number, number];
  normalized?: boolean;            // default true for text fields
};

type RuleAction = {
  account_id: string | null;       // GL account to post to
  vendor_id: string | null;        // optional vendor tag (now a real column)
  entity_id: string | null;        // optional entity *inference* when txn has none
  kind: 'transfer' | 'cc_payment' | 'settlement' | null;  // replaces hardcoded lists
  memo_template: string | null;    // e.g. "auto: {{rule.name}}"
  confidence: number;              // 0..1, default 1.0
  stop: boolean;                   // default true — first match wins
};
```

Three deliberate generalizations:

- **`action.kind`** pulls `detectTxnKind`'s hardcoded `CC_PAYMENT_PATTERNS` /
  `TRANSFER_PATTERNS` into the rules table. Those arrays become seeded rows
  (`account_id: null`, `kind: 'cc_payment'`, `stop: false`). Finance can then
  add a settlement pattern without a deploy. Kind-only rules never post — they
  label, which is what the inbox tabs consume.
- **`action.entity_id`** addresses the biggest current skip reason: a matched
  row with no resolvable entity is dropped. A rule scoped to a bank account can
  now supply the entity.
- **`stop: false`** lets a txn accumulate labels (kind, vendor) from several
  rules while still taking its account from the first `stop: true` match.

### 1.3 Category

Do **not** reintroduce a `category` column. [0012](../../supabase/migrations/0012_classification_rules_category.sql)
added `bs_asset`/`bs_liability`/`pnl_revenue`/`pnl_expense` and
[0013](../../supabase/migrations/0013_drop_classification_rules_category.sql)
dropped it: it duplicated `accounts.account_type` and never drove placement. If
the rules UI wants a statement bucket, derive it at read time:

```
category(rule) = bucket(accounts[rule.action.account_id].account_type)
```

Expose it as a computed field on the rule DTO (`category`, read-only). One
source of truth, zero backfill drift.

---

## 2. The engine (pure, no I/O)

One module, no database access, no framework imports. Callable from the HTTP
handler, the ingest worker, and tests.

```ts
evaluate(txn: CanonicalTxn, rules: CompiledRule[], opts?: EvalOpts): Decision
evaluateBatch(txns, rules, opts): Decision[]
```

### 2.1 Compilation

`compile(rules) → CompiledRule[]` runs once per batch, not per row:

- regex conditions are constructed once; an invalid regex marks the rule
  `compile_error` and **excludes** it from evaluation while surfacing the error
  on the rules API (today `compilePattern` returns `null` and the rule silently
  never fires — a rule that looks active but is dead).
- `contains`-style values are pre-normalized.
- rules are sorted deterministically:

```
ORDER BY priority ASC,
         specificity DESC,     -- condition count + scope narrowness
         created_at ASC,
         id ASC                -- final tiebreak, never ambiguous
```

Deterministic order is a hard requirement: preview and apply must reach the same
verdict, and two backend instances must agree.

### 2.2 Decision

```ts
type Decision = {
  txn_id: string;
  matches: MatchHit[];          // every rule that fired, in evaluation order
  resolved: {
    account_id: string | null;
    vendor_id: string | null;
    entity_id: string | null;   // txn's own, else inferred from a rule
    kind: string | null;
    confidence: number;         // min() across contributing rules
    rule_ids: string[];
  };
  status: 'ready' | 'suggest' | 'skip';
  skip_reason: SkipReason | null;
};

type SkipReason =
  | 'NO_RULE_MATCH'        // nothing fired
  | 'NO_ACCOUNT'           // matched, but only kind/vendor rules
  | 'MISSING_ENTITY'       // no txn entity and no rule supplied one
  | 'ACCOUNT_INACTIVE'     // target account deactivated
  | 'PERIOD_CLOSED'        // acc_date lands in a closed (period, entity)
  | 'ALREADY_CLASSIFIED'
  | 'LOW_CONFIDENCE'       // below opts.min_confidence → suggest, don't post
  | 'AMBIGUOUS';           // strict mode: 2+ stop-rules disagree on account
```

`status: 'ready'` → safe to post unattended. `'suggest'` → prefill the inbox
picker, require a human. `'skip'` → surface the reason. **The typed reason is
the point**: today a bookkeeper sees `skipped: 412` with no way to learn that
390 of them are `MISSING_ENTITY` and fixable with one scope rule.

`AMBIGUOUS` requires `opts.strict: true`. Default stays first-match-wins for
backward compatibility with the existing rule set; strict mode is what you turn
on once priorities are curated.

---

## 3. The flow

```
┌── ingest ─────────────────────────────────────────────────────────┐
│ adapter (bank / cc / admin_api / csv) → CanonicalTxn → dedupe by  │
│ (source, external_id) or content checksum → persist unclassified  │
└──────────────────────┬────────────────────────────────────────────┘
                       │
                       ▼
              ┌── classify (pure) ──┐
              │ compile(rules)      │   no writes, idempotent,
              │ evaluate(txns)      │   safe to run on every read
              └────────┬────────────┘
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
┌── read path ──────────┐    ┌── write path ────────────────────────┐
│ GET /transactions     │    │ POST /classification/preview  (dry)  │
│   ?classified=false   │    │        ↓ same Decision[]             │
│ each row carries      │    │ POST /classification/apply           │
│ `suggestion`          │    │   ├ filter status == 'ready'         │
│ (Decision, inlined)   │    │   ├ closed-period gate (batch)       │
│ → inbox prefills      │    │   ├ post ledger rows + flag raw      │
│   the account picker  │    │   │   ← ONE db transaction           │
│                       │    │   ├ bump rule match_count            │
│                       │    │   └ write run + per-item audit       │
└───────────────────────┘    └──────────┬───────────────────────────┘
                                        ▼
                              ┌── learn (phase 3) ──┐
                              │ manual override →   │
                              │ candidate rule      │
                              └─────────────────────┘
```

### 3.1 Read path — suggestions

Unchanged in spirit from today's `autoTags`: the inbox endpoints run the engine
server-side and inline a `suggestion` object per row. Cost is a single
`GET /classification-rules` (cache it, invalidate on rule write) plus in-process
matching. No writes, so it can run on every request.

### 3.2 Write path — preview then apply

**`preview` and `apply` take the identical request body.** This is the core
contract: the operator sees exactly what will happen, then commits the same
selector. Differences between the two runs (new txns ingested in between) are
detected by the `expected` counts in the apply body.

Selector:

```jsonc
{
  "selector": {                       // choose one style
    "txn_ids": ["…"],                 // explicit, from the inbox checkbox UI
    "filter": {                       // or scoped bulk
      "entity": "WBP",                // or "all"
      "source": "bank",
      "date_from": "2026-01-01",
      "date_to": "2026-06-30",
      "classified": false
    }
  },
  "rule_ids": null,                   // null = all active rules; or a subset
  "options": {
    "min_confidence": 0.8,
    "strict": false,
    "post": true                      // false = tag/label only, don't post GL
  },
  "expected": { "ready": 128 },       // apply only; 409 on mismatch
  "idempotency_key": "…"              // apply only
}
```

Preview response:

```jsonc
{
  "totals": { "ready": 128, "suggest": 44, "skip": 412 },
  "skip_breakdown": { "MISSING_ENTITY": 390, "NO_RULE_MATCH": 20, "PERIOD_CLOSED": 2 },
  "by_rule": [ { "rule_id": "…", "name": "GOOGLE", "ready": 61 } ],
  "items": [ /* Decision[], paginated */ ]
}
```

### 3.3 Apply — the four rules that matter

1. **Atomic per chunk.** Today apply is three independent statements (upsert
   `transactions`, update `raw_transactions.classified`, write audit). A crash
   between them leaves posted ledger rows whose raw rows still read
   unclassified — they get re-offered and only the checksum conflict saves you.
   The new backend wraps chunk work in one DB transaction (or one server-side
   function/RPC).
2. **Idempotent.** `idempotency_key` is stored on the run. A replay returns the
   original run instead of re-posting. Keep the content checksum + `ON CONFLICT
   DO NOTHING` on the ledger as the second line of defence.
3. **Chunked, bounded.** Keep the 500-row chunk from
   [bulkClassifyTransactions](../../actions/transactions.ts#L208) — it exists
   because per-row classification caused thousands of serial round-trips and
   timed the origin out. Runs above a threshold (say 2 000 rows) enqueue a job
   and return `202` with a run id.
4. **Fail the batch, not the row, on period close.** Current behaviour rejects
   the whole batch if any row lands in a closed period. Keep it, but return
   which rows offended so the caller can deselect them — and surface them as
   `PERIOD_CLOSED` in preview so it never reaches apply.

### 3.4 Run record

Replaces `{ tagged, skipped }`:

```
classification_runs
  id, actor_user_id, started_at, finished_at,
  status ('running'|'succeeded'|'failed'|'partial'),
  selector jsonb, options jsonb, idempotency_key unique,
  counts jsonb, error text

classification_run_items
  run_id, txn_id, rule_ids uuid[], account_id, entity_id,
  outcome ('posted'|'labelled'|'skipped'|'failed'),
  skip_reason text, posted_txn_id
```

This buys three things you can't get today: **undo** (revert a run by its
items), **explainability** (why did this row land in 6110? → rule ids), and
**rule hygiene** (rules with `match_count = 0` after six months are dead).

---

## 4. HTTP surface

| Op | Method + path | Role | Notes |
|---|---|---|---|
| List rules | `GET /classification-rules` | any auth | `?active=`, `?account_id=`; includes computed `category`, `match_count`, `compile_error` |
| Get rule | `GET /classification-rules/:id` | any auth | |
| Create rule | `POST /classification-rules` | bookkeeper, cpa, admin | validates conditions + compiles regex before insert |
| Update rule | `PATCH /classification-rules/:id` | bookkeeper, cpa, admin | partial; `If-Match` on `updated_at` |
| Delete rule | `DELETE /classification-rules/:id` | bookkeeper, cpa, admin | soft-delete (`is_active=false`) preferred; hard delete only if `match_count = 0` |
| Reorder | `POST /classification-rules/reorder` | bookkeeper, cpa, admin | `[{id, priority}]` in one transaction |
| **Test a rule** | `POST /classification-rules/:id/test` | bookkeeper, cpa, admin | body: literal strings **or** a filter; returns matches + sample; **no writes** |
| **Preview** | `POST /classification/preview` | bookkeeper, cpa, admin | dry run, no writes, read-only role is enough |
| **Apply** | `POST /classification/apply` | bookkeeper, admin | `202` + run id when queued |
| Run status | `GET /classification/runs/:id` | bookkeeper, admin | `?items=` paginated |
| Undo run | `POST /classification/runs/:id/undo` | bookkeeper, admin | unposts items whose ledger rows are untouched since |
| Manual classify | `POST /transactions/:id/classify` | bookkeeper, admin | human override; records `source: 'manual'` for the learn loop |

Two role notes carried over from the audit in APIs-Needed.md §5: **preview must
not require write access** (a CPA should be able to see what a run would do),
and **every endpoint re-checks its role** — there is no page-level gate in a
decoupled backend, and RLS is still off.

---

## 5. Storage

```sql
-- 0022_classification_rules_v2.sql (sketch)

alter table classification_rules
  add column if not exists description   text,
  add column if not exists priority      integer not null default 100,
  add column if not exists scope         jsonb   not null default '{}'::jsonb,
  add column if not exists conditions    jsonb,          -- Condition[]
  add column if not exists match_mode    text    not null default 'all'
    check (match_mode in ('all','any')),
  add column if not exists action        jsonb   not null default '{}'::jsonb,
  add column if not exists vendor_id     uuid references vendors(id),
  add column if not exists kind          text
    check (kind in ('transfer','cc_payment','settlement')),
  add column if not exists match_count   integer not null default 0,
  add column if not exists last_matched_at timestamptz,
  add column if not exists created_by    uuid,
  add column if not exists updated_by    uuid,
  add column if not exists updated_at    timestamptz;

-- Backfill: every legacy row is a one-condition description rule.
update classification_rules
set conditions = jsonb_build_array(
      jsonb_build_object(
        'field', 'description',
        'op', case when pattern like '/%' then 'regex' else 'contains' end,
        'value', pattern))
where conditions is null;

-- `name` stays NOT NULL and keeps holding the mirrored pattern for legacy rows;
-- new rules set a real name. Do NOT drop `pattern` yet — keep it as the
-- denormalized display string until the old UI is retired, then drop in 0023.

create index if not exists classification_rules_eval_idx
  on classification_rules (priority, created_at) where is_active;
```

Keeping `pattern` through one release means the current
[RulesClient](../../app/(app)/admin/rules/RulesClient.tsx) keeps working while
the new backend is built — no flag-day cutover.

---

## 6. Phasing

**Phase 1 — extract, don't extend.** Lift `lib/classify-rules.ts` into a pure
engine module behind `evaluate()` / `evaluateBatch()`, returning `Decision` with
typed `skip_reason`. Keep the single-condition rule shape. Wire the existing
Server Actions to it and surface the skip breakdown in the inbox. *No schema
change; immediate operator value from the breakdown alone.*

**Phase 2 — generalize the rule.** Migration 0022, multi-condition + scope +
priority, `vendor_id` becomes real, `detectTxnKind`'s arrays get seeded as
kind-rules. Rules admin UI grows a condition builder and a **Test** button.

**Phase 3 — the run pipeline.** `preview` / `apply` / runs / undo, apply wrapped
in one transaction, idempotency keys, jobs for large runs.

**Phase 4 — learn.** Every manual classify emits a candidate: longest common
normalized token-run across recent manual picks for the same account, offered as
"3 similar txns went to 6110 — create a rule?" Human-confirmed only; never
auto-create rules.

---

## 7. Invariants

- The engine is **pure**: same inputs → same outputs, no clock, no I/O. It is
  the only place matching logic lives; no adapter re-implements it.
- **Rule order is total and stable.** No two rules can tie.
- **Preview never writes. Apply writes only `status: 'ready'` rows.**
- Placement in the financial statements is derived from
  `accounts.account_type`, **never** stored on the rule.
- A rule that cannot compile is reported, not silently inert.
- Every write is audited with the actor; every apply belongs to a run.
- Closed periods are checked in preview *and* re-checked inside apply — the
  period can close between the two.
