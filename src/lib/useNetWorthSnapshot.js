import { useEffect, useRef } from 'react';
import { computeNetWorth } from './netWorth';

// Persist a monthly net-worth snapshot so the Overview trend actually builds up
// over time. Without this, netWorthHistory stayed empty and the sparkline only
// ever showed the current month.
//
// Behavior: while the budget is loaded, keep THIS month's snapshot equal to the
// live net worth (updates as balances refresh). Past months are frozen — we
// never rewrite an existing month's value — so once the month rolls over, the
// prior month keeps whatever it last held, and the trend grows one point per
// month. Writes go through the normal compare-and-set save (section-merge), so a
// snapshot-only write can't clobber other edits.
export function useNetWorthSnapshot(budgetState, setBudgetState, ready) {
  const lastWritten = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const month = new Date().toISOString().slice(0, 7);
    const total = Math.round(computeNetWorth(budgetState).total);
    const history = budgetState.netWorthHistory || {};
    if (history[month] === total) return; // already current
    const marker = `${month}:${total}`;
    if (lastWritten.current === marker) return; // avoid a write loop within a session
    lastWritten.current = marker;
    setBudgetState((prev) => {
      const next = { ...(prev.netWorthHistory || {}) };
      next[month] = total; // only ever set the current month; past months stay frozen
      return { ...prev, netWorthHistory: next };
    });
  }, [ready, budgetState, setBudgetState]);
}
