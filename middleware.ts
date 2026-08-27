export const config = { matcher: '/:path*' };

type Credential = { user: string | null; pass: string };

// Supports three ways to configure the login, in priority order:
//   1. SITE_USERS="jeff:pw1,kari:pw2"  → each person their own username+password
//   2. SITE_USERNAME + SITE_PASSWORD   → one shared username+password
//   3. SITE_PASSWORD only              → password only, any username (back-compat)
function allowedCredentials(): Credential[] {
  const list = process.env.SITE_USERS;
  if (list) {
    return list
      .split(',')
      .map((pair) => {
        const i = pair.indexOf(':');
        return i === -1
          ? { user: null, pass: pair.trim() }
          : { user: pair.slice(0, i).trim(), pass: pair.slice(i + 1).trim() };
      })
      .filter((c) => c.pass);
  }
  const password = process.env.SITE_PASSWORD;
  if (password) {
    const user = process.env.SITE_USERNAME;
    return [{ user: user ? user.trim() : null, pass: password }];
  }
  return [];
}

// Gates the whole site behind a login before any code, data, or the Supabase
// anon key reaches the browser — this app has no per-user data, so the login
// is what protects the family's financial data.
export default function middleware(request: Request) {
  // Plaid calls /api/plaid/webhook directly and has no login to send, so that
  // one route is exempt. It only re-pulls from Plaid using tokens already
  // stored server-side, exposing nothing to a caller.
  if (new URL(request.url).pathname === '/api/plaid/webhook') return;

  const creds = allowedCredentials();
  if (creds.length === 0) return; // not configured — fail open rather than lock the owner out

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = atob(auth.slice('Basic '.length));
    const colonIndex = decoded.indexOf(':');
    const suppliedUser = colonIndex === -1 ? '' : decoded.slice(0, colonIndex);
    const suppliedPass = colonIndex === -1 ? decoded : decoded.slice(colonIndex + 1);
    const ok = creds.some((c) =>
      c.user == null ? c.pass === suppliedPass : c.user === suppliedUser && c.pass === suppliedPass
    );
    if (ok) return; // let the request through
  }

  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Budget"' },
  });
}
