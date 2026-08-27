import { makeState, redirectUri, buildAuthUrl } from '../_lib/google.js';

// Returns the Google consent URL the browser should navigate to. Each call
// makes a fresh signed state so the round-trip can't be forged or replayed.
export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(500).json({
      error: 'Google isn’t configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel.',
    });
    return;
  }
  const url = buildAuthUrl(makeState(), redirectUri(req));
  res.status(200).json({ url });
}
