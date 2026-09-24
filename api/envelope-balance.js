import { getSupabaseAdmin } from './_lib/supabaseAdmin.js';
import { loadBudget } from './_lib/appState.js';
import { parseBody } from './_lib/http.js';
import {
  monthlyIncomeTotal,
  computeCategoryBudgets,
  adjustmentMaps,
  envelopeBalances,
} from '../src/lib/budgetMath.js';
import { netSpentByCategory } from '../src/lib/spending.js';

// Voice/Shortcut endpoint: "Hey Siri, how much is left in groceries?"
// An Apple Shortcut calls this URL with the family's secret token and a
// category name; it replies with a spoken sentence (plain text) that Siri reads
// aloud. Read-only. Gated by settings.voiceToken so the URL alone can't be used
// without the token.
//
// GET or POST. Params (query string or JSON body):
//   token    - the secret from Settings → Voice
//   category (or q) - the envelope name, e.g. "groceries"
//   format   - "json" to get structured data instead of a spoken sentence

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Find the envelope whose name best matches the spoken query. Prefers an exact
// name, then a name that contains the query (or vice-versa), shortest first.
function matchCategory(categories, query) {
  const q = norm(query);
  if (!q) return null;
  const cats = (categories || []).filter((c) => c.id !== 'needs-review');
  const exact = cats.find((c) => norm(c.name) === q);
  if (exact) return exact;
  const contains = cats
    .filter((c) => norm(c.name).includes(q) || q.includes(norm(c.name)))
    .sort((a, b) => a.name.length - b.name.length);
  return contains[0] || null;
}

function money(n) {
  return `$${Math.abs(Number(n || 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function handler(req, res) {
  try {
    const body = req.method === 'POST' ? parseBody(req) : {};
    const q = req.query || {};
    const token = body.token || q.token || '';
    const query = body.category || body.q || q.category || q.q || '';
    const format = body.format || q.format || 'text';
    const wantJson = String(format).toLowerCase() === 'json';

    const admin = getSupabaseAdmin();
    const budget = await loadBudget(admin);
    const secret = budget.settings?.voiceToken;

    if (!secret) {
      return reply(res, 401, wantJson, { ok: false, error: 'voice-not-setup' }, 'Voice access isn’t set up yet. Turn it on in the budget app under Settings, Voice.');
    }
    if (!token || token !== secret) {
      return reply(res, 401, wantJson, { ok: false, error: 'unauthorized' }, 'Not authorized.');
    }

    const category = matchCategory(budget.categories, query);
    if (!category) {
      return reply(res, 200, wantJson, { ok: false, error: 'no-match', query }, `I couldn't find a budget called ${query || 'that'}.`);
    }

    // Pull transactions (all-time for carryover funds, this month for spending)
    // and compute the same "available" balance the app shows.
    const month = new Date().toISOString().slice(0, 7);
    const { data: rows } = await admin
      .from('budget_transactions')
      .select('category_id, amount, excluded, business, tax_category, date');
    const txns = (rows || []).map((r) => ({
      categoryId: r.category_id,
      amount: Number(r.amount),
      excluded: r.excluded,
      business: r.business,
      taxCategory: r.tax_category,
      date: r.date,
    }));
    const monthTx = txns.filter((t) => String(t.date || '').startsWith(month));

    const cats = (budget.categories || []).filter((c) => c.id !== 'needs-review');
    const income = monthlyIncomeTotal(budget);
    const baseBudgets = computeCategoryBudgets(cats, income);
    const spentAll = netSpentByCategory(txns);
    const spentMonth = netSpentByCategory(monthTx);
    const { all: adjustAll, month: adjustMonth } = adjustmentMaps(budget.adjustments, month);
    const balances = envelopeBalances(cats, baseBudgets, spentAll, spentMonth, budget.settings?.startMonth, month, adjustAll, adjustMonth);

    const info = balances[category.id] || { available: 0, carry: false };
    const available = Math.round(Number(info.available) * 100) / 100;
    const period = info.carry ? '' : ' this month';
    const speech =
      available >= 0
        ? `You have ${money(available)} left in ${category.name}${period}.`
        : `You're ${money(available)} over in ${category.name}${period}.`;

    return reply(res, 200, wantJson, { ok: true, name: category.name, available, carry: !!info.carry, speech }, speech);
  } catch (err) {
    console.error('envelope-balance failed:', err?.message || err);
    return reply(res, 500, false, { ok: false, error: 'server' }, 'Sorry, I couldn’t reach the budget just now.');
  }
}

function reply(res, status, wantJson, json, text) {
  if (wantJson) {
    res.status(status).json(json);
  } else {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.status(status).send(text);
  }
}
