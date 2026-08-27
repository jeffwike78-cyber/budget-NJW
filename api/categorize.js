// Vercel serverless function: AI transaction categorization (manual button).
//
// The browser POSTs a batch of transactions + the list of envelopes; this
// returns the best-envelope mapping. The Anthropic API key lives ONLY here
// (server-side, as ANTHROPIC_API_KEY) and this route sits behind the site
// password (see middleware.ts). The Plaid sync shares the same core logic.
import { categorizeTransactions } from './_lib/categorizeCore.js';
import { parseBody } from './_lib/http.js';

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

  const body = parseBody(req);
  const transactions = Array.isArray(body?.transactions) ? body.transactions : [];
  const categories = Array.isArray(body?.categories) ? body.categories : [];
  if (transactions.length === 0 || categories.length === 0) {
    res.status(400).json({ error: 'Provide a non-empty transactions and categories list.' });
    return;
  }

  try {
    const results = await categorizeTransactions({ transactions, categories, apiKey });
    res.status(200).json({ results });
  } catch (err) {
    const status = err?.status === 401 ? 401 : 502;
    const message =
      err?.status === 401
        ? 'The Anthropic API key was rejected — double-check ANTHROPIC_API_KEY in the Vercel settings.'
        : err?.message || 'Categorization request failed.';
    res.status(status).json({ error: message });
  }
}
