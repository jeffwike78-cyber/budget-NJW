import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { verifyState, redirectUri, exchangeCode, getProfileEmail } from '../_lib/google.js';

// Google redirects the browser here with ?code after the user consents. We
// exchange the code for tokens, store the account server-side, then bounce back
// into the app. This route is exempt from the site password (see middleware.ts)
// because it's a top-level redirect from Google; the signed `state` guards it.
export default async function handler(req, res) {
  const { code, state, error } = req.query || {};

  function backToApp(flag) {
    res.writeHead(302, { Location: `/?gmail=${flag}` });
    res.end();
  }

  if (error || !code || !state || !verifyState(state)) {
    backToApp('error');
    return;
  }

  try {
    const tokens = await exchangeCode(code, redirectUri(req));
    const email = await getProfileEmail(tokens.access_token);

    const admin = getSupabaseAdmin();
    const record = { id: email, email, created_at: new Date().toISOString() };
    // prompt=consent should always return a refresh_token; only overwrite the
    // stored one when we actually got a new one.
    if (tokens.refresh_token) record.refresh_token = tokens.refresh_token;
    await admin.from('gmail_accounts').upsert(record, { onConflict: 'id' });

    backToApp('connected');
  } catch (err) {
    console.error('gmail auth-callback failed:', err?.message || err);
    backToApp('error');
  }
}
