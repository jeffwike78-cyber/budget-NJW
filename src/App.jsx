import { useState } from 'react';
import './App.css';
import TopBar from './components/TopBar';
import Sidebar, { MobileTabBar } from './components/Sidebar';
import Overview from './pages/Overview';
import Transactions from './pages/Transactions';
import Budget from './pages/Budget';
import SinkingFunds from './pages/SinkingFunds';
import Accounts from './pages/Accounts';
import { useBudgetState } from './lib/useBudgetState';
import { useBudgetTransactions } from './lib/useBudgetTransactions';

function App() {
  const [view, setView] = useState('overview');
  const [budgetState, setBudgetState, budgetLoading] = useBudgetState();
  const { transactions, addTransaction, recategorize, setExcluded } = useBudgetTransactions();

  if (budgetLoading) {
    return <div className="loading-screen">Loading your budget…</div>;
  }

  const totalBalance = budgetState.accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0);

  return (
    <div className="app-shell">
      <TopBar />
      <div className="app-body">
        <Sidebar view={view} setView={setView} totalBalance={totalBalance} />
        <main className="app-main">
          {view === 'overview' && (
            <Overview budgetState={budgetState} transactions={transactions} setView={setView} />
          )}
          {view === 'transactions' && (
            <Transactions
              budgetState={budgetState}
              setBudgetState={setBudgetState}
              transactions={transactions}
              addTransaction={addTransaction}
              recategorize={recategorize}
              setExcluded={setExcluded}
            />
          )}
          {view === 'budget' && (
            <Budget
              budgetState={budgetState}
              setBudgetState={setBudgetState}
              transactions={transactions}
              recategorize={recategorize}
              setExcluded={setExcluded}
            />
          )}
          {view === 'sinking' && (
            <SinkingFunds budgetState={budgetState} setBudgetState={setBudgetState} />
          )}
          {view === 'accounts' && (
            <Accounts budgetState={budgetState} setBudgetState={setBudgetState} />
          )}
        </main>
      </div>
      <MobileTabBar view={view} setView={setView} />
    </div>
  );
}

export default App;
