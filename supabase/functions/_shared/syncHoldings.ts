import { plaidClient } from './plaidClient.ts';
import { setAccountBalance, setPlaidStatus } from './appState.ts';

// Investment holdings are a snapshot, not an append-only stream like
// transactions — there's no cursor, so each sync just replaces the item's
// rows wholesale with whatever Plaid reports right now.
export async function syncHoldings(supabaseAdmin, itemRowId) {
  const staleThreshold = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('plaid_items')
    .update({ syncing: true, sync_started_at: new Date().toISOString() })
    .eq('id', itemRowId)
    .or(`syncing.eq.false,sync_started_at.lt.${staleThreshold}`)
    .select();
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) {
    return { synced: 0, linked: false, skipped: true };
  }

  const item = claimed[0];

  try {
    const { data } = await plaidClient.investmentsHoldingsGet({ access_token: item.access_token });

    const securitiesById = new Map(data.securities.map((s) => [s.security_id, s]));
    const rows = data.holdings.map((h) => {
      const security = securitiesById.get(h.security_id);
      return {
        item_id: itemRowId,
        security_name: security?.name || security?.ticker_symbol || 'Unknown security',
        ticker: security?.ticker_symbol ?? null,
        quantity: h.quantity,
        value: h.institution_value,
      };
    });

    const { error: deleteError } = await supabaseAdmin.from('investment_holdings').delete().eq('item_id', itemRowId);
    if (deleteError) throw deleteError;

    if (rows.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('investment_holdings').insert(rows);
      if (insertError) throw insertError;
    }

    const totalValue = data.accounts.reduce((sum, a) => sum + (a.balances.current ?? 0), 0);
    await setAccountBalance(supabaseAdmin, item.account_id, totalValue);

    await setPlaidStatus(supabaseAdmin, itemRowId, { linked: true, lastSyncedAt: new Date().toISOString() });

    return { synced: rows.length, linked: true };
  } finally {
    await supabaseAdmin.from('plaid_items').update({ syncing: false }).eq('id', itemRowId);
  }
}
