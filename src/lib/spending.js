// Negative amounts (Plaid: negative = money in) are either a refund/return of
// a specific earlier purchase, or unrelated money landing in the account
// (payroll, wire transfers, self-transfers between the user's own accounts).
// Only the first kind should net against its category's spending — netting
// the second kind would make that category look like it has far more room
// than it actually does. There's no reliable signal from Plaid linking a
// credit back to the debit it reverses, so this is an explicit, known list
// (mirrors OVERRIDE_RULES in supabase/functions/_shared/syncTransactions.ts)
// rather than a fuzzy "same first word" guess — a guess like that would, for
// example, match "CASH APP*YOUR NAME" (a self-transfer) against "CASH APP*
// DOORDASH" (a real purchase) just because both start with "CASH".
//
// Starts empty — add your own merchant patterns here as you notice refunds
// that should net against their category (e.g. /whoop/i for a returned
// subscription charge, or a specific person's name for a shared-expense
// reimbursement), the same way this list started for the original build.
const REFUND_PATTERNS = [];

function isKnownRefund(description) {
  return REFUND_PATTERNS.some((pattern) => pattern.test(description || ''));
}

function asSet(ids) {
  if (ids == null) return null;
  return ids instanceof Set ? ids : new Set(ids);
}

// The spending-envelope ids (everything the user can budget to, minus the
// Needs-review bucket). Assigning a refund to one of these is the explicit
// signal that it reverses a purchase there.
export function spendingCategoryIds(budgetState) {
  return new Set((budgetState?.categories || []).map((c) => c.id).filter((id) => id && id !== 'needs-review'));
}

// A credit the user filed against a spending envelope — a refund/return that
// reverses a purchase there, not real income. `spendingIds` is the set (or
// list) from spendingCategoryIds.
export function isEnvelopeCredit(t, spendingIds) {
  if (!(Number(t.amount) < 0) || t.excluded) return false;
  const set = asSet(spendingIds);
  return !!set && set.has(t.categoryId);
}

// Net spending per category: purchases add, refunds/returns subtract,
// everything else negative (income, transfers) is ignored — it was never
// spending in that category to begin with. A negative amount counts as a
// credit against its envelope when the user assigned it to a spending envelope
// (pass `spendingIds`); without that list it falls back to the known-pattern
// match, so older callers behave as before.
export function netSpentByCategory(transactions, spendingIds = null) {
  const set = asSet(spendingIds);
  const totals = {};
  for (const t of transactions) {
    // Not real household spending: ignored, an AI-flagged business expense, or
    // tagged to a business tax bucket (tracked elsewhere).
    if (t.excluded || t.business || t.taxCategory === 'business-1' || t.taxCategory === 'business-2') continue;
    const amount = Number(t.amount);
    if (amount > 0) {
      totals[t.categoryId] = (totals[t.categoryId] || 0) + amount;
    } else if (amount < 0) {
      const credit = set ? set.has(t.categoryId) : isKnownRefund(t.description);
      if (credit) totals[t.categoryId] = (totals[t.categoryId] || 0) + amount; // negative, nets the total down
    }
  }
  return totals;
}
