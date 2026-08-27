// Mirrors src/data/budgetDefaults.js — kept minimal here since this is only
// used to seed app_state.budget if a sync runs before the frontend ever has.
export const DEFAULT_ACCOUNTS = [
  { id: 'chase-checking', name: 'Chase Checking', type: 'checking', balance: 0 },
  { id: 'schwab', name: 'Schwab', type: 'investing', balance: 0 },
  { id: 'marcus-savings', name: 'Marcus by Goldman Sachs', type: 'savings', balance: 0 },
];

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
