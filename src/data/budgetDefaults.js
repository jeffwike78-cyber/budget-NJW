// ---------------------------------------------------------------------------
// Your budget, as a starting point. Everything here can be edited inside the
// app (add/rename/delete accounts and envelopes, change amounts, set due
// dates) — this file is just what loads the very first time, before anything
// is saved to the database.
// ---------------------------------------------------------------------------

export const DEFAULT_ACCOUNTS = [
  { id: 'checking', name: 'Main Checking', type: 'checking', balance: 0 },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 0 },
  { id: 'emergency', name: 'Emergency Fund', type: 'savings', balance: 0 },
  { id: 'wall-street', name: '1427 Wall Street (rental)', type: 'checking', balance: 0 },
  { id: 'stophlet', name: '1331 Stophlet (rental)', type: 'checking', balance: 0 },
];

// Regular monthly envelopes. Each budgets a flat dollar amount every month
// ('fixed'). You can switch any of them to '% of income' or "whatever's left"
// inside the app. `group` just controls how they're grouped visually.
//
// Amounts are seeded from your monthly cash & spending plan — tweak any of
// them in the app as your real numbers shift.
export const DEFAULT_CATEGORIES = [
  // Giving
  { id: 'tithe', name: 'Tithe / GCU', group: 'Giving', budgetType: 'fixed', budgetValue: 625 },
  { id: 'service', name: 'Service / Generosity', group: 'Giving', budgetType: 'fixed', budgetValue: 500 },
  { id: 'center', name: 'The Center', group: 'Giving', budgetType: 'fixed', budgetValue: 100 },
  { id: 'blackhawk', name: 'Blackhawk', group: 'Giving', budgetType: 'fixed', budgetValue: 83 },

  // Saving
  { id: 'emergency-fund', name: 'Emergency Fund', group: 'Saving', budgetType: 'fixed', budgetValue: 200 },

  // Housing
  { id: 'mortgage', name: 'Countrywood Mortgage', group: 'Housing', budgetType: 'fixed', budgetValue: 1570 },
  { id: 'repairs-predictable', name: 'Repairs / Maintenance', group: 'Housing', budgetType: 'fixed', budgetValue: 167 },
  { id: 'repairs-unknown', name: 'Repairs (unexpected)', group: 'Housing', budgetType: 'fixed', budgetValue: 100 },
  { id: 'electric', name: 'Electric', group: 'Housing', budgetType: 'fixed', budgetValue: 165 },
  { id: 'gas-utility', name: 'Gas (home)', group: 'Housing', budgetType: 'fixed', budgetValue: 65 },
  { id: 'city-utilities', name: 'City Utilities', group: 'Housing', budgetType: 'fixed', budgetValue: 100 },
  { id: 'internet', name: 'Internet', group: 'Housing', budgetType: 'fixed', budgetValue: 80 },
  { id: 'cell-phone', name: 'Cell Phones', group: 'Housing', budgetType: 'fixed', budgetValue: 245 },
  { id: 'spa', name: 'Spa', group: 'Housing', budgetType: 'fixed', budgetValue: 65 },

  // Food
  { id: 'groceries', name: 'Groceries', group: 'Food', budgetType: 'fixed', budgetValue: 800 },
  { id: 'caleb-grocery', name: 'Caleb Grocery $', group: 'Food', budgetType: 'fixed', budgetValue: 200 },
  { id: 'restaurants', name: 'Restaurants / Carry Out', group: 'Food', budgetType: 'fixed', budgetValue: 225 },
  { id: 'boys-lunches', name: 'Boys Lunches', group: 'Food', budgetType: 'fixed', budgetValue: 70 },

  // Clothing
  { id: 'boys-clothing', name: 'Boys Clothing', group: 'Clothing', budgetType: 'fixed', budgetValue: 150 },
  { id: 'laundry', name: 'Cleaning / Laundry', group: 'Clothing', budgetType: 'fixed', budgetValue: 10 },

  // Transportation
  { id: 'auto-gas', name: 'Gas (auto)', group: 'Transportation', budgetType: 'fixed', budgetValue: 450 },
  { id: 'auto-repairs', name: 'Auto Repairs', group: 'Transportation', budgetType: 'fixed', budgetValue: 500 },

  // Medical / Health
  { id: 'fitness', name: 'Fitness Membership', group: 'Medical / Health', budgetType: 'fixed', budgetValue: 65 },
  { id: 'fitness-misc', name: 'Fitness Misc.', group: 'Medical / Health', budgetType: 'fixed', budgetValue: 84 },
  { id: 'medical-bills', name: 'Medical Bills', group: 'Medical / Health', budgetType: 'fixed', budgetValue: 200 },

  // Insurance
  { id: 'health-insurance', name: 'Health Insurance', group: 'Insurance', budgetType: 'fixed', budgetValue: 524 },

  // Miscellaneous
  { id: 'subscriptions', name: 'Subscriptions', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 96 },
  { id: 'misc', name: 'Miscellaneous', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 350 },
  { id: 'gifts', name: 'Gifts', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 250 },
  { id: 'dogs', name: 'Dogs', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 120 },
  { id: 'decor', name: 'Décor', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 35 },
  { id: 'boys-working', name: 'Boys Working', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 150 },
  { id: 'entertainment', name: 'Entertainment / Activities', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 175 },
  { id: 'jeff-spending', name: 'Jeff Spending', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 200 },
  { id: 'kari-spending', name: 'Kari Spending', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 200 },
  { id: 'noah-support', name: 'Noah Support', group: 'Miscellaneous', budgetType: 'fixed', budgetValue: 50 },

  // Recreation / Travel
  { id: 'fwu-travel', name: 'FWU Travel Expenses', group: 'Recreation / Travel', budgetType: 'fixed', budgetValue: 250 },
  { id: 'sports-camps', name: 'Sports / Camps', group: 'Recreation / Travel', budgetType: 'fixed', budgetValue: 75 },
  { id: 'noah-travel', name: 'Noah Travel', group: 'Recreation / Travel', budgetType: 'fixed', budgetValue: 100 },

  // Always keep this one last — it's where unclear transactions land until you
  // sort them. It's a flag, not a spending target.
  { id: 'needs-review', name: 'Needs Review', group: 'Other', budgetType: 'fixed', budgetValue: 0 },
];

