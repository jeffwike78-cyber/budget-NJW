import { createClient } from '@supabase/supabase-js';

// Values pasted into a host's env-var dashboard routinely pick up an invalid
// character — a wrapped JWT gains a line break, a copy adds a stray space,
// non-breaking space, zero-width char, or smart quote. ANY character outside
// the legal HTTP header range makes the browser's Headers.set() throw
// "TypeError: Type error", and then every request to the database fails
// silently. So sanitize hard, to exactly the characters each value may
// legitimately contain: a Supabase anon key is a JWT (base64url segments
// joined by dots — [A-Za-z0-9._-] only); the project URL is a plain https URL.
const cleanKey = (v) => (v || '').replace(/[^A-Za-z0-9._-]/g, '');
const cleanUrl = (v) => (v || '').replace(/[\s`]/g, '').trim();
const url = cleanUrl(import.meta.env.VITE_SUPABASE_URL);
const anonKey = cleanKey(import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from your Supabase project settings.'
  );
}

export const supabase = createClient(url, anonKey);
