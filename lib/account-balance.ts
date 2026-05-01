/**
 * Account-balance computations.
 *
 * Convention from legacy:
 *   - `transactions.amount` is signed: negative = DEBIT (expense / asset
 *     increase), positive = CREDIT (revenue / liability increase). This
 *     mirrors how `fetchReportData()` returns rows.
 *   - `ledger_entries` stores explicit debit_amount + credit_amount.
 *
 * Use `signedAmountFor()` to project either source onto a unified
 *   normal-balance amount: positive when a row INCREASES the account
 *   from the perspective of its `normal_balance`.
 */

import type { Account, LedgerEntry, Transaction } from "./supabase/types";

export type SignedTxn = Pick<Transaction, "amount" | "account_id">;

/**
 * For a transaction row + the account it's posted to, return the
 * amount in the account's normal-balance direction. For a DEBIT-normal
 * account, debits are positive. For a CREDIT-normal account, credits
 * are positive.
 *
 * Legacy stores `amount` as signed (negative = expense). A debit-normal
 * account (asset/expense) treats negative `amount` as an increase, so
 * we flip the sign.
 */
export function signedAmountFor(
  amount: number,
  normal: Account["normal_balance"],
): number {
  return normal === "DEBIT" ? -amount : amount;
}

/** Sum a list of `transactions` rows for one account. */
export function sumTxnsForAccount(
  account: Account,
  txns: readonly SignedTxn[],
): number {
  let total = 0;
  for (const t of txns) {
    if (t.account_id !== account.id) continue;
    total += signedAmountFor(Number(t.amount ?? 0), account.normal_balance);
  }
  return total;
}

/** Sum ledger lines (debit_amount/credit_amount) for one account. */
export function sumLedgerForAccount(
  account: Account,
  entries: readonly Pick<LedgerEntry, "account_id" | "debit_amount" | "credit_amount">[],
): number {
  let total = 0;
  for (const e of entries) {
    if (e.account_id !== account.id) continue;
    const debit = Number(e.debit_amount ?? 0);
    const credit = Number(e.credit_amount ?? 0);
    total +=
      account.normal_balance === "DEBIT"
        ? debit - credit
        : credit - debit;
  }
  return total;
}

export function totalForAccountType(
  accounts: readonly Account[],
  type: Account["account_type"],
  txns: readonly SignedTxn[],
): number {
  let total = 0;
  for (const a of accounts) {
    if (a.account_type !== type) continue;
    if (!a.is_active) continue;
    total += sumTxnsForAccount(a, txns);
  }
  return total;
}

/** Net income = revenue - expense (using normal-balance projection). */
export function netIncome(
  accounts: readonly Account[],
  txns: readonly SignedTxn[],
): number {
  return (
    totalForAccountType(accounts, "revenue", txns) -
    totalForAccountType(accounts, "expense", txns)
  );
}
