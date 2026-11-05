// Health checks that flag transactions that look off, so nothing falls through
// the cracks. All pure functions over the in-memory transaction list.

function daysApart(a, b) {
  return Math.abs((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
}
// A loose merchant key: letters/digits only, first 5 chars — so "Kroger" and
// "KROGER #123" match but "Kroger" and "Sierra" don't.
function descKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5);
}

// Splitting a purchase should leave only the split pieces counted; the raw
// bank charge should be Ignored. Flag any case where a non-excluded charge
// still matches the total of a split group (same merchant, ~same amount, within
// a few days) — that money is being counted twice.
export function findSplitDoubleCounts(transactions) {
  const splits = transactions.filter((t) => t.source === 'split' && !t.excluded);
  const groups = new Map();
  for (const s of splits) {
    const key = `${descKey(s.description)}|${s.date}`;
    if (!groups.has(key)) groups.set(key, { description: s.description, date: s.date, total: 0, pieces: 0, k: descKey(s.description) });
    const g = groups.get(key);
    g.total += Number(s.amount);
    g.pieces += 1;
  }
  const out = [];
  for (const g of groups.values()) {
    const total = Math.round(g.total * 100) / 100;
    const charge = transactions.find(
      (t) =>
        t.source !== 'split' &&
        !t.excluded &&
        Number(t.amount) > 0 &&
        descKey(t.description) === g.k &&
        Math.abs(Math.abs(Number(t.amount)) - total) < 0.5 &&
        daysApart(t.date, g.date) <= 5
    );
    if (charge) out.push({ description: g.description, date: g.date, total, pieces: g.pieces, charge });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Two or more non-excluded bank rows that look like the same purchase (same
// account + amount + merchant, within a few days) — a likely duplicate import.
export function findDuplicateCharges(transactions) {
  const rows = transactions.filter((t) => t.source === 'plaid' && !t.excluded);
  const map = new Map();
  for (const t of rows) {
    const key = `${t.accountId}|${Math.abs(Number(t.amount)).toFixed(2)}|${descKey(t.description)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  const clusters = [];
  for (const list of map.values()) {
    if (list.length < 2) continue;
    const byDate = [...list].sort((a, b) => (a.date < b.date ? -1 : 1));
    let cluster = [byDate[0]];
    for (let i = 1; i < byDate.length; i++) {
      if (daysApart(byDate[i].date, byDate[i - 1].date) <= 4) cluster.push(byDate[i]);
      else {
        if (cluster.length > 1) clusters.push(cluster);
        cluster = [byDate[i]];
      }
    }
    if (cluster.length > 1) clusters.push(cluster);
  }
  return clusters.sort((a, b) => (a[0].date < b[0].date ? 1 : -1));
}

// Spending rows (money out, not ignored) with no envelope assigned yet.
export function findUncategorized(transactions) {
  return transactions.filter(
    (t) => !t.excluded && Number(t.amount) > 0 && (!t.categoryId || t.categoryId === 'needs-review')
  );
}
