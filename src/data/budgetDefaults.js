// ---------------------------------------------------------------------------
// Your budget, as a starting point. Everything here can be edited inside the
// app (add/rename/delete accounts and envelopes, change amounts, set due
// dates) — this file is just what loads the very first time, before anything
// is saved to the database.
// ---------------------------------------------------------------------------

// The rentals are a business tracked elsewhere, so their accounts are NOT in
// the personal budget. Only the owner draw you pay yourselves counts (see the
// income sources below). Add a linked credit card here once Plaid is live.
export const DEFAULT_ACCOUNTS = [
  { id: 'checking', name: 'Main Checking', type: 'checking', balance: 0 },
  { id: 'savings', name: 'Savings', type: 'savings', balance: 0 },
  { id: 'emergency', name: 'Emergency Fund', type: 'savings', balance: 0 },
];

// Regular monthly envelopes. Each budgets a flat dollar amount every month
// ('fixed'). You can switch any of them to '% of income' or "whatever's left"
// inside the app. `group` just controls how they're grouped visually.
//
// Amounts are seeded from your monthly cash & spending plan — tweak any of
// them in the app as your real numbers shift.
// `kind` tags each envelope: 'bill' (fixed, resets monthly), 'spending'
// (variable, rolls its balance over), 'transfer' (money moved to another
// account, rolls over). Sinking funds live on their own page. You can retag
// any envelope in the app; these are just sensible starting points.
export const DEFAULT_CATEGORIES = [
  // Giving
  { id: 'tithe', name: 'Tithe / GCU', group: 'Giving', kind: 'bill', budgetType: 'fixed', budgetValue: 625 },
  { id: 'service', name: 'Service / Generosity', group: 'Giving', kind: 'spending', budgetType: 'fixed', budgetValue: 500 },
  { id: 'center', name: 'The Center', group: 'Giving', kind: 'bill', budgetType: 'fixed', budgetValue: 100 },
  { id: 'blackhawk', name: 'Blackhawk', group: 'Giving', kind: 'bill', budgetType: 'fixed', budgetValue: 83 },

  // Saving
  { id: 'emergency-fund', name: 'Emergency Fund', group: 'Saving', kind: 'transfer', budgetType: 'fixed', budgetValue: 200 },

  // Housing
  { id: 'mortgage', name: 'Countrywood Mortgage', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 1570 },
  { id: 'repairs-predictable', name: 'Repairs / Maintenance', group: 'Housing', kind: 'sinking', budgetType: 'fixed', budgetValue: 167 },
  { id: 'repairs-unknown', name: 'Repairs (unexpected)', group: 'Housing', kind: 'sinking', budgetType: 'fixed', budgetValue: 100 },
  { id: 'electric', name: 'Electric', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 165 },
  { id: 'gas-utility', name: 'Gas (home)', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 65 },
  { id: 'city-utilities', name: 'City Utilities', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 100 },
  { id: 'internet', name: 'Internet', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 80 },
  { id: 'cell-phone', name: 'Cell Phones', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 245 },
  { id: 'spa', name: 'Spa', group: 'Housing', kind: 'bill', budgetType: 'fixed', budgetValue: 65 },

  // Food
  { id: 'groceries', name: 'Groceries', group: 'Food', kind: 'spending', budgetType: 'fixed', budgetValue: 800 },
  { id: 'caleb-grocery', name: 'Caleb Grocery $', group: 'Food', kind: 'spending', budgetType: 'fixed', budgetValue: 200 },
  { id: 'restaurants', name: 'Restaurants / Carry Out', group: 'Food', kind: 'spending', budgetType: 'fixed', budgetValue: 225 },
  { id: 'boys-lunches', name: 'Boys Lunches', group: 'Food', kind: 'spending', budgetType: 'fixed', budgetValue: 70 },

  // Clothing
  { id: 'boys-clothing', name: 'Boys Clothing', group: 'Clothing', kind: 'spending', budgetType: 'fixed', budgetValue: 150 },
  { id: 'laundry', name: 'Cleaning / Laundry', group: 'Clothing', kind: 'spending', budgetType: 'fixed', budgetValue: 10 },

  // Transportation
  { id: 'auto-gas', name: 'Gas (auto)', group: 'Transportation', kind: 'spending', budgetType: 'fixed', budgetValue: 450 },
  { id: 'auto-repairs', name: 'Auto Repairs', group: 'Transportation', kind: 'sinking', budgetType: 'fixed', budgetValue: 500 },

  // Medical / Health
  { id: 'fitness', name: 'Fitness Membership', group: 'Medical / Health', kind: 'bill', budgetType: 'fixed', budgetValue: 65 },
  { id: 'fitness-misc', name: 'Fitness Misc.', group: 'Medical / Health', kind: 'spending', budgetType: 'fixed', budgetValue: 84 },
  { id: 'medical-bills', name: 'Medical Bills', group: 'Medical / Health', kind: 'spending', budgetType: 'fixed', budgetValue: 200 },

  // Insurance
  { id: 'health-insurance', name: 'Health Insurance', group: 'Insurance', kind: 'bill', budgetType: 'fixed', budgetValue: 524 },

  // Miscellaneous
  { id: 'subscriptions', name: 'Subscriptions', group: 'Miscellaneous', kind: 'bill', budgetType: 'fixed', budgetValue: 96 },
  { id: 'misc', name: 'Miscellaneous', group: 'Miscellaneous', kind: 'spending', budgetType: 'fixed', budgetValue: 350 },
  { id: 'gifts', name: 'Gifts', group: 'Miscellaneous', kind: 'sinking', budgetType: 'fixed', budgetValue: 250 },
  { id: 'dogs', name: 'Dogs', group: 'Miscellaneous', kind: 'spending', budgetType: 'fixed', budgetValue: 120 },
  { id: 'decor', name: 'Décor', group: 'Miscellaneous', kind: 'spending', budgetType: 'fixed', budgetValue: 35 },
  { id: 'boys-working', name: 'Boys Working', group: 'Miscellaneous', kind: 'spending', budgetType: 'fixed', budgetValue: 150 },
  { id: 'entertainment', name: 'Entertainment / Activities', group: 'Miscellaneous', kind: 'spending', budgetType: 'fixed', budgetValue: 175 },
  { id: 'jeff-spending', name: 'Jeff Spending', group: 'Miscellaneous', kind: 'transfer', budgetType: 'fixed', budgetValue: 200 },
  { id: 'kari-spending', name: 'Kari Spending', group: 'Miscellaneous', kind: 'transfer', budgetType: 'fixed', budgetValue: 200 },
  { id: 'noah-support', name: 'Noah Support', group: 'Miscellaneous', kind: 'bill', budgetType: 'fixed', budgetValue: 50 },

  // Recreation / Travel
  { id: 'fwu-travel', name: 'FWU Travel Expenses', group: 'Recreation / Travel', kind: 'spending', budgetType: 'fixed', budgetValue: 250 },
  { id: 'sports-camps', name: 'Sports / Camps', group: 'Recreation / Travel', kind: 'spending', budgetType: 'fixed', budgetValue: 75 },
  { id: 'noah-travel', name: 'Noah Travel', group: 'Recreation / Travel', kind: 'spending', budgetType: 'fixed', budgetValue: 100 },

  // Sinking funds — irregular/annual bills you save toward. They're sinking-kind
  // envelopes (so they live in the Budget and carry their balance forward), and
  // they carry a target, a due date, and how often the bill recurs so the
  // Funds tab can show "on track / behind". budgetValue is the monthly set-aside
  // (≈ target ÷ months in the cycle) — tweak it, and set your REAL due dates.
  { id: 'sf-13th-mortgage', name: '13th Mortgage Payment', group: 'Housing', kind: 'sinking', budgetType: 'fixed', budgetValue: 131, openingBalance: 0, targetAmount: 1570, frequency: 'annual', nextDueDate: '2026-12-13' },
  { id: 'sf-auto-insurance', name: 'Auto Insurance', group: 'Insurance', kind: 'sinking', budgetType: 'fixed', budgetValue: 175, openingBalance: 0, targetAmount: 1050, frequency: 'semiannual', nextDueDate: '2027-01-15' },
  { id: 'sf-life-jeff', name: 'Life Insurance — Jeff (term)', group: 'Insurance', kind: 'sinking', budgetType: 'fixed', budgetValue: 58, openingBalance: 0, targetAmount: 700, frequency: 'annual', nextDueDate: '2027-01-15' },
  { id: 'sf-life-kari', name: 'Life Insurance — Kari / boys', group: 'Insurance', kind: 'sinking', budgetType: 'fixed', budgetValue: 12, openingBalance: 0, targetAmount: 144, frequency: 'annual', nextDueDate: '2027-01-15' },
  { id: 'sf-hoa', name: 'HOA Dues', group: 'Housing', kind: 'sinking', budgetType: 'fixed', budgetValue: 15, openingBalance: 0, targetAmount: 175, frequency: 'annual', nextDueDate: '2027-01-15' },
  { id: 'sf-license-taxes', name: 'Vehicle License / Taxes', group: 'Transportation', kind: 'sinking', budgetType: 'fixed', budgetValue: 63, openingBalance: 0, targetAmount: 750, frequency: 'annual', nextDueDate: '2027-03-01' },
  { id: 'sf-vacation', name: 'Vacation', group: 'Recreation / Travel', kind: 'sinking', budgetType: 'fixed', budgetValue: 833, openingBalance: 0, targetAmount: 10000, frequency: 'annual', nextDueDate: '2027-06-01' },
  { id: 'sf-bluegreen', name: 'Bluegreen Dues', group: 'Recreation / Travel', kind: 'sinking', budgetType: 'fixed', budgetValue: 109, openingBalance: 0, targetAmount: 1310, frequency: 'annual', nextDueDate: '2027-01-15' },

  // Always keep this one last — it's where unclear transactions land until you
  // sort them. It's a flag, not a spending target.
  { id: 'needs-review', name: 'Needs Review', group: 'Other', kind: 'spending', budgetType: 'fixed', budgetValue: 0 },
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
// Sinking funds are now sinking-kind envelopes (see DEFAULT_CATEGORIES) so they
// live in the Budget and the Funds tab tracks them live. This legacy array is
// kept empty for backward compatibility with saved state that referenced it.
export const DEFAULT_SINKING_FUNDS = [];

// Your income sources. Each lands on its own cadence — add/rename/remove them
// in the app under Budget → Income. The app sums their monthly-equivalent to
// show how much of your income is left after every envelope is funded.
//   frequency: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly' | 'quarterly' | 'annual' | 'one-time'
// Only the money that actually reaches your personal budget counts here. The
// rentals are tracked as a business elsewhere, so instead of their gross rent
// we count the owner draw you pay yourselves. Set that amount to what you
// really take each month (0 = set it in the app under Budget → Income).
export const DEFAULT_INCOME_SOURCES = [
  { id: 'inc-jeff', name: 'Jeff paycheck', amount: 3767, frequency: 'semimonthly' },
  { id: 'inc-kari', name: 'Kari FLOW', amount: 900, frequency: 'monthly' },
  { id: 'inc-rental-draw', name: 'Rental owner draw', amount: 0, frequency: 'monthly' },
];

// Legacy single-income shape, kept only so state saved before multi-source
// income still reads. New setups use DEFAULT_INCOME_SOURCES above.
export const DEFAULT_INCOME = {
  paycheckAmount: 11168,
  frequency: 'monthly',
};

// Labels for money coming IN (deposits). Unlike envelopes, these don't affect
// any budget — they're just how you tag a deposit (paycheck vs. a one-off extra)
// for your own reporting. Rename/add/remove them in Settings.
export const DEFAULT_INCOME_CATEGORIES = [
  { id: 'inc-paycheck', name: 'Paycheck' },
  { id: 'inc-misc', name: 'Miscellaneous Income' },
  { id: 'inc-reimbursement', name: 'Reimbursement' },
  { id: 'inc-gift', name: 'Gift / Other' },
];
