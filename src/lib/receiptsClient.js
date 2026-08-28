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

// Snap a receipt photo → OCR → returns the extracted fields for review (does
// NOT create a transaction). The photo is normalized to a right-sized JPEG in
// the browser first, which fixes iPhone HEIC/huge-image issues and speeds OCR.
export async function scanReceipt(file) {
  const dataBase64 = await fileToJpegBase64(file);
  const res = await fetch('/api/receipts/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataBase64, contentType: 'image/jpeg' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Receipt scan failed.');
  return data;
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}

// Draw the photo onto a canvas capped at maxDim and re-encode as JPEG. This
// also converts HEIC/PNG to a format the vision model reliably accepts.
async function fileToJpegBase64(file, maxDim = 1600, quality = 0.85) {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    if (!blob) throw new Error('encode failed');
    return await fileToBase64(blob);
  } catch {
    return fileToBase64(file); // fall back to the original bytes
  }
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
