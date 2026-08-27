import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { lookupReceiptForTx } from '../_lib/receipts.js';
import { parseBody } from '../_lib/http.js';

export const config = { maxDuration: 60 };

// For a mystery transaction, find its email receipt, extract what it was for,
// and save the note (plus best envelope / business flag) back onto it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set.' });
    return;
  }

  try {
    const body = parseBody(req);
    const admin = getSupabaseAdmin();

    let tx = body.transaction;
    if (body.transactionId && !tx) {
      const { data } = await admin
        .from('budget_transactions')
        .select('id, date, description, amount')
        .eq('id', body.transactionId)
        .maybeSingle();
      tx = data;
    }
    if (!tx) {
      res.status(400).json({ error: 'Provide a transaction or transactionId.' });
      return;
    }

    const { data: stateRow } = await admin.from('app_state').select('budget').eq('id', 'main').maybeSingle();
    const categories = (stateRow?.budget?.categories || []).filter((c) => c.id !== 'needs-review');

    const result = await lookupReceiptForTx(admin, tx, categories);

    if (result.reason === 'no-accounts') {
      res.status(400).json({ error: 'No Gmail accounts are connected yet.' });
      return;
    }

    if (result.found && tx.id) {
      const update = {};
      if (result.detail) update.note = String(result.detail).slice(0, 500);
      if (result.categoryId && categories.some((c) => c.id === result.categoryId)) update.category_id = result.categoryId;
      if (result.business) update.business = true;
      if (Object.keys(update).length > 0) {
        await admin.from('budget_transactions').update(update).eq('id', tx.id);
      }
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('find-receipt failed:', err?.message || err);
    res.status(502).json({ error: err.message || 'Receipt lookup failed.' });
  }
}
