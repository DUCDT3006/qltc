import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { QuickAddModal } from './components/QuickAddModal';
import { SettingsModal } from './components/SettingsModal';
import { DashboardView } from './views/DashboardView';
import { InboxSwipeView } from './views/InboxSwipeView';
import { BudgetView } from './views/BudgetView';
import { InvestmentsView } from './views/InvestmentsView';
import {
  INITIAL_JARS,
  INITIAL_ACCOUNTS,
  INITIAL_INCOME_SOURCES,
  INITIAL_PENDING_TRANSACTIONS,
  INITIAL_CONFIRMED_TRANSACTIONS,
  INITIAL_HOLDINGS
} from './mockData';
import { TabType, Transaction, Jar, BankAccount, Holding, IncomeSource } from './types';

export function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);

  // States
  const [jars, setJars] = useState<Jar[]>(INITIAL_JARS);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>(INITIAL_INCOME_SOURCES);
  const [accounts, setAccounts] = useState<BankAccount[]>(INITIAL_ACCOUNTS);
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(INITIAL_PENDING_TRANSACTIONS);
  const [confirmedTransactions, setConfirmedTransactions] = useState<Transaction[]>(INITIAL_CONFIRMED_TRANSACTIONS);
  const [holdings, setHoldings] = useState<Holding[]>(INITIAL_HOLDINGS);

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
      // 1. Cập nhật số tiền vào hũ nếu là expense
      if (txn.type === 'expense' && txn.suggestedJarCode) {
        setJars(prev => prev.map(j => {
          if (j.code === txn.suggestedJarCode) {
            return { ...j, spentThisMonth: j.spentThisMonth + txn.amount };
          }
          return j;
        }));
      }

      // 2. Chuyển sang danh sách đã xác nhận
      setConfirmedTransactions(prev => [{ ...txn, status: 'confirmed' }, ...prev]);

      // 3. Trừ khỏi danh sách chờ
      setPendingTransactions(prev => prev.filter(t => t.id !== id));
    }
  };

  // Bỏ qua giao dịch (reject)
  const handleRejectTransaction = (id: string) => {
    setPendingTransactions(prev => prev.filter(t => t.id !== id));
  };

  // Xóa giao dịch đã duyệt
  const handleDeleteConfirmed = (id: string) => {
    setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
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

    const createdTxn: Transaction = {
      id: `txn_${Date.now()}`,
      bankCode: 'CASH',
      accountMask: 'VÍ',
      accountName: 'Ghi chép thủ công',
      type: newTxn.type,
      amount: newTxn.amount,
      description: newTxn.description,
      suggestedCategory: newTxn.type === 'income' ? 'Thu nhập' : 'Chi tiêu',
      suggestedJarCode: 'NEC',
      occurredAt: 'Vừa xong',
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [createdTxn, ...prev]);
  };

  // Thêm tài sản đầu tư mới
  const handleAddHolding = (newHolding: Holding) => {
    setHoldings(prev => {
      const idx = prev.findIndex(h => h.symbol === newHolding.symbol);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = newHolding;
        return updated;
      }
      return [...prev, newHolding];
    });
  };

  // Thêm nguồn thu mới
  const handleAddIncomeSource = (newSource: IncomeSource) => {
    setIncomeSources(prev => [...prev, newSource]);
  };

  // Cập nhật hạn mức hũ
  const handleUpdateJarLimit = (jarId: string, limit: number) => {
    setJars(prev => prev.map(j => j.id === jarId ? { ...j, monthlyLimit: limit } : j));
  };

  // Giả lập 1 thông báo ngân hàng gửi tới Android để test
  const handleSimulateNotification = () => {
    const mockBanks = [
      { code: 'VCB', acc: '0071', name: 'Vietcombank · *0071', desc: 'PETROLIMEX DO XANG A95', amt: 70000, cat: 'Di chuyển', jar: 'NEC', raw: 'TK 0071... -70,000 VND luc 18:45 04/11. ND: PETROLIMEX CUA HANG SO 1' },
      { code: 'MB', acc: '0340', name: 'MB Bank · *0340', desc: 'NHAN TIEN FREELANCE WEB', amt: 5500000, cat: 'Thu nhập ngoài / Freelance', jar: 'FFA', raw: 'GD: +5,500,000VND vao 18:50 04/11. TK 0340... ND: THANH TOAN DU AN WEB' },
      { code: 'TCB', acc: '1902', name: 'Techcombank · *1902', desc: 'KATINAT SAIGON CAFE', amt: 65000, cat: 'Cafe & Trà', jar: 'PLAY', raw: 'TK 1902... -65,000 VND vao 19:02 04/11. ND: KATINAT SAIGON' }
    ];
    const picked = mockBanks[Math.floor(Math.random() * mockBanks.length)];
    const newPending: Transaction = {
      id: `txn_sim_${Date.now()}`,
      bankCode: picked.code,
      accountMask: picked.acc,
      accountName: picked.name,
      type: picked.amt > 1000000 ? 'income' : 'expense',
      amount: picked.amt,
      description: picked.desc,
      rawQuote: picked.raw,
      suggestedCategory: picked.cat,
      suggestedJarCode: picked.jar,
      occurredAt: 'Vừa xong',
      status: 'pending'
    };
    setPendingTransactions(prev => [newPending, ...prev]);
    setCurrentTab('transactions');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#161C1E] via-[#0E1314] to-[#0A0D0E] text-[#F2F5F5] flex flex-col justify-between max-w-md mx-auto relative shadow-2xl overflow-x-hidden">
      {/* Glow effect at top */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-radial from-[#657D81]/20 to-transparent pointer-events-none"></div>

      {/* Top Navbar */}
      <Navbar
        pendingCount={pendingTransactions.length}
        onOpenInbox={() => setCurrentTab('transactions')}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
            privacyMode={privacyMode}
            onOpenInbox={() => setCurrentTab('transactions')}
            onOpenBudget={() => setCurrentTab('budget')}
            onOpenInvestments={() => setCurrentTab('investments')}
          />
        )}

        {currentTab === 'transactions' && (
          <InboxSwipeView
            pendingTransactions={pendingTransactions}
            confirmedTransactions={confirmedTransactions}
            onConfirm={handleConfirmTransaction}
            onReject={handleRejectTransaction}
            onDeleteConfirmed={handleDeleteConfirmed}
            onBack={() => setCurrentTab('dashboard')}
          />
        )}

        {currentTab === 'budget' && (
          <BudgetView
            jars={jars}
            incomeSources={incomeSources}
            onAddIncomeSource={handleAddIncomeSource}
            onUpdateJarLimit={handleUpdateJarLimit}
          />
        )}

        {currentTab === 'investments' && (
          <InvestmentsView
            holdings={holdings}
            onAddHolding={handleAddHolding}
          />
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

      {/* Settings & Accounts Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        accounts={accounts}
        onAddAccount={(newAcc) => setAccounts(prev => [...prev, newAcc])}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode(!privacyMode)}
        onSimulateNotification={handleSimulateNotification}
      />
    </div>
  );
}

export default App;
