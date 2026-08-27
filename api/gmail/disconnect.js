import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { parseBody } from '../_lib/http.js';

// Removes a connected Gmail account (deletes its stored token).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { email } = parseBody(req);
    if (!email) {
      res.status(400).json({ error: 'Missing email.' });
      return;
    }
    const admin = getSupabaseAdmin();
    const { error } = await admin.from('gmail_accounts').delete().eq('id', email);
    if (error) throw error;
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to disconnect.' });
  }
}
