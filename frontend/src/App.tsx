import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { QuickAddModal } from './components/QuickAddModal';
import { SettingsModal } from './components/SettingsModal';
import { ResetModal } from './components/ResetModal';
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

const API_BASE = 'https://qltc-backend.dtd-store.workers.dev/api';

function formatOccurredTime(dateStr?: string): string {
  if (!dateStr) return 'Vừa xong';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    if (isToday) {
      return `Hôm nay · ${hours}:${mins}`;
    }
    return `${day}/${month} · ${hours}:${mins}`;
  } catch {
    return dateStr;
  }
}

export function App() {
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // States
  const [jars, setJars] = useState<Jar[]>(INITIAL_JARS);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>(() => {
    const saved = localStorage.getItem('qltc_income_sources');
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return INITIAL_INCOME_SOURCES;
  });
  const [accounts, setAccounts] = useState<BankAccount[]>(INITIAL_ACCOUNTS);
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(INITIAL_PENDING_TRANSACTIONS);
  const [confirmedTransactions, setConfirmedTransactions] = useState<Transaction[]>(INITIAL_CONFIRMED_TRANSACTIONS);
  const [holdings, setHoldings] = useState<Holding[]>(INITIAL_HOLDINGS);

  useEffect(() => {
    localStorage.setItem('qltc_income_sources', JSON.stringify(incomeSources));
  }, [incomeSources]);

  // Tải dữ liệu thật từ Cloudflare D1
  const loadDataFromBackend = useCallback(async () => {
    try {
      // 1. Giao dịch chờ duyệt (Pending)
      const pendingRes = await fetch(`${API_BASE}/transactions?status=pending`);
      if (pendingRes.ok) {
        const data = await pendingRes.json();
        if (Array.isArray(data.transactions)) {
          const mapped: Transaction[] = data.transactions.map((t: any) => ({
            id: t.id,
            bankCode: t.bank_code || 'BANK',
            accountMask: t.account_number_mask || '****',
            accountName: t.account_name || `${t.bank_code || 'Ngân hàng'} · *${t.account_number_mask || ''}`,
            type: t.type,
            amount: t.amount,
            description: t.description,
            rawQuote: t.raw_body,
            suggestedCategory: t.jar_name || (t.type === 'income' ? 'Thu nhập' : 'Chi tiêu'),
            suggestedJarCode: t.jar_code || 'NEC',
            occurredAt: formatOccurredTime(t.occurred_at),
            status: 'pending'
          }));
          setPendingTransactions(mapped);
        }
      }

      // 2. Giao dịch đã duyệt (Confirmed)
      const confRes = await fetch(`${API_BASE}/transactions?status=confirmed&limit=50`);
      if (confRes.ok) {
        const data = await confRes.json();
        if (Array.isArray(data.transactions)) {
          const mapped: Transaction[] = data.transactions.map((t: any) => ({
            id: t.id,
            bankCode: t.bank_code || 'BANK',
            accountMask: t.account_number_mask || '****',
            accountName: t.account_name || `${t.bank_code || 'Ngân hàng'} · *${t.account_number_mask || ''}`,
            type: t.type,
            amount: t.amount,
            description: t.description,
            rawQuote: t.raw_body,
            suggestedCategory: t.jar_name || (t.type === 'income' ? 'Thu nhập' : 'Chi tiêu'),
            suggestedJarCode: t.jar_code || 'NEC',
            occurredAt: formatOccurredTime(t.occurred_at),
            status: 'confirmed'
          }));
          setConfirmedTransactions(mapped);
        }
      }

      // 3. Danh sách tài khoản ngân hàng thật
      const accRes = await fetch(`${API_BASE}/accounts`);
      if (accRes.ok) {
        const data = await accRes.json();
        if (Array.isArray(data.accounts)) {
          setAccounts(data.accounts.map((a: any) => ({
            id: a.id,
            name: a.name,
            bankCode: a.bank_code,
            accountNumberMask: a.account_number_mask,
            balance: a.balance || 0,
            type: a.type || 'bank'
          })));
        }
      }

      // 4. Danh sách các hũ chi tiêu thật
      const jarsRes = await fetch(`${API_BASE}/jars`);
      if (jarsRes.ok) {
        const data = await jarsRes.json();
        if (Array.isArray(data.jars)) {
          setJars(data.jars.map((j: any) => ({
            id: j.id,
            code: j.code,
            name: j.name,
            targetPercent: j.target_percent,
            monthlyLimit: j.monthly_limit,
            spentThisMonth: j.spent_this_month || 0,
            color: j.color
          })));
        }
      }

      // 5. Danh mục đầu tư thật từ D1
      const holdingsRes = await fetch(`${API_BASE}/holdings`);
      if (holdingsRes.ok) {
        const data = await holdingsRes.json();
        if (Array.isArray(data.holdings)) {
          setHoldings(data.holdings.map((h: any) => ({
            symbol: h.symbol,
            name: h.name,
            assetClass: h.asset_class,
            quantity: h.quantity,
            avgCost: h.avg_cost,
            currentPrice: h.current_price,
            unit: h.asset_class === 'gold' ? 'chỉ' : 'cổ/coin'
          })));
        }
      }
    } catch (err) {
      console.warn('Backend chưa sẵn sàng, tiếp tục với bộ nhớ máy:', err);
    }
  }, []);

  // Tự động nạp dữ liệu khi mở app
  useEffect(() => {
    loadDataFromBackend();
  }, [loadDataFromBackend]);

  // Nút Làm mới & Đồng bộ
  const handleRefresh = async () => {
    setIsSyncing(true);
    try {
      // Reprocess unparsed notifications nếu có
      await fetch(`${API_BASE}/notifications/reprocess`, { method: 'POST' });
    } catch {
      // ignore
    }
    await loadDataFromBackend();
    setIsSyncing(false);
  };

  // Tính tổng số dư và tài sản ròng
  const liquidCash = accounts
    .filter(a => ['bank', 'cash', 'ewallet'].includes(a.type))
    .reduce((sum, a) => sum + a.balance, 0);

  const totalInvestments = holdings.reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const netWorth = liquidCash + totalInvestments;

  // Xác nhận giao dịch (approve / swipe right)
  const handleConfirmTransaction = async (id: string, jarCode?: string, categoryName?: string) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (txn) {
      const finalJarCode = jarCode || txn.suggestedJarCode || 'NEC';
      const finalCategory = categoryName || txn.suggestedCategory;

      // 1. Cập nhật số tiền vào hũ nếu là expense
      if (txn.type === 'expense' && finalJarCode) {
        setJars(prev => prev.map(j => {
          if (j.code === finalJarCode) {
            return { ...j, spentThisMonth: j.spentThisMonth + txn.amount };
          }
          return j;
        }));
      }

      // 2. Chuyển sang danh sách đã xác nhận
      const confirmedTxn: Transaction = {
        ...txn,
        suggestedJarCode: finalJarCode,
        suggestedCategory: finalCategory,
        status: 'confirmed'
      };
      setConfirmedTransactions(prev => [confirmedTxn, ...prev]);

      // 3. Trừ khỏi danh sách chờ
      setPendingTransactions(prev => prev.filter(t => t.id !== id));

      // 4. Lưu trạng thái 'confirmed' lên Cloudflare D1
      try {
        await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'confirmed',
            jarCode: finalJarCode,
            categoryName: finalCategory
          })
        });
      } catch (err) {
        console.error('Lỗi cập nhật giao dịch:', err);
      }
    }
  };

  // Bỏ qua giao dịch (reject / swipe left)
  const handleRejectTransaction = async (id: string) => {
    setPendingTransactions(prev => prev.filter(t => t.id !== id));

    // Lưu trạng thái 'rejected' lên Cloudflare D1
    try {
      await fetch(`${API_BASE}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' })
      });
    } catch (err) {
      console.error('Lỗi từ chối giao dịch:', err);
    }
  };

  // Thực hiện Reset trực tiếp (Zero out state)
  const handleDirectReset = async (scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'all') => {
    // 1. Cập nhật ngay trên bộ nhớ React để UI cập nhật về 0 tức thì
    if (scope === 'transactions' || scope === 'all') {
      setPendingTransactions([]);
      setConfirmedTransactions([]);
      setJars(prev => prev.map(j => ({ ...j, spentThisMonth: 0 })));
    }
    if (scope === 'balances' || scope === 'all') {
      setAccounts(prev => prev.map(a => ({ ...a, balance: 0 })));
    }
    if (scope === 'holdings' || scope === 'all') {
      setHoldings([]);
    }
    if (scope === 'income' || scope === 'all') {
      setIncomeSources([]);
      localStorage.setItem('qltc_income_sources', '[]');
    }
    if (scope === 'all') {
      setJars(prev => prev.map(j => ({ ...j, spentThisMonth: 0, monthlyLimit: 0 })));
    }

    // 2. Gửi lệnh xóa lên Cloudflare D1
    try {
      await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: scope === 'income' ? 'transactions' : scope, clearNotifications: true })
      });
      // Tải lại để đồng bộ hoàn toàn với database
      await loadDataFromBackend();
    } catch (err) {
      console.error('Lỗi gọi API reset:', err);
    }
  };

  // Xóa nguồn thu
  const handleDeleteIncomeSource = (id: string) => {
    setIncomeSources(prev => prev.filter(s => s.id !== id));
  };

  // Tự động phân bổ lại 6 hũ theo tổng thu nhập
  const handleAutoAllocateJars = (income: number) => {
    setJars(prev => prev.map(j => {
      const targetPct = j.targetPercent || 0.1;
      const limit = Math.round(income * targetPct);
      return { ...j, monthlyLimit: limit };
    }));
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
      { code: 'TCB', acc: '2011', name: 'Techcombank · *2011', desc: 'KATINAT SAIGON CAFE', amt: 65000, cat: 'Cafe & Trà', jar: 'PLAY', raw: 'TK 2011... -65,000 VND vao 19:02 04/11. ND: KATINAT SAIGON' }
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
        onRefresh={handleRefresh}
        isSyncing={isSyncing}
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
            incomeSources={incomeSources}
            confirmedTransactions={confirmedTransactions}
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
            jars={jars}
            incomeSources={incomeSources}
          />
        )}

        {currentTab === 'budget' && (
          <BudgetView
            jars={jars}
            incomeSources={incomeSources}
            onAddIncomeSource={handleAddIncomeSource}
            onDeleteIncomeSource={handleDeleteIncomeSource}
            onUpdateJarLimit={handleUpdateJarLimit}
            onAutoAllocateJars={handleAutoAllocateJars}
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
        onReprocessSuccess={loadDataFromBackend}
        onOpenResetModal={() => setIsResetOpen(true)}
      />

      {/* Reset & Financial Calibration Modal */}
      <ResetModal
        isOpen={isResetOpen}
        onClose={() => setIsResetOpen(false)}
        accounts={accounts}
        holdings={holdings}
        onRefreshAll={loadDataFromBackend}
        onDirectReset={handleDirectReset}
      />
    </div>
  );
}

export default App;
