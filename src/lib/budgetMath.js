// The four kinds of envelope. `carryover` decides what happens to money left
// at month end: bills reset to their budget each month; everything else keeps
// its running balance (true cash-envelope behavior).
export const ENVELOPE_KINDS = [
  { value: 'bill', label: 'Monthly bill', carryover: false },
  { value: 'spending', label: 'Everyday spending', carryover: true },
  { value: 'sinking', label: 'Sinking fund', carryover: true },
  { value: 'transfer', label: 'Transfer to savings', carryover: true },
];

const KIND_CARRYOVER = Object.fromEntries(ENVELOPE_KINDS.map((k) => [k.value, k.carryover]));

export function isCarryover(kind) {
  return KIND_CARRYOVER[kind] ?? true; // unknown/legacy envelopes carry over
}

export function kindLabel(kind) {
  return ENVELOPE_KINDS.find((k) => k.value === kind)?.label || 'Everyday spending';
}

// Count of months from a 'YYYY-MM' start to a 'YYYY-MM' end, inclusive
// (both the start and current month count as funded). Never less than 1.
export function monthsInclusive(startMonth, currentMonth) {
  if (!startMonth || !currentMonth) return 1;
  const [sy, sm] = startMonth.split('-').map(Number);
  const [cy, cm] = currentMonth.split('-').map(Number);
  const n = (cy - sy) * 12 + (cm - sm) + 1;
  return Math.max(1, n);
}

// How many times a year each pay cadence lands.
const FREQ_PER_YEAR = {
  weekly: 52,
  biweekly: 26, // every 2 weeks
  semimonthly: 24, // twice a month
  monthly: 12,
  quarterly: 4,
  annual: 1,
  'one-time': 0, // doesn't recur — excluded from the monthly figure
};

export const INCOME_FREQUENCIES = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'annual', label: 'Yearly' },
  { value: 'one-time', label: 'One-time (not counted)' },
];

// Monthly-equivalent of a single income source (amount is per-payment).
export function sourceMonthly(source) {
  const amount = Number(source?.amount || 0);
  const perYear = FREQ_PER_YEAR[source?.frequency] ?? 12;
  return (amount * perYear) / 12;
}

// Legacy single-income shape ({ paycheckAmount, frequency }). Kept so saved
// state from before multi-source income still reads correctly.
export function monthlyIncome(income) {
  const amount = Number(income?.paycheckAmount || 0);
  return income?.frequency === 'biweekly' ? amount * (26 / 12) : amount;
}

// Total monthly income across all sources, preferring the new incomeSources
// list and falling back to the legacy single income.
export function monthlyIncomeTotal(state) {
  if (Array.isArray(state?.incomeSources) && state.incomeSources.length > 0) {
    return state.incomeSources.reduce((sum, src) => sum + sourceMonthly(src), 0);
  }
  return monthlyIncome(state?.income);
}

// The running "available" balance for each envelope, honoring its kind:
//   - bills reset every month → available = this month's budget − spent this month
//   - carryover envelopes keep a rolling balance → available =
//       opening balance + (budget funded each month since the start) − all spending
// `spentAll` / `spentMonth` are category→dollars maps (see netSpentByCategory).
export function envelopeBalances(categories, effectiveBudgets, spentAll, spentMonth, startMonth, currentMonth) {
  const monthsFunded = monthsInclusive(startMonth, currentMonth);
  const out = {};
  for (const c of categories) {
    const budget = Number(effectiveBudgets[c.id] || 0);
    const carry = isCarryover(c.kind);
    const spentThisMonth = Number(spentMonth[c.id] || 0);
    if (carry) {
      const opening = Number(c.openingBalance || 0);
      const funded = opening + budget * monthsFunded;
      const spentToDate = Number(spentAll[c.id] || 0);
      out[c.id] = { carry: true, available: funded - spentToDate, spentThisMonth, budget };
    } else {
      out[c.id] = { carry: false, available: budget - spentThisMonth, spentThisMonth, budget };
    }
  }
  return out;
}

// Turns each category's budgetType/budgetValue into an actual dollar amount
// for the month: 'fixed' is as-typed, 'percent' is a share of income, and
// 'remainder' splits whatever's left of income after every fixed/percent
// category is accounted for (evenly, if more than one category uses it).
export function computeCategoryBudgets(categories, income) {
  const remainderCategories = categories.filter((c) => c.budgetType === 'remainder');
  const allocated = categories
    .filter((c) => c.budgetType !== 'remainder')
    .reduce((sum, c) => {
      const value = Number(c.budgetValue || 0);
      return sum + (c.budgetType === 'percent' ? (value / 100) * income : value);
    }, 0);
  const remainderShare = remainderCategories.length > 0 ? (income - allocated) / remainderCategories.length : 0;

  const budgets = {};
  for (const c of categories) {
    if (c.budgetType === 'percent') budgets[c.id] = (Number(c.budgetValue || 0) / 100) * income;
    else if (c.budgetType === 'remainder') budgets[c.id] = remainderShare;
    else budgets[c.id] = Number(c.budgetValue || 0);
  }
  return budgets;
}
