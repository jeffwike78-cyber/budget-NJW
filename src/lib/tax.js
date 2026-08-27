// Tax buckets for the CPA report. The keys are stored on transactions
// (budget_transactions.tax_category); the labels are display-only and the
// business ones can be renamed (stored in budgetState.taxLabels).
export const TAX_CATEGORIES = ['charitable', 'medical', 'business-1', 'business-2'];

export const DEFAULT_TAX_LABELS = {
  charitable: 'Charitable',
  medical: 'Medical',
  'business-1': 'Business 1',
  'business-2': 'Business 2',
};

export function taxLabel(key, labels) {
  if (!key) return '';
  return (labels && labels[key]) || DEFAULT_TAX_LABELS[key] || key;
}

// Business tax buckets are also excluded from the household budget (tracked
// as business expenses, not personal spending).
export function isBusinessTax(key) {
  return key === 'business-1' || key === 'business-2';
}
