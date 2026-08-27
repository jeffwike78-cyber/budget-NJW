// Vercel serverless function: AI transaction categorization.
//
// The browser POSTs a batch of transactions + the list of envelopes; this
// function asks Claude to assign each transaction to the best envelope and
// returns the mapping. The Anthropic API key lives ONLY here (server-side, as
// the ANTHROPIC_API_KEY env var) — it never reaches the browser or the repo.
//
// This whole route sits behind the site password (see middleware.ts), so only
// someone who's already unlocked the app can call it.
import Anthropic from '@anthropic-ai/sdk';

// Default to Claude Opus 5 (most capable). For this high-volume, low-stakes
// categorizing you can cut cost ~5x by setting CATEGORIZER_MODEL=claude-haiku-4-5
// in the Vercel env vars — accuracy stays high for merchant→envelope matching.
const DEFAULT_MODEL = 'claude-opus-5';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        'AI categorization isn’t configured yet. Add an ANTHROPIC_API_KEY environment variable to this Vercel project, then redeploy.',
    });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  const categories = Array.isArray(body?.categories) ? body.categories : [];
  if (transactions.length === 0 || categories.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty transactions and categories list.' });
    return;
  }

  const client = new Anthropic({ apiKey });
  const model = process.env.CATEGORIZER_MODEL || DEFAULT_MODEL;

  const categoryList = categories
    .map((c) => `- ${c.id}: ${c.name}${c.group ? ` [${c.group}]` : ''}`)
    .join('\n');
  const txList = transactions
    .map((t, i) => `${i + 1}. id=${JSON.stringify(String(t.id))} amount=${t.amount} desc=${JSON.stringify(String(t.description || ''))}`)
    .join('\n');

  const system = `You are a careful personal-budget categorizer for a family's envelope budget.
Assign each transaction to exactly ONE envelope from the provided list, choosing the best match from the merchant/description (and the sign of the amount: positive = money spent, negative = money in).
Rules:
- Use only the category ids given in the list.
- If a transaction is clearly income, a paycheck, or a transfer between the family's own accounts (not real spending), OR you genuinely cannot tell which envelope fits, use the id "needs-review".
- Prefer a specific envelope over a generic one when the merchant is recognizable (e.g. a grocery store → the groceries envelope).
Respond with ONLY a JSON array (no prose, no code fences) of objects shaped exactly:
[{"id": <the transaction id>, "categoryId": <a category id>, "confidence": <number 0-1>}]`;

  const userMsg = `Envelopes (id: name [group]):\n${categoryList}\n\nTransactions:\n${txList}\n\nReturn the JSON array now.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: Math.min(8000, 60 * transactions.length + 400),
      system,
      messages: [{ role: 'user', content: userMsg }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const results = extractJsonArray(text);
    res.status(200).json({ results, model });
  } catch (err) {
    const status = err?.status === 401 ? 401 : 502;
    const message =
      err?.status === 401
        ? 'The Anthropic API key was rejected — double-check ANTHROPIC_API_KEY in the Vercel settings.'
        : err?.message || 'Categorization request failed.';
    res.status(status).json({ error: message });
  }
}

// Claude is asked for a bare JSON array, but be forgiving if it wraps it in
// prose or a code fence anyway.
function extractJsonArray(text) {
  const trimmed = (text || '').trim();
  try {
    const direct = JSON.parse(trimmed);
    if (Array.isArray(direct)) return direct;
  } catch {
    // fall through to the bracket-extraction below
  }
  const match = trimmed.match(/\[[\s\S]*\]/);
  if (match) {
    try {
      const arr = JSON.parse(match[0]);
      if (Array.isArray(arr)) return arr;
    } catch {
      // give up — return nothing rather than throwing
    }
  }
  return [];
}
