// Upload a receipt file for a transaction, and fetch a signed view URL.
export async function uploadReceipt(transactionId, file) {
  const dataBase64 = await fileToBase64(file);
  const res = await fetch('/api/receipts/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId, filename: file.name, contentType: file.type, dataBase64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed.');
  return data;
}

export async function getReceiptUrl(transactionId) {
  const res = await fetch('/api/receipts/url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactionId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'No receipt.');
  return data.url;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
