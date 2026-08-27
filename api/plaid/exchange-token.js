import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { ensureAccount, setPlaidStatus } from '../_lib/appState.js';
import { syncItem } from '../_lib/syncTransactions.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

export const config = { maxDuration: 60 };

// Called right after the user finishes the Plaid login popup. Trades the
// short-lived public_token for a permanent access_token, stores it server-side
// (in plaid_items, which the browser can't read), creates an account for the
// bank, and pulls the first batch of transactions immediately.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = parseBody(req);
    const publicToken = body.public_token;
    const institutionName = (body.institution_name || 'Bank').toString().slice(0, 80);
    if (!publicToken) {
      res.status(400).json({ error: 'Missing public_token' });
      return;
    }

    const plaid = getPlaidClient();
    const admin = getSupabaseAdmin();

    const exchange = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    const { access_token, item_id } = exchange.data;

    const accountId = `plaid-${item_id}`;
    const accountKind = body.account_kind === 'credit' ? 'credit' : 'checking';
    await ensureAccount(admin, { id: accountId, name: institutionName, type: accountKind });

    const { error } = await admin.from('plaid_items').upsert(
      {
        id: item_id,
        institution_name: institutionName,
        account_type: 'depository',
        account_id: accountId,
        access_token,
        item_id,
        sync_cursor: null,
      },
      { onConflict: 'id' }
    );
    if (error) throw error;

    await setPlaidStatus(admin, item_id, { institutionName, accountId, linked: true });

    // Pull the first batch right away rather than waiting for the webhook.
    let result = {};
    try {
      result = await syncItem(admin, plaid, item_id);
    } catch (e) {
      console.error('initial sync failed:', e?.response?.data ?? e?.message ?? e);
    }

    res.status(200).json({ ok: true, itemId: item_id, institutionName, ...result });
  } catch (err) {
    console.error('exchange-token failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Failed to link the account.') });
  }
}
