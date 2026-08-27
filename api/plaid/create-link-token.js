import { getPlaidClient } from '../_lib/plaidClient.js';
import { plaidErrorMessage } from '../_lib/http.js';

// Returns a short-lived Plaid Link token the browser uses to open the bank
// login popup. The webhook URL is derived from the current host so Plaid knows
// where to notify us when new transactions are ready.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const plaid = getPlaidClient();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const webhook = host ? `${proto}://${host}/api/plaid/webhook` : undefined;
    const redirectUri = process.env.PLAID_REDIRECT_URI;

    const response = await plaid.linkTokenCreate({
      user: { client_user_id: 'main' },
      client_name: 'Budget',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      ...(webhook ? { webhook } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('create-link-token failed:', err?.response?.data ?? err?.message ?? err);
    res.status(500).json({ error: plaidErrorMessage(err, 'Failed to create a Plaid link token.') });
  }
}
