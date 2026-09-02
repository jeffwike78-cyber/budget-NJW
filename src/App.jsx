import { useState, Suspense, lazy } from 'react';
import './App.css';
import TopBar from './components/TopBar';
import Sidebar, { MobileTabBar } from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import Overview from './pages/Overview'; // eager — it's the landing page
// Split the rest into their own chunks so the initial load stays small
// (react-best-practices: bundle-size / code-splitting).
const Transactions = lazy(() => import('./pages/Transactions'));
const Budget = lazy(() => import('./pages/Budget'));
const SinkingFunds = lazy(() => import('./pages/SinkingFunds'));
const Accounts = lazy(() => import('./pages/Accounts'));
const TaxReport = lazy(() => import('./pages/TaxReport'));
const Settings = lazy(() => import('./pages/Settings'));
const Login = lazy(() => import('./pages/Login'));
import { useBudgetState } from './lib/useBudgetState';
import { useBudgetTransactions } from './lib/useBudgetTransactions';
import { useAuth } from './lib/useAuth';
import { signedBalance } from './lib/budgetMath';

function App() {
  const [view, setView] = useState('overview');
  // A receipt photo captured from the Overview quick-scan button, handed to the
  // Transactions page to run OCR and prefill the add form.
  const [pendingScanFile, setPendingScanFile] = useState(null);
  const { session, loading: authLoading, recovery, clearRecovery } = useAuth();
  const [budgetState, setBudgetState, budgetLoading] = useBudgetState();
  const { transactions, addTransaction, splitTransaction, recategorize, setExcluded, setBusiness, setTaxCategory } =
    useBudgetTransactions();

  // Auth gate: everyone signs in to the same shared family budget. A reset-link
  // visit (recovery) always shows the "set a new password" screen first.
  if (authLoading) {
    return <div className="loading-screen">Loading…</div>;
  }
  if (recovery || !session) {
    return (
      <Suspense fallback={<div className="loading-screen">Loading…</div>}>
        <Login
          appName={budgetState.settings?.appName}
          recovery={recovery}
          onRecoveryHandled={clearRecovery}
        />
      </Suspense>
    );
  }

  if (budgetLoading) {
    return <div className="loading-screen">Loading your budget…</div>;
  }

  // Net worth: credit-card balances count against the total, not toward it.
  const totalBalance = budgetState.accounts.reduce((sum, a) => sum + signedBalance(a), 0);

  const txActions = { recategorize, setExcluded, setBusiness, setTaxCategory, splitTransaction };

  return (
    <div className="app-shell">
      <TopBar appName={budgetState.settings?.appName} setView={setView} />
      <div className="app-body">
        <Sidebar view={view} setView={setView} totalBalance={totalBalance} accounts={budgetState.accounts} />
        <main className="app-main">
          <ErrorBoundary key={view}>
          <Suspense fallback={<div className="loading-screen">Loading…</div>}>
          {view === 'overview' && (
            <Overview
              budgetState={budgetState}
              transactions={transactions}
              setView={setView}
              onQuickScan={(file) => {
                setPendingScanFile(file);
                setView('transactions');
              }}
            />
          )}
          {view === 'transactions' && (
            <Transactions
              budgetState={budgetState}
              setBudgetState={setBudgetState}
              transactions={transactions}
              addTransaction={addTransaction}
              pendingScanFile={pendingScanFile}
              onScanConsumed={() => setPendingScanFile(null)}
              {...txActions}
            />
          )}
          {view === 'budget' && (
            <Budget
              budgetState={budgetState}
              setBudgetState={setBudgetState}
              transactions={transactions}
              {...txActions}
            />
          )}
          {view === 'sinking' && (
            <SinkingFunds budgetState={budgetState} setBudgetState={setBudgetState} transactions={transactions} />
          )}
          {view === 'reports' && (
            <TaxReport
              budgetState={budgetState}
              setBudgetState={setBudgetState}
              transactions={transactions}
              setView={setView}
              {...txActions}
            />
          )}
          {view === 'accounts' && (
            <Accounts budgetState={budgetState} setBudgetState={setBudgetState} />
          )}
          {view === 'settings' && (
            <Settings budgetState={budgetState} setBudgetState={setBudgetState} setView={setView} />
          )}
          </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <MobileTabBar view={view} setView={setView} />
    </div>
  );
}

export default App;
