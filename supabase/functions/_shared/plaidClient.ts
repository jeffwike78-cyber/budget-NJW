import { Configuration, PlaidApi, PlaidEnvironments } from 'npm:plaid@^38.0.0';

// PLAID_ENV / PLAID_CLIENT_ID / PLAID_SECRET are set via:
//   supabase secrets set PLAID_ENV=sandbox PLAID_CLIENT_ID=... PLAID_SECRET=...
// Use PLAID_ENV=sandbox while testing with fake data, then sandbox -> production
// once ready to link the real Chase account (that's a different Secret from Plaid).
const plaidEnv = Deno.env.get('PLAID_ENV') || 'sandbox';

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': Deno.env.get('PLAID_CLIENT_ID') ?? '',
      'PLAID-SECRET': Deno.env.get('PLAID_SECRET') ?? '',
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
