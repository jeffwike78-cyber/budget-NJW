// Biweekly (every 2 weeks) pays out 26 times a year, not 24 — so most months
// get 2 paychecks but a couple get 3. Averaging over the full year (26/12)
// gives a steadier monthly figure than just multiplying by 2.
export function monthlyIncome(income) {
  const amount = Number(income?.paycheckAmount || 0);
  return income?.frequency === 'biweekly' ? amount * (26 / 12) : amount;
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
