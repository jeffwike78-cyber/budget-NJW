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

// Net spending per category: purchases add, known refunds/returns subtract,
// everything else negative (income, transfers) is ignored — it was never
// spending in that category to begin with.
export function netSpentByCategory(transactions) {
  const totals = {};
  for (const t of transactions) {
    if (t.excluded || t.business) continue; // not real household spending (ignored, or a business/rental expense tracked elsewhere)
    const amount = Number(t.amount);
    if (amount > 0) {
      totals[t.categoryId] = (totals[t.categoryId] || 0) + amount;
    } else if (isKnownRefund(t.description)) {
      totals[t.categoryId] = (totals[t.categoryId] || 0) + amount; // negative, nets the total down
    }
  }
  return totals;
}
