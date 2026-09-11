import { supabase } from './supabaseClient';

const ROW_ID = 'main';

// Reads saved budget versions from app_state_history (populated by the
// BEFORE UPDATE trigger in supabase/budget-history.sql). Returns
// { installed, versions } — installed is false when the history table/trigger
// hasn't been set up yet, so the UI can prompt for the one-time SQL step.
export async function listBudgetVersions(limit = 30) {
  const { data, error } = await supabase
    .from('app_state_history')
    .select('id, saved_at, budget')
    .eq('row_id', ROW_ID)
    .order('saved_at', { ascending: false })
    .limit(limit);
  if (error) {
    // 42P01 = undefined_table → history not installed yet.
    const notInstalled = error.code === '42P01' || /does not exist/i.test(error.message || '');
    return { installed: !notInstalled, versions: [], error };
  }
  return { installed: true, versions: data || [] };
}

// A compact, recognizable summary of a stored budget for the restore list.
export function summarizeBudget(budget) {
  const cats = (budget?.categories || []).filter((c) => c.id !== 'needs-review');
  const monthly = cats.reduce((s, c) => s + (c.budgetType === 'fixed' ? Number(c.budgetValue || 0) : 0), 0);
  return {
    categoryCount: cats.length,
    accountCount: (budget?.accounts || []).length,
    monthlyFixed: monthly,
    names: cats.map((c) => c.name),
  };
}
