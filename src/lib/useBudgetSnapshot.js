import { useEffect, useRef } from 'react';
import { monthlyIncomeTotal, computeCategoryBudgets, effectiveBudgetsForMonth } from './budgetMath';

// Freeze each month's budget plan so the monthly Summary can compare actuals
// against the plan THAT MONTH actually had — not whatever the living plan says
// now. Without this, editing next month's budget retroactively changes how a
// prior month looks (the base plan is a single shared value per category).
//
// Behavior mirrors useNetWorthSnapshot: while the app is open we keep THIS
// month's snapshot refreshed to the live plan; a past month is never rewritten,
// so once the month rolls over its plan is frozen. The current month always
// reads live in the Summary, so only completed months rely on the frozen copy.
// Writes go through the normal compare-and-set save (section-merge), and a
// lastWritten ref prevents a write loop within a session.
export function useBudgetSnapshot(budgetState, setBudgetState, ready) {
  const lastWritten = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const month = new Date().toISOString().slice(0, 7);
    const budgetable = (budgetState.categories || []).filter((c) => c.id !== 'needs-review');
    if (budgetable.length === 0) return;

    const income = Math.round(monthlyIncomeTotal(budgetState));
    const base = computeCategoryBudgets(budgetable, monthlyIncomeTotal(budgetState));
    const eff = effectiveBudgetsForMonth(budgetable, base, month);
    const budgets = {};
    for (const c of budgetable) budgets[c.id] = Math.round(Number(eff[c.id] || 0));

    const sig = JSON.stringify({ income, budgets });
    const existing = budgetState.budgetSnapshots?.[month];
    if (existing && JSON.stringify({ income: existing.income, budgets: existing.budgets }) === sig) return; // already current
    if (lastWritten.current === `${month}:${sig}`) return; // avoid a write loop within a session
    lastWritten.current = `${month}:${sig}`;

    setBudgetState((prev) => {
      const next = { ...(prev.budgetSnapshots || {}) };
      next[month] = { income, budgets, savedAt: new Date().toISOString() }; // only ever the current month; past months stay frozen
      return { ...prev, budgetSnapshots: next };
    });
  }, [ready, budgetState, setBudgetState]);
}
