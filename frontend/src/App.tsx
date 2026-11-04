import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { QuickAddModal } from './components/QuickAddModal';
import { DashboardView } from './views/DashboardView';
import { InboxSwipeView } from './views/InboxSwipeView';
import { BudgetView } from './views/BudgetView';
import { InvestmentsView } from './views/InvestmentsView';
import {
  INITIAL_JARS,
  INITIAL_ACCOUNTS,
  INITIAL_PENDING_TRANSACTIONS,
  INITIAL_HOLDINGS
} from './mockData';
import { TabType, Transaction, Jar, BankAccount } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [jars, setJars] = useState<Jar[]>(INITIAL_JARS);
  const [accounts, setAccounts] = useState<BankAccount[]>(INITIAL_ACCOUNTS);
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(INITIAL_PENDING_TRANSACTIONS);
  const [holdings] = useState(INITIAL_HOLDINGS);

  // Tính tổng số dư và tài sản ròng
  const liquidCash = accounts
    .filter(a => ['bank', 'cash', 'ewallet'].includes(a.type))
    .reduce((sum, a) => sum + a.balance, 0);

  const totalInvestments = holdings.reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const netWorth = liquidCash + totalInvestments;

  // Xác nhận giao dịch (approve)
  const handleConfirmTransaction = (id: string) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (txn) {
      // Cập nhật số tiền vào hũ nếu là expense
      if (txn.type === 'expense' && txn.suggestedJarCode) {
        setJars(prev => prev.map(j => {
          if (j.code === txn.suggestedJarCode) {
            return { ...j, spentThisMonth: j.spentThisMonth + txn.amount };
          }
          return j;
        }));
      }
      // Trừ khỏi danh sách chờ
      setPendingTransactions(prev => prev.filter(t => t.id !== id));
    }
  };

  // Bỏ qua giao dịch (reject)
  const handleRejectTransaction = (id: string) => {
    setPendingTransactions(prev => prev.filter(t => t.id !== id));
  };

  // Thêm giao dịch thủ công
  const handleAddTransaction = (newTxn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    accountId: string;
  }) => {
    // Cập nhật số dư tài khoản
    setAccounts(prev => prev.map(acc => {
      if (acc.id === newTxn.accountId) {
        const delta = newTxn.type === 'income' ? newTxn.amount : -newTxn.amount;
        return { ...acc, balance: acc.balance + delta };
      }
      return acc;
    }));

    // Cập nhật hũ nếu là expense
    if (newTxn.type === 'expense' && newTxn.jarId) {
      setJars(prev => prev.map(j => {
        if (j.id === newTxn.jarId) {
          return { ...j, spentThisMonth: j.spentThisMonth + newTxn.amount };
        }
        return j;
      }));
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#161C1E] via-[#0E1314] to-[#0A0D0E] text-[#F2F5F5] flex flex-col justify-between max-w-md mx-auto relative shadow-2xl overflow-x-hidden">
      {/* Glow effect at top */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-radial from-[#657D81]/20 to-transparent pointer-events-none"></div>

      {/* Top Navbar */}
      <Navbar
        pendingCount={pendingTransactions.length}
        onOpenInbox={() => setCurrentTab('transactions')}
      />

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto">
        {currentTab === 'dashboard' && (
          <DashboardView
            netWorth={netWorth}
            liquidCash={liquidCash}
            totalInvestments={totalInvestments}
            jars={jars}
            holdings={holdings}
            pendingCount={pendingTransactions.length}
            onOpenInbox={() => setCurrentTab('transactions')}
            onOpenBudget={() => setCurrentTab('budget')}
            onOpenInvestments={() => setCurrentTab('investments')}
          />
        )}

        {currentTab === 'transactions' && (
          <InboxSwipeView
            pendingTransactions={pendingTransactions}
            onConfirm={handleConfirmTransaction}
            onReject={handleRejectTransaction}
            onBack={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'budget' && (
          <BudgetView
            jars={jars}
            onUpdateJar={(id, limit) => {
              setJars(prev => prev.map(j => j.id === id ? { ...j, monthlyLimit: limit } : j));
            }}
          />
        )}

        {currentTab === 'investments' && (
          <InvestmentsView holdings={holdings} />
        )}
      </main>

      {/* Floating Bottom Nav */}
      <BottomNav
        currentTab={currentTab}
        onChangeTab={setCurrentTab}
        onOpenQuickAdd={() => setIsQuickAddOpen(true)}
        pendingCount={pendingTransactions.length}
      />

      {/* Quick Add Modal */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => setIsQuickAddOpen(false)}
        jars={jars}
        accounts={accounts}
        onAddTransaction={handleAddTransaction}
      />
    </div>
  );
}

export default App;
