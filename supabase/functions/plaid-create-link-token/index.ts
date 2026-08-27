import { plaidClient } from '../_shared/plaidClient.ts';
import { targetConfig } from '../_shared/plaidTargets.ts';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { target = 'chase' } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const config = targetConfig(target);

    const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/plaid-webhook`;
    // Chase is an OAuth institution, so Plaid needs to know exactly where to send the
    // browser back to afterward. Must also be added to "Allowed redirect URIs" in
    // the Plaid dashboard (Team Settings → API), or Plaid rejects/mishandles it.
    const redirectUri = Deno.env.get('PLAID_REDIRECT_URI');
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'main' },
      client_name: 'Life Dashboard',
      products: config.products,
      country_codes: ['US'],
      language: 'en',
      webhook: webhookUrl,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    return new Response(JSON.stringify({ link_token: response.data.link_token }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('plaid-create-link-token failed:', err?.response?.data ?? err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Failed to create link token' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
