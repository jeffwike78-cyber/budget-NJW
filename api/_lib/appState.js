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

// Create/update one budget account per linked Plaid account in a single write.
// Keeps a name the user has renamed; refreshes type + balance from Plaid. Tags
// each account with its Plaid item id so a later disconnect can clean it up even
// if the bank's login is dead (and accountsGet can't enumerate its accounts).
export async function upsertPlaidAccounts(supabaseAdmin, list) {
  if (!list || list.length === 0) return;
  const budget = await loadBudget(supabaseAdmin);
  const accounts = [...(budget.accounts || [])];
  for (const item of list) {
    const patch = { type: item.type, balance: item.balance };
    if (item.plaidItemId) patch.plaidItemId = item.plaidItemId;
    const idx = accounts.findIndex((a) => a.id === item.id);
    if (idx >= 0) accounts[idx] = { ...accounts[idx], ...patch };
    else accounts.push({ id: item.id, name: item.name, ...patch });
  }
  await saveBudget(supabaseAdmin, { ...budget, accounts });
}

// Remove budget accounts by id (used when disconnecting a bank).
export async function removeAccounts(supabaseAdmin, ids) {
  const drop = new Set(ids);
  const budget = await loadBudget(supabaseAdmin);
  const accounts = (budget.accounts || []).filter((a) => !drop.has(a.id));
  await saveBudget(supabaseAdmin, { ...budget, accounts });
}

// Remove all budget accounts belonging to a disconnected bank: any account
// tagged with this item id, plus any explicitly-listed ids (the legacy combined
// id and ids from a live accountsGet). The tag is what lets us clean up even
// when the bank's login is dead. Returns the ids actually removed, so the caller
// can delete their transactions too.
export async function removeAccountsByItem(supabaseAdmin, itemId, extraIds = []) {
  const dropIds = new Set(extraIds);
  const budget = await loadBudget(supabaseAdmin);
  const removed = [];
  const accounts = (budget.accounts || []).filter((a) => {
    const drop = dropIds.has(a.id) || (itemId && a.plaidItemId === itemId);
    if (drop) removed.push(a.id);
    return !drop;
  });
  await saveBudget(supabaseAdmin, { ...budget, accounts });
  return removed;
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
