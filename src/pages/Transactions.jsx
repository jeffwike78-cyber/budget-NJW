import { useState, useRef, useEffect } from 'react';
import { todayStr } from '../lib/storage';
import { categorizeWithAI } from '../lib/aiCategorize';
import { scanReceipt } from '../lib/receiptsClient';
import TxList from '../components/TxList';

function normalize(desc) {
  return desc.trim().toLowerCase();
}

export default function Transactions({ budgetState, setBudgetState, transactions, addTransaction, recategorize, setExcluded, setTaxCategory, pendingScanFile, onScanConsumed }) {
  // Needs Review is for unclear spending, not unclear deposits — money coming
  // in (amount < 0, the reverse of "positive = expense") never belongs here,
  // even if it somehow got flagged that way.
  const needsReview = transactions.filter((t) => t.categoryId === 'needs-review' && Number(t.amount) > 0);
  const [form, setForm] = useState({
    description: '', // vendor / where it was spent (shown in the list)
    note: '', // what was purchased (from the receipt)
    amount: '',
    date: todayStr(),
    categoryId: budgetState.categories?.[0]?.id || '',
    accountId: budgetState.accounts?.[0]?.id || '',
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanMsg, setScanMsg] = useState(null);
  const [scanMeta, setScanMeta] = useState(null); // { note, receiptPath, date } from a scan awaiting Add
  const [addMsg, setAddMsg] = useState(null);
  const [addOk, setAddOk] = useState(false);
  const scanRef = useRef(null);

  async function processScan(file) {
    if (!file) return;
    setScanBusy(true);
    setScanMsg(null);
    try {
      const data = await scanReceipt(file);
      const matchedCategory = data.categoryId && budgetState.categories.some((c) => c.id === data.categoryId);
      setForm((f) => ({
        ...f,
        description: data.merchant || f.description, // Vendor
        note: data.summary || f.note, // Description (what was purchased)
        amount: data.amount ? String(data.amount) : f.amount,
        date: data.date || f.date, // full receipt date
        categoryId: matchedCategory ? data.categoryId : f.categoryId,
      }));
      setScanMeta({ receiptPath: data.receiptPath || null });
      setScanMsg('Filled in from your receipt — review the fields and tap Add.');
    } catch (err) {
      setScanMsg(err.message);
    } finally {
      setScanBusy(false);
    }
  }

  async function onScanFile(e) {
    const file = e.target.files?.[0];
    await processScan(file);
    e.target.value = '';
  }

  // A photo captured from the Overview quick-scan button arrives here — run it
  // through OCR once, then clear it so it doesn't reprocess on re-render.
  useEffect(() => {
    if (!pendingScanFile) return;
    processScan(pendingScanFile);
    onScanConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScanFile]);

  function handleDescriptionChange(value) {
    if (addMsg) setAddMsg(null);
    const remembered = budgetState.merchantMemory[normalize(value)];
    setForm((f) => ({ ...f, description: value, categoryId: remembered || f.categoryId }));
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    setAddMsg(null);
    setAddOk(false);
    const error = await addTransaction({
      date: form.date || todayStr(),
      description: form.description.trim(), // Vendor
      amount: Number(form.amount),
      categoryId: form.categoryId,
      accountId: form.accountId,
      note: form.note?.trim() || null, // Description (what was purchased)
      // A scanned receipt becomes a 'receipt' transaction (so it auto-links to
      // the bank charge later) and carries its attached photo.
      source: scanMeta ? 'receipt' : 'manual',
      receiptPath: scanMeta?.receiptPath,
    });
    if (error) {
      // Keep the form filled so nothing is lost, and show what went wrong.
      setAddMsg(`Couldn’t save: ${error.message || error.hint || JSON.stringify(error)}`);
      return;
    }
    setBudgetState((prev) => ({
      ...prev,
      merchantMemory: { ...prev.merchantMemory, [normalize(form.description)]: form.categoryId },
    }));
    const savedVendor = form.description.trim();
    setForm((f) => ({ ...f, description: '', note: '', amount: '', date: todayStr() }));
    setScanMeta(null);
    setScanMsg(null);
    // Positive confirmation so a save is never ambiguous — clears on the next edit.
    setAddMsg(`Added “${savedVendor}” ✓`);
    setAddOk(true);
  }

  async function handleRecategorize(txId, categoryId) {
    const tx = transactions.find((t) => t.id === txId);
    await recategorize(txId, categoryId);
    if (tx) {
      setBudgetState((prev) => ({ ...prev, merchantMemory: { ...prev.merchantMemory, [normalize(tx.description)]: categoryId } }));
    }
  }

  // Send everything in "Needs Review" to Claude, apply the confident matches,
  // and remember them so the same merchant is auto-placed next time.
  async function autoCategorize() {
    if (needsReview.length === 0 || aiBusy) return;
    setAiBusy(true);
    setAiStatus(null);
    try {
      const spendingCategories = budgetState.categories.filter((c) => c.id !== 'needs-review');
      const validIds = new Set(spendingCategories.map((c) => c.id));
      const results = await categorizeWithAI(needsReview, spendingCategories);

      const memoryUpdates = {};
      let applied = 0;
      await Promise.all(
        results.map(async (r) => {
          const tx = needsReview.find((t) => String(t.id) === String(r.id));
          if (!tx) return;
          if (!r.categoryId || r.categoryId === 'needs-review' || !validIds.has(r.categoryId)) return;
          if (typeof r.confidence === 'number' && r.confidence < 0.45) return;
          await recategorize(tx.id, r.categoryId);
          memoryUpdates[normalize(tx.description)] = r.categoryId;
          applied += 1;
        })
      );

      if (Object.keys(memoryUpdates).length > 0) {
        setBudgetState((prev) => ({
          ...prev,
          merchantMemory: { ...prev.merchantMemory, ...memoryUpdates },
        }));
      }

      setAiStatus(
        applied === 0
          ? 'The AI reviewed them but wasn’t confident enough to place any — please sort these by hand.'
          : `The AI sorted ${applied} of ${needsReview.length} into envelopes. Anything still here needs a manual pick.`
      );
    } catch (err) {
      setAiStatus(err.message || 'Something went wrong reaching the AI.');
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <>
      <h1 className="page-title">Transactions</h1>

      <section className="card">
        <div className="card-header">
          <h2>Add a transaction</h2>
          <span className="pill">Positive = expense, negative = income</span>
        </div>
        <form className="tx-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Vendor (where you spent it)"
            value={form.description}
            onChange={(e) => handleDescriptionChange(e.target.value)}
          />
          <input
            type="text"
            placeholder="Description (what you bought)"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
          />
          <div className="tx-form-row">
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              placeholder="$"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <input
              type="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
            />
          </div>
          <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
            {budgetState.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
            {budgetState.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button type="submit" className="primary-btn">
            Add
          </button>
        </form>
        {addMsg && (
          <p className={`module-note ${addOk ? 'form-ok' : 'form-error'}`} role="status" aria-live="polite">
            {addMsg}
          </p>
        )}
        <div className="ai-actions">
          <button type="button" className="secondary-btn" onClick={() => scanRef.current?.click()} disabled={scanBusy}>
            {scanBusy ? 'Reading receipt…' : '📷 Scan a receipt'}
          </button>
          <input ref={scanRef} type="file" accept="image/*" hidden onChange={onScanFile} />
          {scanMsg && <span className="module-note ai-status">{scanMsg}</span>}
        </div>
        <p className="module-note">
          Take (or choose) a photo of a receipt — the fields above fill in for you to review, then tap
          <strong> Add</strong>. It counts toward its envelope right away, keeps the photo, and links to
          the bank charge automatically when it posts.
        </p>
      </section>

      {needsReview.length > 0 && (
        <section className="card needs-review-card">
          <div className="card-header">
            <h2>Needs Review</h2>
            <span className="pill">{needsReview.length} flagged</span>
          </div>
          <p className="module-note">
            These couldn&apos;t be placed automatically — let the AI take a pass, or pick a category yourself.
          </p>
          <div className="ai-actions">
            <button type="button" className="primary-btn" onClick={autoCategorize} disabled={aiBusy}>
              {aiBusy ? 'Categorizing…' : '✨ Auto-categorize with AI'}
            </button>
            {aiStatus && <span className="module-note ai-status">{aiStatus}</span>}
          </div>
          <TxList
            transactions={needsReview}
            categories={budgetState.categories}
            onRecategorize={handleRecategorize}
            onToggleExcluded={setExcluded}
            onSetTaxCategory={setTaxCategory}
            taxLabels={budgetState.taxLabels}
            showReceiptLookup
          />
        </section>
      )}

      <section className="card">
        <div className="card-header">
          <h2>All transactions</h2>
          <span className="pill">{transactions.length} total</span>
        </div>
        <TxList
          transactions={transactions}
          categories={budgetState.categories}
          onRecategorize={handleRecategorize}
          onToggleExcluded={setExcluded}
          onSetTaxCategory={setTaxCategory}
          taxLabels={budgetState.taxLabels}
          showReceiptLookup
        />
      </section>
    </>
  );
}
