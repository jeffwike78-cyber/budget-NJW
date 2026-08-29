import { createClient } from '@supabase/supabase-js';

// Values pasted into a host's env-var dashboard routinely pick up a stray
// space or line break (a wrapped JWT, a trailing newline). A Supabase project
// URL and an anon key (a JWT) never legitimately contain whitespace, so strip
// it all: an invalid character here makes the browser's Headers.set() throw
// "TypeError: Type error" and every request to the database fails silently.
const clean = (v) => (v || '').replace(/\s/g, '');
const url = clean(import.meta.env.VITE_SUPABASE_URL);
const anonKey = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

if (!url || !anonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env.local and fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from your Supabase project settings.'
  );
}

export const supabase = createClient(url, anonKey);
