// The four kinds of envelope. `carryover` decides what happens to money left
// at month end: bills reset to their budget each month; everything else keeps
// its running balance (true cash-envelope behavior).
// carryover decides what happens to money left at month end:
//   bill      — a fixed monthly bill; resets to its budget each month
//   spending  — a monthly allowance spent down across many small buys
//               (gas, groceries); resets each month, does NOT accumulate
//   sinking   — saved up over time toward an irregular/larger expense;
//               leftover carries forward and the balance grows
//   transfer  — money moved out to another account (Jeff/Kari spending,
//               retirement, savings); carries forward
export const ENVELOPE_KINDS = [
  { value: 'bill', label: 'Monthly bill', carryover: false },
  { value: 'spending', label: 'Monthly spending', carryover: false },
  { value: 'sinking', label: 'Sinking fund', carryover: true },
  { value: 'transfer', label: 'Transfer to account', carryover: true },
];

const KIND_CARRYOVER = Object.fromEntries(ENVELOPE_KINDS.map((k) => [k.value, k.carryover]));

export function isCarryover(kind) {
  return KIND_CARRYOVER[kind] ?? true; // unknown/legacy envelopes carry over
}

export function kindLabel(kind) {
  return ENVELOPE_KINDS.find((k) => k.value === kind)?.label || 'Everyday spending';
}

// Money owed (a liability) is stored as a positive number, so for display and
// net-worth totals it counts as negative. This covers credit cards and manual
// liabilities (mortgage, auto/student loans). Everything else — cash, savings,
// investments, and manual assets like a home or vehicle — counts as-stored.
export function signedBalance(a) {
  const bal = Number(a?.balance || 0);
  return a?.type === 'credit' || a?.type === 'liability' ? -bal : bal;
}

// Manual asset/liability account types (net-worth items that aren't spendable
// cash and don't sync via Plaid).
export const LIABILITY_TYPES = ['credit', 'liability'];
export function isLiability(a) {
  return LIABILITY_TYPES.includes(a?.type);
}

// Whether an account counts toward "cash on hand" (the reconciliation banner).
// Defaults to checking + savings; a per-account `includeInCash` flag overrides
// so a specific account can be added to or removed from the calculation.
export function includeInCashOnHand(a) {
  if (a?.includeInCash != null) return !!a.includeInCash;
  return a?.type === 'checking' || a?.type === 'savings';
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

// The list of 'YYYY-MM' months from start to current, inclusive. Capped so a
// bad/empty start can never spin the loop forever.
export function monthsList(startMonth, currentMonth) {
  if (!startMonth || !currentMonth) return [currentMonth].filter(Boolean);
  const out = [];
  let [y, m] = startMonth.split('-').map(Number);
  const [cy, cm] = currentMonth.split('-').map(Number);
  for (let i = 0; i < 600; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (y > cy || (y === cy && m >= cm)) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// The budgeted amount for one category in one month: a per-month override if the
// user set one (settings.monthlyBudgets on the category), otherwise the base
// plan amount. An override is a fixed dollar figure; `null`/'' means no override.
export function budgetForMonth(category, baseBudgets, month) {
  const override = category?.monthlyBudgets?.[month];
  if (override != null && override !== '' && !Number.isNaN(Number(override))) return Number(override);
  return Number(baseBudgets?.[category.id] || 0);
}

// Per-category budgets for a specific month (base plan with any month override
// applied). Used for this-month display, totals, and "left to budget".
export function effectiveBudgetsForMonth(categories, baseBudgets, month) {
  const out = {};
  for (const c of categories) out[c.id] = budgetForMonth(c, baseBudgets, month);
  return out;
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

// Sum manual envelope adjustments (money moves) into per-category maps: one for
// everything up to and including the current month (for carryover balances) and
// one for just the current month (for monthly-reset envelopes). A positive
// amount adds money into the envelope; negative pulls it out.
export function adjustmentMaps(adjustments, currentMonth) {
  const all = {};
  const month = {};
  for (const a of adjustments || []) {
    const amt = Number(a?.amount || 0);
    if (!a?.categoryId || !amt) continue;
    const m = a.month || (a.createdAt ? String(a.createdAt).slice(0, 7) : currentMonth);
    // Only count adjustments dated on or before the month being viewed.
    if (m > currentMonth) continue;
    all[a.categoryId] = (all[a.categoryId] || 0) + amt;
    if (m === currentMonth) month[a.categoryId] = (month[a.categoryId] || 0) + amt;
  }
  return { all, month };
}

// The running "available" balance for each envelope, honoring its kind:
//   - bills reset every month → available = this month's budget − spent this month
//   - carryover envelopes keep a rolling balance → available =
//       opening balance + (budget funded each month since the start) − all spending
// `spentAll` / `spentMonth` are category→dollars maps (see netSpentByCategory).
// `adjustAll` / `adjustMonth` are manual money-move totals (see adjustmentMaps);
// they add to the balance without being treated as spending or income.
// `baseBudgets` is the base-plan amount per category (see computeCategoryBudgets).
// Carryover balances SUM each month's budget from the start — so a per-month
// override (or a revised base going forward) changes only the months it applies
// to, never rewriting a fund's already-accumulated history.
export function envelopeBalances(categories, baseBudgets, spentAll, spentMonth, startMonth, currentMonth, adjustAll = {}, adjustMonth = {}) {
  const months = monthsList(startMonth, currentMonth);
  const out = {};
  for (const c of categories) {
    const carry = isCarryover(c.kind);
    const spentThisMonth = Number(spentMonth[c.id] || 0);
    const budget = budgetForMonth(c, baseBudgets, currentMonth); // this month's effective amount
    if (carry) {
      const opening = Number(c.openingBalance || 0);
      const fundedFromBudget = months.reduce((sum, m) => sum + budgetForMonth(c, baseBudgets, m), 0);
      const funded = opening + fundedFromBudget + Number(adjustAll[c.id] || 0);
      const spentToDate = Number(spentAll[c.id] || 0);
      out[c.id] = { carry: true, available: funded - spentToDate, spentThisMonth, budget };
    } else {
      out[c.id] = { carry: false, available: budget + Number(adjustMonth[c.id] || 0) - spentThisMonth, spentThisMonth, budget };
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
