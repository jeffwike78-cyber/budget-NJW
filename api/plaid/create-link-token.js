import { getPlaidClient } from '../_lib/plaidClient.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody, plaidErrorMessage } from '../_lib/http.js';

// Returns a short-lived Plaid Link token the browser uses to open the bank
// login popup. The webhook URL is derived from the current host so Plaid knows
// where to notify us when new transactions are ready.
//
// Pass { itemId } to open Link in UPDATE MODE: it re-authenticates an existing
// bank connection in place (re-login and re-select accounts) using its stored
// access_token. This repairs a stale connection WITHOUT removing the item, its
// accounts, or the transactions already imported — no data is lost.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const plaid = getPlaidClient();
    const body = parseBody(req);
    const itemId = body.itemId || body.item_id || null;

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const webhook = host ? `${proto}://${host}/api/plaid/webhook` : undefined;
    const redirectUri = process.env.PLAID_REDIRECT_URI;

    // Update mode needs the existing connection's access_token; new links need
    // the products list. The two are mutually exclusive in Plaid's API.
    let accessToken = null;
    if (itemId) {
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.from('plaid_items').select('access_token').eq('id', itemId).maybeSingle();
      if (error) throw error;
      if (!data?.access_token) {
        res.status(404).json({ error: 'That bank connection was not found.' });
        return;
      }
      accessToken = data.access_token;
    }

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'main' },
      client_name: 'Budget',
      country_codes: ['US'],
      language: 'en',
      ...(accessToken
        ? { access_token: accessToken, update: { account_selection_enabled: true } }
        : { products: ['transactions'] }),
      ...(webhook ? { webhook } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    res.status(200).json({ link_token: response.data.link_token, mode: accessToken ? 'update' : 'connect' });
  } catch (err) {
    console.error('create-link-token failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Failed to create a Plaid link token.') });
  }
}
