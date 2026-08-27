import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Builds a Plaid API client from the server-side env vars.
//   PLAID_CLIENT_ID / PLAID_SECRET  — from the Plaid dashboard (Team Settings → Keys)
//   PLAID_ENV                       — 'sandbox' (fake test banks) or 'production' (real)
// These live only in the Vercel serverless environment; they never reach the browser.
export function getPlaidClient() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  const env = process.env.PLAID_ENV || 'sandbox';
  if (!clientId || !secret) {
    throw new Error('Plaid isn’t configured — add PLAID_CLIENT_ID and PLAID_SECRET in Vercel.');
  }
  const configuration = new Configuration({
    basePath: PlaidEnvironments[env] || PlaidEnvironments.sandbox,
    baseOptions: {
      headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret },
    },
  });
  return new PlaidApi(configuration);
}
