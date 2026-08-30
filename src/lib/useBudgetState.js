import {
  DEFAULT_ACCOUNTS,
  DEFAULT_CATEGORIES,
  DEFAULT_SINKING_FUNDS,
  DEFAULT_INCOME_SOURCES,
  DEFAULT_INCOME,
} from '../data/budgetDefaults';
import { useSupabaseState } from './supabaseState';

const DEFAULT_STATE = {
  accounts: DEFAULT_ACCOUNTS,
  categories: DEFAULT_CATEGORIES,
  sinkingFunds: DEFAULT_SINKING_FUNDS,
  incomeSources: DEFAULT_INCOME_SOURCES,
  income: DEFAULT_INCOME, // legacy fallback
  merchantMemory: {}, // { normalizedDescription: categoryId } — learned from past corrections
  // The month the envelope ledger starts accruing from (YYYY-MM). Carryover
  // balances = opening balance + budget funded each month since this + spending.
  settings: { startMonth: '2026-09', appName: 'Family Budget' },
};

// A fresh deep copy of the seeded defaults — used by the Settings "reset to
// defaults" action so it can't accidentally mutate the shared default objects.
export function makeDefaultBudget() {
  return structuredClone(DEFAULT_STATE);
}

// Heal a partially-written budget: if a section is missing or empty, fall back
// to the seeded default for it, while preserving any real data already saved.
// (A budget saved with accounts but no categories was leaving the category
// picker — and anything that depends on envelopes — empty.)
function normalizeBudget(b) {
  const nonEmpty = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr : fallback);
  const categories = nonEmpty(b?.categories, DEFAULT_STATE.categories).map((c) =>
    // Backfill a kind on envelopes saved before the ledger existed, so the
    // carryover math and grouping always have something to work with.
    c.kind ? c : { ...c, kind: c.id === 'needs-review' ? 'spending' : 'bill' }
  );
  return {
    ...DEFAULT_STATE,
    ...b,
    accounts: nonEmpty(b?.accounts, DEFAULT_STATE.accounts),
    categories,
    sinkingFunds: nonEmpty(b?.sinkingFunds, DEFAULT_STATE.sinkingFunds),
    incomeSources: nonEmpty(b?.incomeSources, DEFAULT_STATE.incomeSources),
    merchantMemory: b?.merchantMemory || {},
    settings: { ...DEFAULT_STATE.settings, ...(b?.settings || {}) },
  };
}

export function useBudgetState() {
  return useSupabaseState('budget', DEFAULT_STATE, normalizeBudget);
}
