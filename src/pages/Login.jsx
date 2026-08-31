import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// The sign-in / sign-up / password-reset screen shown before the app when no one
// is signed in. `recovery` forces the "set a new password" step when the user
// arrived from a reset email.
export default function Login({ appName = 'Family Budget', recovery = false, onRecoveryHandled }) {
  // Modes: 'signin' | 'signup' | 'forgot' | 'reset'
  const [mode, setMode] = useState(recovery ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  function switchMode(next) {
    setError(null);
    setNotice(null);
    setPassword('');
    setMode(next);
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        // onAuthStateChange in useAuth swaps in the app.
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
        if (error) throw error;
        // With email confirmation on, there's no session yet — tell them to check mail.
        if (!data.session) {
          setNotice('Account created. Check your email to confirm it, then sign in.');
          setMode('signin');
        }
      } else if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setNotice('If that email has an account, a password-reset link is on its way.');
        setMode('signin');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setNotice('Password updated — you’re all set.');
        onRecoveryHandled?.();
      }
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const titles = {
    signin: 'Welcome back',
    signup: 'Create your account',
    forgot: 'Reset your password',
    reset: 'Set a new password',
  };
  const cta = {
    signin: 'Sign in',
    signup: 'Create account',
    forgot: 'Email me a reset link',
    reset: 'Save new password',
  };

  return (
    <div className="auth-shell">
      <div className="auth-card card">
        <div className="auth-brand">{appName}</div>
        <h1 className="auth-title">{titles[mode]}</h1>

        <form className="auth-form" onSubmit={submit}>
          {mode !== 'reset' && (
            <label className="auth-field">
              <span className="auth-label">Email</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </label>
          )}
          {mode !== 'forgot' && (
            <label className="auth-field">
              <span className="auth-label">{mode === 'reset' ? 'New password' : 'Password'}</span>
              <input
                type="password"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signin' ? 'Your password' : 'At least 6 characters'}
              />
            </label>
          )}

          {error && <p className="module-note form-error" role="alert">{error}</p>}
          {notice && <p className="module-note form-ok" role="status">{notice}</p>}

          <button type="submit" className="primary-btn auth-submit" disabled={busy}>
            {busy ? 'Working…' : cta[mode]}
          </button>
        </form>

        {mode === 'signin' && (
          <div className="auth-links">
            <button type="button" className="link-btn" onClick={() => switchMode('forgot')}>
              Forgot password?
            </button>
            <button type="button" className="link-btn" onClick={() => switchMode('signup')}>
              Create an account
            </button>
          </div>
        )}
        {(mode === 'signup' || mode === 'forgot') && (
          <div className="auth-links">
            <button type="button" className="link-btn" onClick={() => switchMode('signin')}>
              ← Back to sign in
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
