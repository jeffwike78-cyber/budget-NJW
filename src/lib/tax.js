// Tax buckets for the CPA report. The keys are stored on transactions
// (budget_transactions.tax_category); the labels are display-only and the
// business ones can be renamed (stored in budgetState.taxLabels).
export const TAX_CATEGORIES = ['charitable', 'medical', '529', 'business-1', 'business-2'];

export const DEFAULT_TAX_LABELS = {
  charitable: 'Charitable',
  medical: 'Medical',
  '529': '529 / Education',
  'business-1': 'Business 1',
  'business-2': 'Business 2',
};

// Buckets an envelope can auto-default to (personal deductions only — business
// buckets stay per-transaction because they also pull money out of the
// household budget). An envelope's taxDefault applies to every transaction in
// it unless that transaction has its own tax tag.
export const DEDUCTIBLE_DEFAULT_KEYS = ['charitable', 'medical', '529'];

// Sentinel stored on a transaction to mean "explicitly NOT deductible",
// overriding its envelope's tax default.
export const TAX_NONE = 'none';

export function taxLabel(key, labels) {
  if (!key || key === TAX_NONE) return '';
  return (labels && labels[key]) || DEFAULT_TAX_LABELS[key] || key;
}

// Business tax buckets are also excluded from the household budget (tracked
// as business expenses, not personal spending).
export function isBusinessTax(key) {
  return key === 'business-1' || key === 'business-2';
}

// A transaction's effective tax bucket: an explicit tag wins; TAX_NONE means
// the envelope default was turned off; otherwise it inherits the envelope's
// taxDefault. `catTaxDefaults` maps categoryId → that envelope's taxDefault.
export function effectiveTaxCategory(tx, catTaxDefaults) {
  const explicit = tx.taxCategory;
  if (explicit === TAX_NONE) return null;
  if (explicit) return explicit;
  return (catTaxDefaults && catTaxDefaults[tx.categoryId]) || null;
}

// Build the categoryId → taxDefault lookup from a budget's categories.
export function categoryTaxDefaults(categories) {
  const map = {};
  for (const c of categories || []) {
    if (c && c.taxDefault) map[c.id] = c.taxDefault;
  }
  return map;
}
