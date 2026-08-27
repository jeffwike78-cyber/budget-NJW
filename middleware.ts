export const config = { matcher: '/:path*' };

// Blocks the entire site behind a password before any code, data, or the
// Supabase anon key ever reaches the browser — this app has no per-user
// login (see supabase/schema.sql), so the deployed URL + this password are
// the only things gating access to real financial data.
export default function middleware(request: Request) {
  // Plaid calls /api/plaid/webhook directly and has no site password to send,
  // so that one route is exempt. It only re-pulls from Plaid using tokens
  // already stored server-side, exposing nothing to a caller.
  if (new URL(request.url).pathname === '/api/plaid/webhook') return;

  const password = process.env.SITE_PASSWORD;
  if (!password) return; // not configured — fail open rather than lock the owner out

  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = atob(auth.slice('Basic '.length));
    const colonIndex = decoded.indexOf(':');
    const suppliedPassword = colonIndex === -1 ? decoded : decoded.slice(colonIndex + 1);
    if (suppliedPassword === password) return; // let the request through
  }

  return new Response('Password required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Budget"' },
  });
}
