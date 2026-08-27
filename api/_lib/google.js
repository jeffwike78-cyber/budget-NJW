import crypto from 'node:crypto';

// Thin Gmail + Google OAuth helpers built on plain fetch (no heavy SDK).
// GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET come from a Google Cloud OAuth client;
// they live only in the Vercel serverless environment.

const OAUTH_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function stateSecret() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SITE_PASSWORD || 'dev-secret';
}

// Signed, self-expiring state param — no DB needed to guard the OAuth round-trip.
export function makeState() {
  const payload = `${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
  const sig = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyState(state) {
  try {
    const decoded = Buffer.from(String(state), 'base64url').toString();
    const idx = decoded.lastIndexOf('.');
    const payload = decoded.slice(0, idx);
    const sig = decoded.slice(idx + 1);
    const expect = crypto.createHmac('sha256', stateSecret()).update(payload).digest('hex');
    if (sig !== expect) return false;
    const ts = Number(payload.split('.')[0]);
    return Number.isFinite(ts) && Date.now() - ts < 10 * 60 * 1000; // 10 minutes
  } catch {
    return false;
  }
}

export function redirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}/api/gmail/auth-callback`;
}

export function buildAuthUrl(state, redirect) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token even on re-auth
    include_granted_scopes: 'true',
    state,
  });
  return `${OAUTH_AUTH}?${params.toString()}`;
}

export async function exchangeCode(code, redirect) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: redirect,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);
  return res.json(); // { access_token, refresh_token, id_token, expires_in }
}

export async function refreshAccessToken(refreshToken) {
  const res = await fetch(OAUTH_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

export async function getProfileEmail(accessToken) {
  const res = await fetch(`${GMAIL}/profile`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error('Failed to read Gmail profile');
  const data = await res.json();
  return data.emailAddress;
}

export async function gmailSearch(accessToken, query, max = 5) {
  const url = `${GMAIL}/messages?q=${encodeURIComponent(query)}&maxResults=${max}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Gmail search failed: ${await res.text()}`);
  const data = await res.json();
  return data.messages || [];
}

export async function gmailGetMessage(accessToken, id) {
  const res = await fetch(`${GMAIL}/messages/${id}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Gmail get-message failed');
  return res.json();
}

// Pull subject/from/date + a plaintext body out of a Gmail message resource.
export function parseMessage(msg) {
  const headers = msg.payload?.headers || [];
  const header = (name) => headers.find((x) => x.name.toLowerCase() === name)?.value || '';
  return {
    id: msg.id,
    subject: header('subject'),
    from: header('from'),
    date: header('date'),
    snippet: msg.snippet || '',
    body: extractText(msg.payload),
  };
}

function decodeB64(data) {
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function extractText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return decodeB64(part.body.data);
  if (part.parts) {
    for (const p of part.parts) {
      if (p.mimeType === 'text/plain' && p.body?.data) return decodeB64(p.body.data);
    }
    for (const p of part.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) return stripHtml(decodeB64(part.body.data));
  return '';
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
