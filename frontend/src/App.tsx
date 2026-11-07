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
import {
  TabType,
  Transaction,
  Jar,
  BankAccount,
  Holding,
  IncomeSource,
  PlannedExpense,
  UserProfile,
  FmarketFund
} from './types';

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
  const [isSyncingPrices, setIsSyncingPrices] = useState(false);

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
  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpense[]>(() => {
    const saved = localStorage.getItem('qltc_planned_expenses');
    if (saved !== null) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  const [accounts, setAccounts] = useState<BankAccount[]>(INITIAL_ACCOUNTS);
  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(INITIAL_PENDING_TRANSACTIONS);
  const [confirmedTransactions, setConfirmedTransactions] = useState<Transaction[]>(INITIAL_CONFIRMED_TRANSACTIONS);
  const [holdings, setHoldings] = useState<Holding[]>(INITIAL_HOLDINGS);
  const [fmarketFunds, setFmarketFunds] = useState<FmarketFund[]>([]);

  // Thông tin người dùng
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    try {
      const saved = localStorage.getItem('qltc_user_profile');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      name: 'Anh Đức',
      email: 'duc@qltc.local',
      phone: '',
      avatar: ''
    };
  });

  useEffect(() => {
    localStorage.setItem('qltc_income_sources', JSON.stringify(incomeSources));
  }, [incomeSources]);

  useEffect(() => {
    localStorage.setItem('qltc_planned_expenses', JSON.stringify(plannedExpenses));
  }, [plannedExpenses]);

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
            suggestedCategory: t.type === 'transfer' ? 'Chuyển khoản nội bộ' : (t.notes || t.jar_name || (t.type === 'income' ? 'Thu nhập' : 'Chi tiêu')),
            suggestedJarCode: t.jar_code || 'NEC',
            occurredAt: formatOccurredTime(t.occurred_at),
            occurredAtIso: t.occurred_at,
            status: 'pending',
            transferPairId: t.transfer_pair_id,
            pairedTxnId: t.paired_txn_id,
            pairedAccountName: t.paired_account_name,
            pairedBankCode: t.paired_bank_code,
            pairedAccountMask: t.paired_account_mask,
            pairedType: t.paired_type
          }));

          const seenPairs = new Set<string>();
          const dedupedPending: Transaction[] = [];
          for (const item of mapped) {
            if (item.transferPairId) {
              if (seenPairs.has(item.transferPairId)) continue;
              seenPairs.add(item.transferPairId);
            }
            dedupedPending.push(item);
          }
          setPendingTransactions(dedupedPending);
        }
      }

      // 2. Giao dịch đã duyệt (Confirmed - lấy tối đa 250 giao dịch để thống kê tháng/quý/năm)
      const confRes = await fetch(`${API_BASE}/transactions?status=confirmed&limit=250`);
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
            suggestedCategory: t.type === 'transfer' ? 'Chuyển khoản nội bộ' : (t.notes || t.jar_name || (t.type === 'income' ? 'Thu nhập' : 'Chi tiêu')),
            suggestedJarCode: t.jar_code || 'NEC',
            occurredAt: formatOccurredTime(t.occurred_at),
            occurredAtIso: t.occurred_at,
            status: 'confirmed',
            transferPairId: t.transfer_pair_id,
            pairedTxnId: t.paired_txn_id,
            pairedAccountName: t.paired_account_name,
            pairedBankCode: t.paired_bank_code,
            pairedAccountMask: t.paired_account_mask,
            pairedType: t.paired_type
          }));
          setConfirmedTransactions(mapped);
        }
      }

      // 3. Danh sách tài khoản ngân hàng & tiền mặt
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

      // 4. Danh sách các hũ chi tiêu
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

      // 5. Danh mục tài sản đầu tư (Quỹ Fmarket, Cổ phiếu, Vàng, Bạc, Đất, Crypto)
      const holdingsRes = await fetch(`${API_BASE}/holdings`);
      if (holdingsRes.ok) {
        const data = await holdingsRes.json();
        if (Array.isArray(data.holdings)) {
          setHoldings(data.holdings.map((h: any) => ({
            id: h.id,
            symbol: h.symbol,
            name: h.name,
            assetClass: h.asset_class,
            quantity: h.quantity,
            avgCost: h.avg_cost,
            currentPrice: h.current_price,
            unit: h.unit || (
              h.asset_class === 'gold' ? 'chỉ' :
              h.asset_class === 'silver' ? 'lượng' :
              h.asset_class === 'land' ? 'm²' :
              h.asset_class === 'fund' ? 'CCQ' : 'CP'
            ),
            priceUpdatedAt: h.price_updated_at
          })));
        }
      }

      // 6. Nguồn thu dự kiến & Khoản chi dự kiến từ D1
      const incRes = await fetch(`${API_BASE}/income-sources`);
      if (incRes.ok) {
        const data = await incRes.json();
        if (Array.isArray(data.incomeSources) && data.incomeSources.length > 0) {
          setIncomeSources(data.incomeSources.map((s: any) => ({
            id: s.id,
            name: s.name,
            kind: s.kind || 'fixed',
            expectedAmount: s.expected_amount || 0,
            recurrence: s.recurrence || 'Hàng tháng'
          })));
        }
      }

      const pexpRes = await fetch(`${API_BASE}/planned-expenses`);
      if (pexpRes.ok) {
        const data = await pexpRes.json();
        if (Array.isArray(data.plannedExpenses)) {
          setPlannedExpenses(data.plannedExpenses.map((e: any) => ({
            id: e.id,
            name: e.name,
            jarCode: e.jar_code || 'NEC',
            expectedAmount: e.expected_amount || 0,
            recurrence: e.recurrence || 'Hàng tháng',
            note: e.note
          })));
        }
      }

      // 7. Thông tin người dùng từ D1
      const userRes = await fetch(`${API_BASE}/user/profile`);
      if (userRes.ok) {
        const data = await userRes.json();
        if (data.user) {
          setUserProfile(data.user);
          localStorage.setItem('qltc_user_profile', JSON.stringify(data.user));
        }
      }
    } catch (err) {
      console.warn('Backend chưa sẵn sàng, tiếp tục với bộ nhớ máy:', err);
    }
  }, []);

  // Tải danh sách Quỹ mở từ Fmarket API
  const loadFmarketFunds = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/market/fmarket-funds`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.funds)) {
          setFmarketFunds(data.funds);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadDataFromBackend();
    loadFmarketFunds();
  }, [loadDataFromBackend, loadFmarketFunds]);

  // Đồng bộ giá NAV Fmarket & Vàng/Bạc/Crypto mới nhất
  const handleSyncMarketPrices = async () => {
    setIsSyncingPrices(true);
    try {
      await fetch(`${API_BASE}/market/sync-prices`, { method: 'POST' });
      await loadDataFromBackend();
      await loadFmarketFunds();
    } catch (e) {
      console.error('Lỗi đồng bộ giá thị trường:', e);
    } finally {
      setIsSyncingPrices(false);
    }
  };

  // Nút Làm mới & Đồng bộ
  const handleRefresh = async () => {
    setIsSyncing(true);
    try {
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

      if (txn.type === 'expense' && finalJarCode) {
        setJars(prev => prev.map(j => {
          if (j.code === finalJarCode) {
            return { ...j, spentThisMonth: j.spentThisMonth + txn.amount };
          }
          return j;
        }));
      }

      const confirmedTxn: Transaction = {
        ...txn,
        suggestedJarCode: finalJarCode,
        suggestedCategory: finalCategory,
        occurredAtIso: txn.occurredAtIso || new Date().toISOString(),
        status: 'confirmed'
      };
      setConfirmedTransactions(prev => [confirmedTxn, ...prev]);
      setPendingTransactions(prev => prev.filter(t => t.id !== id));

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

  // Thực hiện Reset trực tiếp
  const handleDirectReset = async (scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'all') => {
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
      setPlannedExpenses([]);
      localStorage.setItem('qltc_income_sources', '[]');
      localStorage.setItem('qltc_planned_expenses', '[]');
    }
    if (scope === 'all') {
      setJars(prev => prev.map(j => ({ ...j, spentThisMonth: 0, monthlyLimit: 0 })));
    }

    try {
      await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: scope === 'income' ? 'transactions' : scope, clearNotifications: true })
      });
      await loadDataFromBackend();
    } catch (err) {
      console.error('Lỗi gọi API reset:', err);
    }
  };

  // Thêm / sửa / xóa nguồn thu dự kiến
  const handleAddIncomeSource = async (newSource: IncomeSource) => {
    setIncomeSources(prev => {
      const idx = prev.findIndex(s => s.id === newSource.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = newSource;
        return copy;
      }
      return [...prev, newSource];
    });
    try {
      await fetch(`${API_BASE}/income-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSource)
      });
    } catch (e) {
      console.error('Lỗi lưu nguồn thu dự kiến:', e);
    }
  };

  const handleDeleteIncomeSource = async (id: string) => {
    setIncomeSources(prev => prev.filter(s => s.id !== id));
    try {
      await fetch(`${API_BASE}/income-sources/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Lỗi xóa nguồn thu dự kiến:', e);
    }
  };

  // Thêm / xóa khoản chi dự kiến
  const handleAddPlannedExpense = async (newExp: PlannedExpense) => {
    setPlannedExpenses(prev => [...prev, newExp]);
    try {
      await fetch(`${API_BASE}/planned-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newExp)
      });
    } catch (e) {
      console.error('Lỗi lưu khoản chi dự kiến:', e);
    }
  };

  const handleDeletePlannedExpense = async (id: string) => {
    setPlannedExpenses(prev => prev.filter(e => e.id !== id));
    try {
      await fetch(`${API_BASE}/planned-expenses/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Lỗi xóa khoản chi dự kiến:', e);
    }
  };

  // Xóa giao dịch đã duyệt
  const handleDeleteConfirmed = async (id: string) => {
    setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Lỗi xóa giao dịch:', e);
    }
  };

  // Thêm giao dịch thủ công
  const handleAddTransaction = async (newTxn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    accountId: string;
  }) => {
    setAccounts(prev => prev.map(acc => {
      if (acc.id === newTxn.accountId) {
        const delta = newTxn.type === 'income' ? newTxn.amount : -newTxn.amount;
        return { ...acc, balance: acc.balance + delta };
      }
      return acc;
    }));

    const matchedJar = jars.find(j => j.id === newTxn.jarId);
    const jarCode = matchedJar?.code || 'NEC';

    if (newTxn.type === 'expense' && newTxn.jarId) {
      setJars(prev => prev.map(j => {
        if (j.id === newTxn.jarId) {
          return { ...j, spentThisMonth: j.spentThisMonth + newTxn.amount };
        }
        return j;
      }));
    }

    const txnId = `txn_${Date.now()}`;
    const isoNow = new Date().toISOString();
    const createdTxn: Transaction = {
      id: txnId,
      bankCode: 'CASH',
      accountMask: 'VÍ',
      accountName: 'Ghi chép thủ công',
      type: newTxn.type,
      amount: newTxn.amount,
      description: newTxn.description,
      suggestedCategory: newTxn.type === 'income' ? 'Thu nhập' : (matchedJar?.name || 'Chi tiêu'),
      suggestedJarCode: jarCode,
      occurredAt: 'Vừa xong',
      occurredAtIso: isoNow,
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [createdTxn, ...prev]);

    try {
      await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: txnId,
          accountId: newTxn.accountId,
          type: newTxn.type,
          amount: newTxn.amount,
          description: newTxn.description,
          jarId: newTxn.jarId,
          jarCode,
          categoryName: createdTxn.suggestedCategory,
          occurredAt: isoNow
        })
      });
    } catch (e) {
      console.error('Lỗi lưu giao dịch thủ công:', e);
    }
  };

  // Thêm / cập nhật tài sản đầu tư (lưu lên D1)
  const handleAddHolding = async (newHolding: Holding) => {
    setHoldings(prev => {
      const idx = prev.findIndex(h => h.symbol.toUpperCase() === newHolding.symbol.toUpperCase());
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = newHolding;
        return updated;
      }
      return [...prev, newHolding];
    });

    try {
      await fetch(`${API_BASE}/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newHolding)
      });
    } catch (e) {
      console.error('Lỗi lưu tài sản:', e);
    }
  };

  // Xóa tài sản đầu tư
  const handleDeleteHolding = async (symbol: string) => {
    setHoldings(prev => prev.filter(h => h.symbol.toUpperCase() !== symbol.toUpperCase()));
    try {
      await fetch(`${API_BASE}/holdings/${encodeURIComponent(symbol)}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Lỗi xóa tài sản:', e);
    }
  };

  // Cập nhật số dư tài khoản ngân hàng / tiền mặt
  const handleUpdateAccountBalance = async (accountId: string, newBalance: number) => {
    setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, balance: newBalance } : a));
    try {
      await fetch(`${API_BASE}/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: newBalance })
      });
    } catch (e) {
      console.error('Lỗi cập nhật số dư tài khoản:', e);
    }
  };

  const handleAddAccount = async (newAcc: BankAccount) => {
    setAccounts(prev => [...prev, newAcc]);
    try {
      await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAcc.name,
          balance: newAcc.balance,
          bank_code: newAcc.bankCode,
          account_number_mask: newAcc.accountNumberMask,
          type: newAcc.type
        })
      });
      await loadDataFromBackend();
    } catch (e) {
      console.error('Lỗi tạo tài khoản:', e);
    }
  };

  // Thêm hũ mới
  const handleAddJar = async (newJar: { name: string; code?: string; targetPercent: number; monthlyLimit: number; color?: string }) => {
    try {
      const res = await fetch(`${API_BASE}/jars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newJar)
      });
      if (res.ok) {
        await loadDataFromBackend();
      }
    } catch (e) {
      console.error('Lỗi tạo hũ:', e);
    }
  };

  // Cập nhật thông tin hũ
  const handleUpdateJar = async (jarId: string, updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string }) => {
    setJars(prev => prev.map(j => {
      if (j.id === jarId) {
        return {
          ...j,
          name: updates.name ?? j.name,
          monthlyLimit: updates.monthlyLimit ?? j.monthlyLimit,
          targetPercent: updates.targetPercent ?? j.targetPercent,
          color: updates.color ?? j.color
        };
      }
      return j;
    }));

    try {
      await fetch(`${API_BASE}/jars/${jarId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updates.name,
          monthly_limit: updates.monthlyLimit,
          target_percent: updates.targetPercent,
          color: updates.color
        })
      });
    } catch (e) {
      console.error('Lỗi lưu hũ:', e);
    }
  };

  // Cập nhật hàng loạt % các hũ (khi cân bằng về 100%)
  const handleBatchUpdateJarsPercent = async (updates: Array<{ id: string; targetPercent: number; monthlyLimit: number }>) => {
    setJars(prev => prev.map(j => {
      const u = updates.find(item => item.id === j.id);
      if (u) {
        return { ...j, targetPercent: u.targetPercent, monthlyLimit: u.monthlyLimit };
      }
      return j;
    }));

    try {
      await Promise.all(updates.map(u =>
        fetch(`${API_BASE}/jars/${u.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_percent: u.targetPercent,
            monthly_limit: u.monthlyLimit
          })
        })
      ));
    } catch (e) {
      console.error('Lỗi đồng bộ % các hũ:', e);
    }
  };

  // Xóa hũ
  const handleDeleteJar = async (jarId: string) => {
    setJars(prev => prev.filter(j => j.id !== jarId));
    try {
      await fetch(`${API_BASE}/jars/${jarId}`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error('Lỗi xóa hũ:', e);
    }
  };

  // Tự động phân bổ lại các hũ theo tổng thu nhập và tỷ lệ % từng hũ
  const handleAutoAllocateJars = async (totalIncome: number) => {
    const updatedJars = jars.map(j => {
      const targetPct = j.targetPercent || 0.1;
      const limit = Math.round(totalIncome * targetPct);
      return { ...j, monthlyLimit: limit };
    });

    setJars(updatedJars);

    try {
      await Promise.all(updatedJars.map(j =>
        fetch(`${API_BASE}/jars/${j.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthly_limit: j.monthlyLimit })
        })
      ));
    } catch (e) {
      console.error('Lỗi đồng bộ hạn mức hũ:', e);
    }
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
      occurredAtIso: new Date().toISOString(),
      status: 'pending'
    };
    setPendingTransactions(prev => [newPending, ...prev]);
    setCurrentTab('transactions');
  };

  // Cập nhật thông tin hồ sơ cá nhân
  const handleUpdateUserProfile = async (updated: Partial<UserProfile>) => {
    const newProfile = { ...userProfile, ...updated };
    setUserProfile(newProfile);
    localStorage.setItem('qltc_user_profile', JSON.stringify(newProfile));

    try {
      await fetch(`${API_BASE}/user/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
    } catch (e) {
      console.error('Lỗi lưu thông tin cá nhân:', e);
    }
  };

  // Tách 2 giao dịch nếu auto-pairing bị nhầm
  const handleUnpairTransaction = async (txnId: string) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/unpair`, {
        method: 'POST'
      });
      if (res.ok) {
        await loadDataFromBackend();
      }
    } catch (err) {
      console.error('Lỗi tách giao dịch:', err);
    }
  };

  // Ghép cặp thủ công thành chuyển khoản nội bộ
  const handlePairTransfer = async (txnId: string, toAccountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${txnId}/pair-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toAccountId })
      });
      if (res.ok) {
        await loadDataFromBackend();
      }
    } catch (err) {
      console.error('Lỗi ghép cặp chuyển khoản:', err);
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        onRefresh={handleRefresh}
        isSyncing={isSyncing}
        userProfile={userProfile}
      />

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto">
        {currentTab === 'dashboard' && (
          <DashboardView
            netWorth={netWorth}
            liquidCash={liquidCash}
            totalInvestments={totalInvestments}
            accounts={accounts}
            jars={jars}
            holdings={holdings}
            incomeSources={incomeSources}
            plannedExpenses={plannedExpenses}
            confirmedTransactions={confirmedTransactions}
            pendingCount={pendingTransactions.length}
            privacyMode={privacyMode}
            isSyncingPrices={isSyncingPrices}
            onSyncMarketPrices={handleSyncMarketPrices}
            onUpdateAccountBalance={handleUpdateAccountBalance}
            onAddAccount={handleAddAccount}
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
            accounts={accounts}
            onUnpair={handleUnpairTransaction}
            onPairTransfer={handlePairTransfer}
          />
        )}

        {currentTab === 'budget' && (
          <BudgetView
            jars={jars}
            incomeSources={incomeSources}
            plannedExpenses={plannedExpenses}
            confirmedTransactions={confirmedTransactions}
            onAddIncomeSource={handleAddIncomeSource}
            onDeleteIncomeSource={handleDeleteIncomeSource}
            onAddPlannedExpense={handleAddPlannedExpense}
            onDeletePlannedExpense={handleDeletePlannedExpense}
            onAddJar={handleAddJar}
            onUpdateJar={handleUpdateJar}
            onBatchUpdateJarsPercent={handleBatchUpdateJarsPercent}
            onDeleteJar={handleDeleteJar}
            onAutoAllocateJars={handleAutoAllocateJars}
          />
        )}

        {currentTab === 'investments' && (
          <InvestmentsView
            holdings={holdings}
            fmarketFunds={fmarketFunds}
            isSyncingPrices={isSyncingPrices}
            onAddHolding={handleAddHolding}
            onDeleteHolding={handleDeleteHolding}
            onSyncMarketPrices={handleSyncMarketPrices}
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
        onAddAccount={handleAddAccount}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode(!privacyMode)}
        onSimulateNotification={handleSimulateNotification}
        onReprocessSuccess={loadDataFromBackend}
        onOpenResetModal={() => setIsResetOpen(true)}
        userProfile={userProfile}
        onUpdateUserProfile={handleUpdateUserProfile}
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
