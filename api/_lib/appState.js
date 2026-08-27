// Small helpers for reading/writing the single app_state row from the server
// (service-role) side, mirroring how the frontend stores budget state.

const ROW_ID = 'main';

export async function loadBudget(supabaseAdmin) {
  const { data } = await supabaseAdmin.from('app_state').select('budget').eq('id', ROW_ID).maybeSingle();
  const budget = data?.budget;
  return budget && Object.keys(budget).length > 0 ? budget : { accounts: [], categories: [], merchantMemory: {} };
}

async function saveBudget(supabaseAdmin, budget) {
  await supabaseAdmin
    .from('app_state')
    .upsert({ id: ROW_ID, budget, updated_at: new Date().toISOString() }, { onConflict: 'id' });
}

// Make sure an account exists for a linked bank; returns the account id used.
export async function ensureAccount(supabaseAdmin, { id, name, type = 'checking' }) {
  const budget = await loadBudget(supabaseAdmin);
  const accounts = budget.accounts || [];
  if (!accounts.some((a) => a.id === id)) {
    accounts.push({ id, name, type, balance: 0 });
    await saveBudget(supabaseAdmin, { ...budget, accounts });
  }
  return id;
}

export async function setAccountBalance(supabaseAdmin, accountId, balance) {
  const budget = await loadBudget(supabaseAdmin);
  const accounts = (budget.accounts || []).map((a) => (a.id === accountId ? { ...a, balance } : a));
  await saveBudget(supabaseAdmin, { ...budget, accounts });
}

// plaid_status lives on app_state (not plaid_items) because the frontend's
// anon key can read app_state but is deliberately locked out of plaid_items.
// Keyed by Plaid item_id: { institutionName, accountId, linked, lastSyncedAt }.
export async function setPlaidStatus(supabaseAdmin, itemId, patch) {
  const { data } = await supabaseAdmin.from('app_state').select('plaid_status').eq('id', ROW_ID).maybeSingle();
  const plaidStatus = data?.plaid_status || {};
  await supabaseAdmin.from('app_state').upsert(
    {
      id: ROW_ID,
      plaid_status: { ...plaidStatus, [itemId]: { ...plaidStatus[itemId], ...patch } },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
}

export async function removePlaidStatus(supabaseAdmin, itemId) {
  const { data } = await supabaseAdmin.from('app_state').select('plaid_status').eq('id', ROW_ID).maybeSingle();
  const plaidStatus = data?.plaid_status || {};
  delete plaidStatus[itemId];
  await supabaseAdmin
    .from('app_state')
    .upsert({ id: ROW_ID, plaid_status: plaidStatus, updated_at: new Date().toISOString() }, { onConflict: 'id' });
}
