// How many times the user must confirm a merchant's category before the app
// trusts it and auto-files future transactions from that merchant straight to
// the envelope (skipping the "AI Reviewed" approval queue).
export const MERCHANT_TRUST_THRESHOLD = 5;

function keyOf(desc) {
  return String(desc || '').trim().toLowerCase();
}

// Record one user confirmation of (merchant → category). Confirming the same
// category again increments the count; picking a different category resets the
// count to 1 for the new category (the old trust no longer applies). Returns a
// new map; never mutates the input.
export function bumpConfidence(map, desc, categoryId) {
  const key = keyOf(desc);
  if (!key || !categoryId || categoryId === 'needs-review') return map || {};
  const next = { ...(map || {}) };
  const cur = next[key];
  next[key] = cur && cur.categoryId === categoryId
    ? { categoryId, count: (cur.count || 0) + 1 }
    : { categoryId, count: 1 };
  return next;
}

// How many times this merchant→category has been confirmed (0 if none/other).
export function confidenceCount(map, desc, categoryId) {
  const e = (map || {})[keyOf(desc)];
  return e && e.categoryId === categoryId ? e.count || 0 : 0;
}

// Whether a merchant→category is trusted (confirmed at/over the threshold).
export function isTrusted(map, desc, categoryId) {
  return confidenceCount(map, desc, categoryId) >= MERCHANT_TRUST_THRESHOLD;
}
