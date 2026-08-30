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
};

// Heal a partially-written budget: if a section is missing or empty, fall back
// to the seeded default for it, while preserving any real data already saved.
// (A budget saved with accounts but no categories was leaving the category
// picker — and anything that depends on envelopes — empty.)
function normalizeBudget(b) {
  const nonEmpty = (arr, fallback) => (Array.isArray(arr) && arr.length ? arr : fallback);
  return {
    ...DEFAULT_STATE,
    ...b,
    accounts: nonEmpty(b?.accounts, DEFAULT_STATE.accounts),
    categories: nonEmpty(b?.categories, DEFAULT_STATE.categories),
    sinkingFunds: nonEmpty(b?.sinkingFunds, DEFAULT_STATE.sinkingFunds),
    incomeSources: nonEmpty(b?.incomeSources, DEFAULT_STATE.incomeSources),
    merchantMemory: b?.merchantMemory || {},
  };
}

export function useBudgetState() {
  return useSupabaseState('budget', DEFAULT_STATE, normalizeBudget);
}
