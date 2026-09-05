import { useState, useRef, useEffect } from 'react';
import { todayStr } from '../lib/storage';
import { categorizeWithAI } from '../lib/aiCategorize';
import { scanReceipt } from '../lib/receiptsClient';
import TxList from '../components/TxList';

function normalize(desc) {
  return desc.trim().toLowerCase();
}

// Find the account whose name carries these last-4 digits (Plaid names look
// like "Chase · Total Checking ••5319"), so a scanned receipt lands on the card
// that actually paid instead of always defaulting to the first account.
function accountIdForLast4(accounts, last4) {
  if (!last4) return null;
  const match = (accounts || []).find((a) => String(a.name || '').includes(last4));
  return match ? match.id : null;
}

export default function Transactions({ budgetState, setBudgetState, transactions, addTransaction, addSplitTransaction, recategorize, setExcluded, setTaxCategory, splitTransaction, deleteTransaction, pendingScanFile, onScanConsumed }) {
  // Needs Review is for unclear spending, not unclear deposits — money coming
  // in (amount < 0, the reverse of "positive = expense") never belongs here,
  // even if it somehow got flagged that way.
  const needsReview = transactions.filter((t) => t.categoryId === 'needs-review' && Number(t.amount) > 0);
  const needsReviewIds = new Set(needsReview.map((t) => t.id));
  // Reviewed = everything active that isn't waiting on review; Hidden = ignored.
  const reviewed = transactions.filter((t) => !t.excluded && !needsReviewIds.has(t.id));
  const hidden = transactions.filter((t) => t.excluded);
  const REVIEWED_CAP = 60;
  const [showReviewed, setShowReviewed] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [showAllReviewed, setShowAllReviewed] = useState(false);
  const reviewedShown = showAllReviewed ? reviewed : reviewed.slice(0, REVIEWED_CAP);
  const [form, setForm] = useState({
    description: '', // vendor / where it was spent (shown in the list)
    note: '', // what was purchased (from the receipt)
    amount: '',
    date: todayStr(),
    categoryId: budgetState.categories?.[0]?.id || '',
    accountId: budgetState.accounts?.[0]?.id || '',
  });
  // Split-across-envelopes mode for the add form: when on, the single category
  // select is replaced by category+amount lines that must add up to the amount.
  const [splitMode, setSplitMode] = useState(false);
  const [splitParts, setSplitParts] = useState([]);
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
      const matchedAccountId = accountIdForLast4(budgetState.accounts, data.cardLast4);
      setForm((f) => ({
        ...f,
        description: data.merchant || f.description, // Vendor
        note: data.summary || f.note, // Description (what was purchased)
        amount: data.amount ? String(data.amount) : f.amount,
        date: data.date || f.date, // full receipt date
        categoryId: matchedCategory ? data.categoryId : f.categoryId,
        accountId: matchedAccountId || f.accountId, // card used, read from the receipt
      }));
      setScanMeta({ receiptPath: data.receiptPath || null });
      const accountNote =
        data.cardLast4 && matchedAccountId
          ? ` Matched the card ending ${data.cardLast4} to your account.`
          : data.cardLast4
          ? ` Card ending ${data.cardLast4} didn’t match a known account — pick the account below.`
          : '';
      setScanMsg(`Filled in from your receipt — review the fields and tap Add.${accountNote} You can also split it across envelopes below.`);
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

  // --- Split-across-envelopes controls for the add form ---
  const splitTotal = Math.abs(Number(form.amount) || 0);
  const splitPartsSum = splitParts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const splitRemainder = splitTotal - splitPartsSum;
  function toggleSplitMode() {
    if (splitMode) {
      setSplitMode(false);
      return;
    }
    setSplitParts([
      { categoryId: form.categoryId || '', amount: '' },
      { categoryId: '', amount: '' },
    ]);
    setSplitMode(true);
  }
  function updateSplitPart(i, patch) {
    setSplitParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addSplitPart() {
    setSplitParts((prev) => [...prev, { categoryId: '', amount: '' }]);
  }
  function removeSplitPart(i) {
    setSplitParts((prev) => prev.filter((_, idx) => idx !== i));
  }

  function resetForm() {
    setForm((f) => ({ ...f, description: '', note: '', amount: '', date: todayStr() }));
    setScanMeta(null);
    setScanMsg(null);
    setSplitMode(false);
    setSplitParts([]);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    setAddMsg(null);
    setAddOk(false);
    const vendor = form.description.trim();
    const note = form.note?.trim() || null;

    if (splitMode) {
      const cleaned = splitParts
        .map((p) => ({ categoryId: p.categoryId, amount: Number(p.amount) }))
        .filter((p) => p.amount > 0);
      if (cleaned.length < 2) {
        setAddMsg('Add at least two envelope lines to split, or turn split off.');
        return;
      }
      if (cleaned.some((p) => !p.categoryId)) {
        setAddMsg('Pick an envelope for every split line.');
        return;
      }
      const sum = cleaned.reduce((s, p) => s + p.amount, 0);
      if (Math.abs(sum - splitTotal) > 0.01) {
        setAddMsg(`Split lines must add up to $${splitTotal.toFixed(2)} (they total $${sum.toFixed(2)}).`);
        return;
      }
      const error = await addSplitTransaction(
        {
          date: form.date || todayStr(),
          description: vendor,
          accountId: form.accountId,
          note,
          receiptPath: scanMeta?.receiptPath || null,
        },
        cleaned
      );
      if (error) {
        setAddMsg(`Couldn’t save: ${error.message || JSON.stringify(error)}`);
        return;
      }
      // Remember each envelope for this vendor so the next scan pre-fills it.
      setBudgetState((prev) => {
        const merchantMemory = { ...prev.merchantMemory };
        merchantMemory[normalize(vendor)] = cleaned[0].categoryId;
        return { ...prev, merchantMemory };
      });
      resetForm();
      setAddMsg(`Added “${vendor}” split across ${cleaned.length} envelopes ✓`);
      setAddOk(true);
      return;
    }

    const error = await addTransaction({
      date: form.date || todayStr(),
      description: vendor, // Vendor
      amount: Number(form.amount),
      categoryId: form.categoryId,
      accountId: form.accountId,
      note, // Description (what was purchased)
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
    resetForm();
    // Positive confirmation so a save is never ambiguous — clears on the next edit.
    setAddMsg(`Added “${vendor}” ✓`);
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
          {!splitMode && (
            <select value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
              {budgetState.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <select value={form.accountId} onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}>
            {budgetState.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`secondary-btn tx-split-toggle${splitMode ? ' active' : ''}`}
            onClick={toggleSplitMode}
            title="Split this purchase across multiple envelopes"
          >
            {splitMode ? '✕ No split' : '✂ Split across envelopes'}
          </button>
          <button type="submit" className="primary-btn">
            Add
          </button>
        </form>

        {splitMode && (
          <div className="tx-split tx-split-inline">
            <div className="tx-split-head">
              Split <strong>${splitTotal.toFixed(2)}</strong> across envelopes
            </div>
            {splitParts.map((p, i) => (
              <div className="tx-split-row" key={i}>
                <select value={p.categoryId} onChange={(e) => updateSplitPart(i, { categoryId: e.target.value })}>
                  <option value="" disabled>
                    Choose envelope…
                  </option>
                  {budgetState.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="tx-split-amt">
                  $
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    placeholder="0.00"
                    value={p.amount}
                    onChange={(e) => updateSplitPart(i, { amount: e.target.value })}
                  />
                </span>
                {splitParts.length > 2 && (
                  <button type="button" className="link-btn danger" onClick={() => removeSplitPart(i)} aria-label="Remove line">
                    ✕
                  </button>
                )}
              </div>
            ))}
            <div className="tx-split-foot">
              <button type="button" className="link-btn" onClick={addSplitPart}>
                + Add line
              </button>
              <span className={`tx-split-remainder ${Math.abs(splitRemainder) < 0.01 ? 'good' : 'bad'}`}>
                {splitRemainder >= 0 ? `Remaining: $${splitRemainder.toFixed(2)}` : `Over by $${Math.abs(splitRemainder).toFixed(2)}`}
              </span>
            </div>
          </div>
        )}
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

      <section className="card needs-review-card">
        <div className="card-header">
          <h2>Needs Review</h2>
          <span className={`pill ${needsReview.length > 0 ? 'pill-warn' : 'pill-good'}`}>
            {needsReview.length > 0 ? `${needsReview.length} to review` : 'All caught up'}
          </span>
        </div>
        {needsReview.length > 0 ? (
          <>
            <p className="module-note">
              New or unclear transactions land here — let the AI take a pass, or pick a category yourself. Once
              categorized, they move to Reviewed.
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
              incomeCategories={budgetState.incomeCategories}
              onRecategorize={handleRecategorize}
              onSplit={splitTransaction}
              onDelete={deleteTransaction}
              onToggleExcluded={setExcluded}
              onSetTaxCategory={setTaxCategory}
              taxLabels={budgetState.taxLabels}
              showReceiptLookup
              flat
            />
          </>
        ) : (
          <p className="module-note">Nothing to review right now — new transactions will show up here.</p>
        )}
      </section>

      <section className="card">
        <button type="button" className="tx-section-toggle" onClick={() => setShowReviewed((s) => !s)} aria-expanded={showReviewed}>
          <span>Reviewed</span>
          <span className="tx-section-count">{reviewed.length} {showReviewed ? '▴' : '▾'}</span>
        </button>
        {showReviewed && (
          <>
            <TxList
              transactions={reviewedShown}
              categories={budgetState.categories}
              incomeCategories={budgetState.incomeCategories}
              onRecategorize={handleRecategorize}
              onSplit={splitTransaction}
              onDelete={deleteTransaction}
              onToggleExcluded={setExcluded}
              onSetTaxCategory={setTaxCategory}
              taxLabels={budgetState.taxLabels}
              showReceiptLookup
              flat
              emptyLabel="No reviewed transactions yet."
            />
            {reviewed.length > REVIEWED_CAP && (
              <button type="button" className="category-expand-toggle" onClick={() => setShowAllReviewed((s) => !s)}>
                {showAllReviewed ? 'Show recent only' : `Show all ${reviewed.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card">
        <button type="button" className="tx-section-toggle" onClick={() => setShowHidden((s) => !s)} aria-expanded={showHidden}>
          <span>Hidden / ignored</span>
          <span className="tx-section-count">{hidden.length} {showHidden ? '▴' : '▾'}</span>
        </button>
        {showHidden && (
          <TxList
            transactions={hidden}
            categories={budgetState.categories}
            incomeCategories={budgetState.incomeCategories}
            onRecategorize={handleRecategorize}
            onSplit={splitTransaction}
            onDelete={deleteTransaction}
            onToggleExcluded={setExcluded}
            onSetTaxCategory={setTaxCategory}
            taxLabels={budgetState.taxLabels}
            showReceiptLookup
            flat
            emptyLabel="Nothing hidden."
          />
        )}
      </section>
    </>
  );
}
