import { DEFAULT_ACCOUNTS, DEFAULT_CATEGORIES, DEFAULT_SINKING_FUNDS, DEFAULT_INCOME } from '../data/budgetDefaults';
import { useSupabaseState } from './supabaseState';

const DEFAULT_STATE = {
  accounts: DEFAULT_ACCOUNTS,
  categories: DEFAULT_CATEGORIES,
  sinkingFunds: DEFAULT_SINKING_FUNDS,
  income: DEFAULT_INCOME,
  merchantMemory: {}, // { normalizedDescription: categoryId } — learned from past corrections
};

export function useBudgetState() {
  return useSupabaseState('budget', DEFAULT_STATE);
}
