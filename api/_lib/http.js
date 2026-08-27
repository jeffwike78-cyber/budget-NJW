// Vercel parses JSON bodies automatically when Content-Type is set, but be
// defensive in case a body arrives as a raw string.
export function parseBody(req) {
  let b = req.body;
  if (typeof b === 'string') {
    try {
      b = JSON.parse(b);
    } catch {
      b = {};
    }
  }
  return b || {};
}

// Plaid errors carry a helpful message under response.data.error_message.
export function plaidErrorMessage(err, fallback) {
  return err?.response?.data?.error_message || err?.message || fallback;
}
