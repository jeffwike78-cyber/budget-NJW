import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { removeAccounts, removePlaidStatus } from '../_lib/appState.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

export const config = { maxDuration: 30 };

// Disconnect a linked bank: revoke the Plaid item, delete its imported
// transactions and the budget accounts it created, and clear its status.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { itemId } = parseBody(req);
    if (!itemId) {
      res.status(400).json({ error: 'Missing itemId' });
      return;
    }

    const admin = getSupabaseAdmin();
    const { data: item } = await admin.from('plaid_items').select('*').eq('id', itemId).maybeSingle();

    // Figure out which budget accounts this bank created (one per Plaid account),
    // plus the legacy combined id, so we can remove them and their transactions.
    const accountIds = new Set([`plaid-${itemId}`]);
    if (item?.access_token) {
      const plaid = getPlaidClient();
      try {
        const { data } = await plaid.accountsGet({ access_token: item.access_token });
        for (const a of data.accounts || []) accountIds.add(`plaid-${a.account_id}`);
      } catch (e) {
        console.error('accountsGet during remove failed (continuing):', e?.response?.data ?? e?.message ?? e);
      }
      try {
        await plaid.itemRemove({ access_token: item.access_token });
      } catch (e) {
        console.error('itemRemove failed (continuing):', e?.response?.data ?? e?.message ?? e);
      }
    }

    const ids = [...accountIds];
    await admin.from('budget_transactions').delete().eq('source', 'plaid').in('account_id', ids);
    await removeAccounts(admin, ids);
    await admin.from('plaid_items').delete().eq('id', itemId);
    await removePlaidStatus(admin, itemId);

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('plaid remove failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Failed to disconnect the bank.') });
  }
}
