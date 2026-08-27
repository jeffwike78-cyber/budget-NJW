// Ask the server to find a transaction's email receipt and extract its detail.
// The server also saves the note (and best envelope) back onto the transaction,
// which flows into the UI via the realtime transactions subscription.
export async function findReceipt(transactionId) {
  const res = await fetch('/api/gmail/find-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Receipt lookup failed.');
  return data;
}
