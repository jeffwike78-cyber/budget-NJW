import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

// Lists connected Gmail accounts (emails only — never the tokens) for the UI.
export default async function handler(req, res) {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('gmail_accounts')
      .select('email, created_at, refresh_token')
      .order('created_at', { ascending: true });
    if (error) throw error;
    const accounts = (data || []).map((a) => ({
      email: a.email,
      connectedAt: a.created_at,
      searchable: !!a.refresh_token,
    }));
    res.status(200).json({ accounts });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list accounts.' });
  }
}
