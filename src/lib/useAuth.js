import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

// Tracks the Supabase auth session for the whole app. The family shares one
// budget (a single app_state row) — login is a front door, not a per-user data
// split — so all this does is tell the app whether someone is signed in.
//
// `recovery` flips true when the browser lands on a password-reset link: Supabase
// parses the token from the URL and fires a PASSWORD_RECOVERY event, and we then
// show the "set a new password" screen instead of the normal app.
export function useAuth() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return {
    session,
    user: session?.user ?? null,
    loading,
    recovery,
    clearRecovery: () => setRecovery(false),
  };
}
