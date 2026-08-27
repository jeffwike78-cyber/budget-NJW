// Client helper: ask the /api/categorize serverless function to sort a batch
// of transactions into envelopes. The function does the actual Claude call
// server-side (the API key never comes near the browser).
export async function categorizeWithAI(transactions, categories) {
  const res = await fetch('/api/categorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transactions: transactions.map((t) => ({
        id: t.id,
        description: t.description,
        amount: t.amount,
      })),
      categories: categories.map((c) => ({ id: c.id, name: c.name, group: c.group })),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Categorization failed (${res.status})`);
  }
  return Array.isArray(data.results) ? data.results : [];
}
