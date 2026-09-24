// Ask the server to scan connected inboxes for charitable-donation receipts in
// a calendar year and match each to an existing transaction. Read-only — the
// caller applies whatever the user approves.
export async function scanCharity(year) {
  const res = await fetch('/api/gmail/charity-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ year }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Charity scan failed.');
  return data;
}
