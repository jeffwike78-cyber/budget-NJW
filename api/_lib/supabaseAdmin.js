import { createClient } from '@supabase/supabase-js';

// A Supabase client using the SERVICE ROLE key — this bypasses row-level
// security, so it can read/write plaid_items (which the browser's anon key is
// deliberately locked out of, since it holds the Plaid access tokens).
//
// SUPABASE_SERVICE_ROLE_KEY must be set in Vercel (Supabase dashboard →
// Settings → API → service_role secret). The URL falls back to the same
// VITE_SUPABASE_URL the frontend already uses, so you usually only need to add
// the one new secret.
export function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Supabase admin isn’t configured — add SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL, if VITE_SUPABASE_URL isn’t set) in Vercel.'
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}
