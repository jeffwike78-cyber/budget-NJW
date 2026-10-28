// Ask the server to pull Amazon (and other split-shipment) receipts from the
// connected inboxes and attach the item detail + best envelope to the matching
// transactions, so they don't have to be chased one by one. Returns counts;
// the transaction list refreshes on its own via the realtime subscription.
export async function scanAmazonReceipts() {
  const res = await fetch('/api/gmail/amazon-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Amazon receipt scan failed.');
  return data;
}
