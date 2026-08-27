import { createClient } from 'npm:@supabase/supabase-js@2';
import { syncTransactions } from '../_shared/syncTransactions.ts';
import { syncHoldings } from '../_shared/syncHoldings.ts';
import { corsHeaders } from '../_shared/cors.ts';

// Manual "sync now" trigger — the webhook covers ongoing updates, but this is
// handy right after linking or if you just want to force a refresh. Pass
// { target: 'chase' } to sync just one institution, or omit it to sync every
// linked item.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { target } = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let query = supabaseAdmin.from('plaid_items').select('id, account_type');
    if (target) query = query.eq('id', target);
    const { data: rows, error } = await query;
    if (error) throw error;

    const results = {};
    for (const row of rows) {
      results[row.id] =
        row.account_type === 'investment'
          ? await syncHoldings(supabaseAdmin, row.id)
          : await syncTransactions(supabaseAdmin, row.id);
    }

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('plaid-sync-transactions failed:', err?.response?.data ?? err?.message ?? err);
    return new Response(JSON.stringify({ error: 'Sync failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
