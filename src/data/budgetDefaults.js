export const DEFAULT_ACCOUNTS = [
  { id: 'chase-checking', name: 'Chase Checking', type: 'checking', balance: 0 },
  { id: 'schwab', name: 'Schwab', type: 'investing', balance: 0 },
  { id: 'marcus-savings', name: 'Marcus by Goldman Sachs', type: 'savings', balance: 0 },
];

// Each category budgets one of three ways:
//   'fixed'     — a flat dollar amount every month (e.g. rent)
//   'percent'   — a % of that month's income (e.g. tithing, savings)
//   'remainder' — whatever's left of income after every other category is
//                 accounted for (splits evenly if more than one category uses it)
export const DEFAULT_CATEGORIES = [
  { id: 'housing', name: 'Rent / Housing', budgetType: 'fixed', budgetValue: 0 },
  { id: 'utilities', name: 'Utilities', budgetType: 'fixed', budgetValue: 0 },
  { id: 'groceries', name: 'Groceries', budgetType: 'fixed', budgetValue: 0 },
  { id: 'transportation', name: 'Transportation / Gas', budgetType: 'fixed', budgetValue: 0 },
  { id: 'tithing', name: 'Tithing', budgetType: 'percent', budgetValue: 0 },
  { id: 'subscriptions', name: 'Subscriptions', budgetType: 'fixed', budgetValue: 0 },
  { id: 'savings-goal', name: 'Savings Transfer', budgetType: 'fixed', budgetValue: 0 },
  { id: 'roth-ira', name: 'Roth IRA', budgetType: 'fixed', budgetValue: 0 },
  { id: 'personal', name: 'Personal / Miscellaneous', budgetType: 'fixed', budgetValue: 0 },
  { id: 'needs-review', name: 'Needs Review', budgetType: 'fixed', budgetValue: 0 },
];

// Income isn't tied to a category — it's a single paycheck-based estimate
// used to show how much of your pay is left after budgeted categories.
export const DEFAULT_INCOME = {
  paycheckAmount: 0,
  frequency: 'biweekly', // 'biweekly' | 'monthly'
};