// ---------------------------------------------------------------------------
// Sinking funds: the irregular (semi-annual / annual / seasonal) bills you
// used to stuff cash into envelopes for. Each one has a target amount, a due
// date, and how often it recurs. The app figures out how much to set aside
// each month so the money is there when the bill hits — and warns you when a
// fund is going to come up short.
//
//   targetAmount      — what you owe when the bill comes due
//   frequency         — 'annual' | 'semiannual' | 'quarterly' | 'monthly'
//   nextDueDate       — when the next payment is due (YYYY-MM-DD)
//   balance           — how much is already set aside right now
//
// ⚠️ The due dates below are best-guess placeholders (except the December 13th
// mortgage payment). Open each fund in the app and set your REAL renewal /
// due date — the whole "will I have the cash in time?" calculation depends on
// it.
// ---------------------------------------------------------------------------
export const DEFAULT_SINKING_FUNDS = [
  { id: 'sf-13th-mortgage', name: '13th Mortgage Payment', group: 'Housing', targetAmount: 1570, frequency: 'annual', nextDueDate: '2026-12-13', balance: 0 },
  { id: 'sf-auto-insurance', name: 'Auto Insurance', group: 'Insurance', targetAmount: 1050, frequency: 'semiannual', nextDueDate: '2027-01-15', balance: 0 },
  { id: 'sf-life-jeff', name: 'Life Insurance — Jeff (term)', group: 'Insurance', targetAmount: 700, frequency: 'annual', nextDueDate: '2027-01-15', balance: 0 },
  { id: 'sf-life-kari', name: 'Life Insurance — Kari / boys', group: 'Insurance', targetAmount: 144, frequency: 'annual', nextDueDate: '2027-01-15', balance: 0 },
  { id: 'sf-hoa', name: 'HOA Dues', group: 'Housing', targetAmount: 175, frequency: 'annual', nextDueDate: '2027-01-15', balance: 0 },
  { id: 'sf-license-taxes', name: 'Vehicle License / Taxes', group: 'Transportation', targetAmount: 750, frequency: 'annual', nextDueDate: '2027-03-01', balance: 0 },
  { id: 'sf-vacation', name: 'Vacation', group: 'Recreation / Travel', targetAmount: 10000, frequency: 'annual', nextDueDate: '2027-06-01', balance: 0 },
  { id: 'sf-bluegreen', name: 'Bluegreen Dues', group: 'Recreation / Travel', targetAmount: 1310, frequency: 'annual', nextDueDate: '2027-01-15', balance: 0 },
];

// Your take-home pay, used to show how much of your income is left after every
// envelope is funded. Seeded as a single monthly figure (your ~$11,168/mo
// take-home). You can change this in the app under Budget → Income.
export const DEFAULT_INCOME = {
  paycheckAmount: 11168,
  frequency: 'monthly', // 'biweekly' | 'monthly'
};
