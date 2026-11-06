import { incomeEvents } from './cashflow';

// Reconcile a month's budgeted income against the deposits that actually landed,
// per source — so you can confirm every paycheck came in and see over/under.
//
// Matching a deposit to a source is best-effort: shared digit runs (a PPD /
// account id in the source name and the bank description) are a strong signal,
// shared words a weaker one, and a near-match on the per-payment amount a
// tiebreaker. Anything that doesn't match a source is reported as "other income".

function lastDayOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m, 0).getDate();
  return `${month}-${String(d).padStart(2, '0')}`;
}

// Boilerplate that shows up in most bank/payroll descriptions (and in a couple
// of the source names), so it must never be what links a deposit to a source.
const STOPWORDS = new Set([
  'payroll', 'ppd', 'ccd', 'ppd id', 'id', 'the', 'and', 'for', 'from', 'with', 'inc', 'llc',
  'transfer', 'online', 'deposit', 'direct', 'dep', 'des', 'payment', 'pmt', 'ach', 'eft', 'via',
]);

function tokenize(s) {
  const str = String(s || '').toLowerCase();
  const words = new Set(
    str.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !STOPWORDS.has(w)),
  );
  const nums = new Set(str.match(/\d{4,}/g) || []);
  return { words, nums };
}

function matchScore(srcTok, depTok, perPayment, depAmt) {
  let sc = 0;
  for (const n of depTok.nums) if (srcTok.nums.has(n)) sc += 6; // shared PPD/account id
  for (const w of depTok.words) if (srcTok.words.has(w)) sc += 1;
  if (perPayment > 0 && Math.abs(Math.abs(depAmt) - perPayment) <= Math.max(3, perPayment * 0.12)) sc += 2;
  return sc;
}

export function reconcileIncome(incomeSources, deposits, month) {
  const sources = (incomeSources || []).filter((s) => Number(s.amount || 0) > 0);
  const from = `${month}-01`;
  const to = lastDayOfMonth(month);
  const events = incomeEvents(sources, from, to);

  const expected = new Map();
  for (const s of sources) {
    expected.set(s.name, { name: s.name, perPayment: Number(s.amount), expectedCount: 0, expectedTotal: 0, received: [], receivedTotal: 0 });
  }
  for (const e of events) {
    const x = expected.get(e.name);
    if (!x) continue;
    x.expectedCount += 1;
    x.expectedTotal += e.amount;
  }

  const srcTok = sources.map((s) => ({ name: s.name, perPayment: Number(s.amount), tok: tokenize(s.name) }));
  const other = [];
  for (const d of deposits || []) {
    const depTok = tokenize(d.description);
    let best = null;
    let bestScore = 0;
    for (const s of srcTok) {
      const sc = matchScore(s.tok, depTok, s.perPayment, d.amount);
      if (sc > bestScore) {
        bestScore = sc;
        best = s;
      }
    }
    if (best && bestScore >= 1) {
      const x = expected.get(best.name);
      x.received.push(d);
      x.receivedTotal += Math.abs(Number(d.amount));
    } else {
      other.push(d);
    }
  }

  const perSource = [...expected.values()]
    .map((x) => {
      const variance = x.receivedTotal - x.expectedTotal;
      let status;
      if (x.expectedCount === 0) status = x.receivedTotal > 0 ? 'extra' : 'none';
      else if (x.receivedTotal === 0) status = 'missing';
      else if (x.received.length < x.expectedCount) status = 'partial';
      else if (Math.abs(variance) <= Math.max(1, x.expectedTotal * 0.01)) status = 'ok';
      else status = variance > 0 ? 'over' : 'under';
      return { ...x, variance, status };
    })
    .filter((x) => x.expectedCount > 0 || x.receivedTotal > 0);

  const otherTotal = other.reduce((s, d) => s + Math.abs(Number(d.amount)), 0);
  return { perSource, other, otherTotal };
}
