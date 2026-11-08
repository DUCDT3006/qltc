import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { BottomNav } from './components/BottomNav';
import { QuickAddModal } from './components/QuickAddModal';
import { SettingsModal } from './components/SettingsModal';
import { ResetModal } from './components/ResetModal';
import { ToastProvider, useToast } from './components/Toast';
import { DashboardView } from './views/DashboardView';
import { InboxSwipeView } from './views/InboxSwipeView';
import { BudgetView } from './views/BudgetView';
import { InvestmentsView } from './views/InvestmentsView';
import { INITIAL_JARS } from './mockData';
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
import { formatOccurredTime } from './utils/dateUtils';
import { formatVND } from './utils/financeMath';

const API_BASE = 'https://qltc-backend.dtd-store.workers.dev/api';

// --- BỘ CHUYỂN ĐỔI DỮ LIỆU CHUẨN XÁC GIỮA D1 (snake_case) & FRONTEND (camelCase) ---
const mapJar = (j: any): Jar => ({
  id: j.id,
  code: j.code || 'NEC',
  name: j.name || 'Chi tiêu',
  targetPercent: Number(j.targetPercent ?? j.target_percent ?? 0),
  monthlyLimit: Math.round(Number(j.monthlyLimit ?? j.monthly_limit ?? 0)),
  spentThisMonth: Math.round(Number(j.spentThisMonth ?? j.spent_this_month ?? 0)),
  color: j.color || '#657D81',
  isDefault: Boolean(j.isDefault ?? j.is_default)
});

const mapAccount = (a: any): BankAccount => ({
  id: a.id,
  name: a.name || 'Tài khoản',
  bankCode: a.bankCode ?? a.bank_code ?? undefined,
  accountNumberMask: a.accountNumberMask ?? a.account_number_mask ?? undefined,
  accountNumber: a.accountNumber ?? a.account_number ?? undefined,
  accountHolder: a.accountHolder ?? a.account_holder ?? undefined,
  branch: a.branch ?? undefined,
  bankBin: a.bankBin ?? a.bank_bin ?? undefined,
  balance: Math.round(Number(a.balance ?? 0)),
  type: (a.type || 'bank') as BankAccount['type']
});

const mapHolding = (h: any): Holding => ({
  id: h.id,
  symbol: String(h.symbol || '').toUpperCase(),
  name: h.name || h.symbol || 'Tài sản',
  assetClass: (h.assetClass ?? h.asset_class ?? 'fund') as Holding['assetClass'],
  quantity: Number(h.quantity ?? 0),
  avgCost: Number(h.avgCost ?? h.avg_cost ?? 0),
  currentPrice: Number(h.currentPrice ?? h.current_price ?? 0),
  unit: h.unit || h.source || 'CCQ',
  priceUpdatedAt: h.priceUpdatedAt ?? h.price_updated_at ?? undefined,
  autoSync: (h.autoSync ?? h.auto_sync) === undefined ? true : Boolean(h.autoSync ?? h.auto_sync)
});

const mapIncomeSource = (s: any): IncomeSource => ({
  id: s.id,
  name: s.name || 'Nguồn thu',
  kind: (s.kind || 'fixed') as IncomeSource['kind'],
  expectedAmount: Math.round(Number(s.expectedAmount ?? s.expected_amount ?? 0)),
  recurrence: s.recurrence || 'Hàng tháng',
  color: s.color || '#8CC7AE',
  keywords: s.keywords || undefined
});

const mapPlannedExpense = (e: any): PlannedExpense => ({
  id: e.id,
  name: e.name || 'Khoản chi',
  jarCode: e.jarCode ?? e.jar_code ?? 'NEC',
  expectedAmount: Math.round(Number(e.expectedAmount ?? e.expected_amount ?? 0)),
  recurrence: e.recurrence || 'Hàng tháng',
  note: e.note ?? undefined
});

const mapTransaction = (t: any): Transaction => {
  const rawIso = t.occurredAtIso ?? t.occurred_at ?? t.occurredAt;
  const type = (t.type || 'expense') as Transaction['type'];
  const category =
    t.notes ||
    t.income_source_name ||
    t.incomeSourceName ||
    t.jar_name ||
    t.suggestedCategory ||
    (type === 'income' ? 'Thu nhập' : type === 'transfer' ? 'Chuyển nội bộ' : 'Chi tiêu');

  return {
    id: t.id,
    accountId: t.accountId ?? t.account_id ?? undefined,
    bankCode: t.bankCode ?? t.bank_code ?? 'BANK',
    accountMask: t.accountMask ?? t.account_number_mask ?? '',
    accountName: t.accountName ?? t.account_name ?? 'Tài khoản',
    toAccountId: t.toAccountId ?? t.to_account_id ?? undefined,
    toAccountName: t.toAccountName ?? t.to_account_name ?? t.paired_account_name ?? undefined,
    type,
    originalType: t.originalType ?? t.original_type ?? undefined,
    amount: Math.round(Number(t.amount ?? 0)),
    description: t.description || '',
    suggestedCategory: category,
    suggestedJarCode: type === 'expense' ? (t.jar_code ?? t.suggestedJarCode ?? 'NEC') : '',
    jarId: type === 'expense' ? (t.jarId ?? t.jar_id ?? undefined) : undefined,
    incomeSourceId: type === 'income' ? (t.incomeSourceId ?? t.income_source_id ?? undefined) : undefined,
    incomeSourceName: type === 'income' ? (t.incomeSourceName ?? t.income_source_name ?? undefined) : undefined,
    balanceAfter: t.balanceAfter ?? t.balance_after ?? undefined,
    occurredAt: formatOccurredTime(rawIso),
    occurredAtIso: rawIso,
    status: t.status || 'pending',
    confidence: t.confidence ?? 0.9,
    rawQuote: t.rawQuote ?? t.raw_body ?? undefined,
    transferPairId: t.transferPairId ?? t.transfer_pair_id ?? null,
    pairedTxnId: t.pairedTxnId ?? t.paired_txn_id ?? null,
    pairedAccountName: t.pairedAccountName ?? t.paired_account_name ?? t.to_account_name ?? null,
    pairedBankCode: t.pairedBankCode ?? t.paired_bank_code ?? t.to_bank_code ?? null,
    pairedAccountMask: t.pairedAccountMask ?? t.paired_account_mask ?? t.to_account_number_mask ?? null,
    pairedType: t.pairedType ?? t.paired_type ?? null
  };
};

export function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

function AppContent() {
  const { success, error, info, undoToast } = useToast();
  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddInitialType, setQuickAddInitialType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [quickAddJarId, setQuickAddJarId] = useState<string | undefined>();
  const [quickAddIncomeSourceId, setQuickAddIncomeSourceId] = useState<string | undefined>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingPrices, setIsSyncingPrices] = useState(false);
  const lastBackPressRef = useRef<number>(0);

  // V2-20: Callback thống nhất khởi tạo Transaction Composer
  const openTransactionComposer = ({
    type,
    jarId,
    incomeSourceId
  }: {
    type: 'income' | 'expense' | 'transfer';
    jarId?: string;
    incomeSourceId?: string;
  }) => {
    setQuickAddInitialType(type);
    setQuickAddJarId(jarId);
    setQuickAddIncomeSourceId(incomeSourceId);
    setIsQuickAddOpen(true);
  };

  // States - khởi tạo từ localStorage cache đã chuẩn hóa (không hiển thị dữ liệu mẫu 356,4tr ảo)
  const [jars, setJars] = useState<Jar[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_jars');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(mapJar);
      }
    } catch {}
    return INITIAL_JARS.map(j => ({ ...j, monthlyLimit: 0, spentThisMonth: 0 }));
  });

  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_income_sources');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapIncomeSource);
      }
    } catch {}
    return [];
  });

  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpense[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_planned_expenses');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapPlannedExpense);
      }
    } catch {}
    return [];
  });

  const [accounts, setAccounts] = useState<BankAccount[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_accounts');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapAccount);
      }
    } catch {}
    return [];
  });

  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_pending');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapTransaction);
      }
    } catch {}
    return [];
  });

  const [confirmedTransactions, setConfirmedTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_confirmed');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapTransaction);
      }
    } catch {}
    return [];
  });

  const [holdings, setHoldings] = useState<Holding[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_holdings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed.map(mapHolding);
      }
    } catch {}
    return [];
  });

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

  // Ghi nhớ cache để tải siêu tốc
  useEffect(() => {
    try {
      localStorage.setItem('qltc_cached_jars', JSON.stringify(jars));
    } catch {}
  }, [jars]);

  useEffect(() => {
    try {
      localStorage.setItem('qltc_cached_accounts', JSON.stringify(accounts));
    } catch {}
  }, [accounts]);

  useEffect(() => {
    try {
      localStorage.setItem('qltc_cached_pending', JSON.stringify(pendingTransactions));
    } catch {}
  }, [pendingTransactions]);

  useEffect(() => {
    try {
      localStorage.setItem('qltc_cached_confirmed', JSON.stringify(confirmedTransactions));
    } catch {}
  }, [confirmedTransactions]);

  useEffect(() => {
    try {
      localStorage.setItem('qltc_cached_holdings', JSON.stringify(holdings));
    } catch {}
  }, [holdings]);

  // Android Hardware Back button / Gestures + Double-Back-to-Exit (U-06)
  useEffect(() => {
    (window as any).__handleBackPress = () => {
      if (isQuickAddOpen) {
        setIsQuickAddOpen(false);
        return true;
      }
      if (isSettingsOpen) {
        setIsSettingsOpen(false);
        return true;
      }
      if (isResetOpen) {
        setIsResetOpen(false);
        return true;
      }
      if (currentTab !== 'dashboard') {
        setCurrentTab('dashboard');
        return true;
      }
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        return false; // Thoát ứng dụng ở lần nhấn thứ 2 trong vòng 2 giây
      }
      lastBackPressRef.current = now;
      info('Nhấn lần nữa để thoát ứng dụng');
      return true;
    };

    return () => {
      delete (window as any).__handleBackPress;
    };
  }, [isQuickAddOpen, isSettingsOpen, isResetOpen, currentTab, info]);

  // Đồng bộ toàn diện dữ liệu thực từ Cloudflare D1 Backend
  const loadDataFromBackend = useCallback(async () => {
    try {
      const [
        accountsRes,
        jarsRes,
        txnsRes,
        holdingsRes,
        incomeRes,
        plannedExpRes,
        fmarketRes,
        profileRes
      ] = await Promise.all([
        fetch(`${API_BASE}/accounts`).catch(() => null),
        fetch(`${API_BASE}/jars`).catch(() => null),
        fetch(`${API_BASE}/transactions?limit=500`).catch(() => null),
        fetch(`${API_BASE}/holdings`).catch(() => null),
        fetch(`${API_BASE}/income-sources`).catch(() => null),
        fetch(`${API_BASE}/planned-expenses`).catch(() => null),
        fetch(`${API_BASE}/market/fmarket-funds`).catch(() => null),
        fetch(`${API_BASE}/user/profile`).catch(() => null)
      ]);

      if (accountsRes && accountsRes.ok) {
        const aData = await accountsRes.json();
        if (Array.isArray(aData.accounts)) {
          setAccounts(aData.accounts.map(mapAccount));
        }
      }

      if (jarsRes && jarsRes.ok) {
        const jData = await jarsRes.json();
        if (Array.isArray(jData.jars) && jData.jars.length > 0) {
          setJars(jData.jars.map(mapJar));
        }
      }

      if (holdingsRes && holdingsRes.ok) {
        const hData = await holdingsRes.json();
        if (Array.isArray(hData.holdings)) {
          setHoldings(hData.holdings.map(mapHolding));
        }
      }

      if (incomeRes && incomeRes.ok) {
        const iData = await incomeRes.json();
        if (Array.isArray(iData.incomeSources)) {
          const mappedIncome = iData.incomeSources.map(mapIncomeSource);
          setIncomeSources(mappedIncome);
          localStorage.setItem('qltc_income_sources', JSON.stringify(mappedIncome));
        }
      }

      if (plannedExpRes && plannedExpRes.ok) {
        const peData = await plannedExpRes.json();
        if (Array.isArray(peData.plannedExpenses)) {
          const mappedPe = peData.plannedExpenses.map(mapPlannedExpense);
          setPlannedExpenses(mappedPe);
          localStorage.setItem('qltc_planned_expenses', JSON.stringify(mappedPe));
        }
      }

      if (txnsRes && txnsRes.ok) {
        const tData = await txnsRes.json();
        if (Array.isArray(tData.transactions)) {
          const allTxns: Transaction[] = tData.transactions.map(mapTransaction);
          setPendingTransactions(allTxns.filter(t => t.status === 'pending'));
          setConfirmedTransactions(allTxns.filter(t => t.status === 'confirmed'));
        }
      }

      if (fmarketRes && fmarketRes.ok) {
        const fData = await fmarketRes.json();
        if (Array.isArray(fData.funds)) {
          setFmarketFunds(fData.funds);
        }
      }

      if (profileRes && profileRes.ok) {
        const pData = await profileRes.json();
        const remoteProfile = pData.user || pData.profile;
        if (remoteProfile) {
          setUserProfile(remoteProfile);
          localStorage.setItem('qltc_user_profile', JSON.stringify(remoteProfile));
        }
      }
    } catch (e) {
      console.warn('Backend offline, giữ cache local:', e);
    }
  }, []);

  useEffect(() => {
    loadDataFromBackend();
  }, [loadDataFromBackend]);

  // Cập nhật Profile (Đồng bộ cả D1 Backend và LocalStorage)
  const handleUpdateUserProfile = async (updated: Partial<UserProfile>) => {
    setUserProfile(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('qltc_user_profile', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/user/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      success('Đã lưu thông tin cá nhân');
    } catch (e) {
      console.error('Lỗi lưu hồ sơ lên máy chủ:', e);
      success('Đã lưu thông tin cá nhân trên thiết bị');
    }
  };

  // Cập nhật nhanh số dư / thông tin tài khoản
  const handleUpdateAccountBalance = async (
    accountId: string,
    newBalance: number,
    name?: string,
    type?: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto' | 'savings'
  ) => {
    const cleanBalance = Math.round(newBalance);
    setAccounts(prev => prev.map(a => {
      if (a.id === accountId) {
        return {
          ...a,
          balance: cleanBalance,
          name: name || a.name,
          type: type || a.type
        };
      }
      return a;
    }));

    try {
      await fetch(`${API_BASE}/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: cleanBalance, name, type })
      });
      success('Đã cập nhật số dư tài khoản');
    } catch (e) {
      console.error('Lỗi lưu số dư:', e);
    }
  };

  // Cập nhật toàn diện thông tin tài khoản (Tên, STK, Chủ TK, Chi nhánh, Số dư, Ngân hàng)
  const handleUpdateAccount = async (updatedAcc: BankAccount) => {
    const cleanAcc: BankAccount = { ...updatedAcc, balance: Math.round(updatedAcc.balance || 0) };
    setAccounts(prev => prev.map(a => a.id === cleanAcc.id ? cleanAcc : a));
    try {
      await fetch(`${API_BASE}/accounts/${cleanAcc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanAcc)
      });
      success(`Đã cập nhật thông tin "${cleanAcc.name}"`);
    } catch (e) {
      console.error('Lỗi cập nhật tài khoản:', e);
    }
  };

  // Thêm tài khoản mới
  const handleAddAccount = async (newAcc: BankAccount) => {
    const cleanAcc: BankAccount = { ...newAcc, balance: Math.round(newAcc.balance || 0) };
    setAccounts(prev => [...prev, cleanAcc]);
    try {
      await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanAcc)
      });
      success(`Đã thêm tài khoản "${cleanAcc.name}"`);
    } catch (e) {
      console.error('Lỗi lưu tài khoản mới:', e);
    }
  };

  // Xóa tài khoản
  const handleDeleteAccount = async (accountId: string) => {
    setAccounts(prev => prev.filter(a => a.id !== accountId));
    try {
      await fetch(`${API_BASE}/accounts/${accountId}`, { method: 'DELETE' });
      info('Đã xóa tài khoản');
    } catch (e) {
      console.error('Lỗi xóa tài khoản:', e);
    }
  };

  // Làm mới toàn diện từ Cloudflare
  const handleRefreshAll = async () => {
    setIsSyncing(true);
    await loadDataFromBackend();
    setIsSyncing(false);
    info('Dữ liệu đã được đồng bộ mới nhất');
  };

  // Tính tổng số dư và tài sản ròng (bao gồm cả tiền mặt trong TK chứng khoán/crypto theo chuẩn L-04)
  const liquidCash = accounts
    .filter(a => ['bank', 'cash', 'ewallet', 'savings'].includes(a.type))
    .reduce((sum, a) => sum + (a.balance || 0), 0);

  const allAccountsCash = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const totalInvestments = holdings.reduce((sum, h) => sum + h.quantity * h.currentPrice, 0);
  const netWorth = allAccountsCash + totalInvestments;

  // Helper áp dụng / hoàn tác số dư tài khoản trên Frontend
  const applyAccountLedgerDelta = useCallback((txn: Transaction, reverse: boolean = false) => {
    const sign = reverse ? -1 : 1;
    setAccounts(prev => prev.map(acc => {
      const isSource = txn.accountId ? acc.id === txn.accountId : acc.name === txn.accountName;
      const isTarget = Boolean(txn.toAccountId && acc.id === txn.toAccountId);

      if (txn.type === 'transfer') {
        if (isSource) return { ...acc, balance: acc.balance - sign * txn.amount };
        if (isTarget) return { ...acc, balance: acc.balance + sign * txn.amount };
        return acc;
      }

      if (isSource) {
        const delta = txn.type === 'income' ? txn.amount : -txn.amount;
        return { ...acc, balance: acc.balance + sign * delta };
      }
      return acc;
    }));
  }, []);

  // Xác nhận giao dịch (approve / swipe right)
  const handleConfirmTransaction = async (
    id: string,
    jarCode?: string,
    categoryName?: string,
    jarId?: string,
    incomeSourceId?: string
  ) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (!txn) return;

    const defaultJar = jars.find(j => j.isDefault) || jars[0];
    const targetJar =
      txn.type === 'expense'
        ? jars.find(j => j.id === jarId) || jars.find(j => j.code === jarCode) || defaultJar
        : undefined;

    const finalJarCode = txn.type === 'expense' ? (targetJar?.code || jarCode || txn.suggestedJarCode || 'NEC') : '';
    const finalJarId = txn.type === 'expense' ? (targetJar?.id || jarId) : undefined;
    const finalCategory =
      categoryName ||
      (txn.type === 'expense' ? targetJar?.name : txn.type === 'transfer' ? 'Chuyển nội bộ' : undefined) ||
      txn.suggestedCategory;

    // 1. Cập nhật sổ cái tài khoản & hũ chi tiêu ngay lập tức
    applyAccountLedgerDelta(txn, false);

    if (txn.type === 'expense' && finalJarId) {
      setJars(prev => prev.map(j => (
        j.id === finalJarId ? { ...j, spentThisMonth: j.spentThisMonth + txn.amount } : j
      )));
    }

    const confirmedTxn: Transaction = {
      ...txn,
      suggestedJarCode: finalJarCode,
      jarId: finalJarId,
      incomeSourceId: txn.type === 'income' ? incomeSourceId : undefined,
      suggestedCategory: finalCategory,
      occurredAtIso: txn.occurredAtIso || new Date().toISOString(),
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [confirmedTxn, ...prev]);
    setPendingTransactions(prev => prev.filter(t => t.id !== id));

    // 2. Hiển thị Undo Toast trong 5 giây (hoàn tác trọn vẹn cả UI, Hũ, Số dư TK và D1)
    undoToast(`Đã duyệt: ${formatVND(txn.amount)} (${finalCategory})`, async () => {
      applyAccountLedgerDelta(txn, true);
      if (txn.type === 'expense' && finalJarId) {
        setJars(prev => prev.map(j => (
          j.id === finalJarId ? { ...j, spentThisMonth: Math.max(0, j.spentThisMonth - txn.amount) } : j
        )));
      }
      setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
      setPendingTransactions(prev => [txn, ...prev]);
      try {
        await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending' })
        });
      } catch {}
    }, 5000);

    try {
      await fetch(`${API_BASE}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'confirmed',
          jarId: txn.type === 'expense' ? (finalJarId || null) : null,
          jarCode: txn.type === 'expense' ? finalJarCode : null,
          incomeSourceId: txn.type === 'income' ? (incomeSourceId || null) : null,
          categoryName: finalCategory
        })
      });
    } catch (err) {
      console.error('Lỗi cập nhật giao dịch:', err);
    }
  };

  // Bỏ qua giao dịch (reject / swipe left)
  const handleRejectTransaction = async (id: string) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (!txn) return;

    setPendingTransactions(prev => prev.filter(t => t.id !== id));

    undoToast(`Đã bỏ qua giao dịch ${formatVND(txn.amount)}`, async () => {
      setPendingTransactions(prev => [txn, ...prev]);
      try {
        await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'pending' })
        });
      } catch {}
    }, 5000);

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

  // Cập nhật giao dịch đã duyệt (chỉnh hũ, nguồn thu, ghi chú)
  const handleUpdateConfirmed = async (
    id: string,
    updates: { jarId?: string; jarCode?: string; category?: string; description?: string; incomeSourceId?: string | null }
  ) => {
    const existing = confirmedTransactions.find(t => t.id === id);
    if (existing && existing.type === 'expense' && updates.jarId && updates.jarId !== existing.jarId) {
      setJars(prev => prev.map(j => {
        if (j.id === existing.jarId) {
          return { ...j, spentThisMonth: Math.max(0, j.spentThisMonth - existing.amount) };
        }
        if (j.id === updates.jarId) {
          return { ...j, spentThisMonth: j.spentThisMonth + existing.amount };
        }
        return j;
      }));
    }

    setConfirmedTransactions(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          jarId: updates.jarId ?? t.jarId,
          suggestedJarCode: updates.jarCode ?? t.suggestedJarCode,
          suggestedCategory: updates.category ?? t.suggestedCategory,
          description: updates.description ?? t.description,
          incomeSourceId: updates.incomeSourceId !== undefined ? (updates.incomeSourceId || undefined) : t.incomeSourceId
        };
      }
      return t;
    }));

    try {
      await fetch(`${API_BASE}/transactions/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: updates.description,
          jarId: updates.jarId,
          jarCode: updates.jarCode,
          categoryName: updates.category,
          incomeSourceId: updates.incomeSourceId
        })
      });
      success('Đã lưu thay đổi giao dịch');
    } catch (e) {
      console.error('Lỗi lưu giao dịch:', e);
    }
  };

  // Tách giao dịch chuyển tiền nội bộ ghép nhầm
  const handleUnpairTransaction = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${id}/unpair`, { method: 'POST' });
      if (res.ok) {
        await loadDataFromBackend();
        success('Đã tách thành công giao dịch ra làm 2 khoản độc lập');
      }
    } catch (err) {
      console.error('Lỗi tách giao dịch:', err);
    }
  };

  // Ghép thủ công sang chuyển tiền nội bộ
  const handlePairTransfer = async (fromTxnId: string, toAccountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/transactions/${fromTxnId}/pair-transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toAccountId })
      });
      if (res.ok) {
        await loadDataFromBackend();
        success('Đã chuyển thành giao dịch chuyển tiền nội bộ');
      }
    } catch (err) {
      console.error('Lỗi ghép giao dịch:', err);
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
      setJars(prev => prev.map(j => ({ ...j, monthlyLimit: 0 })));
    }
    if (scope === 'all') {
      setJars(prev => prev.map(j => ({ ...j, spentThisMonth: 0, monthlyLimit: 0 })));
    }

    try {
      await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, clearNotifications: true })
      });
      await loadDataFromBackend();
      success('Đã thiết lập lại dữ liệu thành công');
    } catch (err) {
      console.error('Lỗi gọi API reset:', err);
    }
  };

  // Thêm Nguồn thu dự kiến
  const handleAddIncomeSource = async (newSource: IncomeSource) => {
    const cleanSource = mapIncomeSource(newSource);
    setIncomeSources(prev => {
      const next = [...prev, cleanSource];
      localStorage.setItem('qltc_income_sources', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/income-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanSource)
      });
      success(`Đã thêm nguồn thu "${cleanSource.name}"`);
    } catch (e) {
      console.error('Lỗi lưu nguồn thu:', e);
    }
  };

  // Cập nhật Nguồn thu dự kiến
  const handleUpdateIncomeSource = async (id: string, updates: Partial<IncomeSource>) => {
    setIncomeSources(prev => {
      const next = prev.map(s => (s.id === id ? { ...s, ...updates } : s));
      localStorage.setItem('qltc_income_sources', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/income-sources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      success('Đã cập nhật nguồn thu');
    } catch (e) {
      console.error('Lỗi cập nhật nguồn thu:', e);
    }
  };

  // Xóa Nguồn thu dự kiến
  const handleDeleteIncomeSource = async (id: string) => {
    setIncomeSources(prev => {
      const next = prev.filter(s => s.id !== id);
      localStorage.setItem('qltc_income_sources', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/income-sources/${id}`, { method: 'DELETE' });
      info('Đã xóa nguồn thu');
    } catch (e) {
      console.error('Lỗi xóa nguồn thu:', e);
    }
  };

  // Thêm Khoản chi dự kiến
  const handleAddPlannedExpense = async (newExp: PlannedExpense) => {
    const cleanExp = mapPlannedExpense(newExp);
    setPlannedExpenses(prev => {
      const next = [...prev, cleanExp];
      localStorage.setItem('qltc_planned_expenses', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/planned-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanExp)
      });
      success(`Đã thêm khoản chi "${cleanExp.name}"`);
    } catch (e) {
      console.error('Lỗi lưu khoản chi dự kiến:', e);
    }
  };

  // Cập nhật Khoản chi dự kiến
  const handleUpdatePlannedExpense = async (id: string, updates: Partial<PlannedExpense>) => {
    setPlannedExpenses(prev => {
      const next = prev.map(e => (e.id === id ? { ...e, ...updates } : e));
      localStorage.setItem('qltc_planned_expenses', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/planned-expenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
      success('Đã cập nhật khoản chi dự kiến');
    } catch (e) {
      console.error('Lỗi cập nhật khoản chi dự kiến:', e);
    }
  };

  // Xóa Khoản chi dự kiến
  const handleDeletePlannedExpense = async (id: string) => {
    setPlannedExpenses(prev => {
      const next = prev.filter(e => e.id !== id);
      localStorage.setItem('qltc_planned_expenses', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/planned-expenses/${id}`, { method: 'DELETE' });
      info('Đã xóa khoản chi dự kiến');
    } catch (e) {
      console.error('Lỗi xóa khoản chi dự kiến:', e);
    }
  };

  // Xóa giao dịch đã duyệt (hoàn lại số dư tài khoản & hũ chi tiêu)
  const handleDeleteConfirmed = async (id: string) => {
    const txn = confirmedTransactions.find(t => t.id === id);
    if (txn) {
      applyAccountLedgerDelta(txn, true);
      if (txn.type === 'expense') {
        setJars(prev => prev.map(j => {
          const isMatch = txn.jarId ? j.id === txn.jarId : j.code === txn.suggestedJarCode;
          return isMatch ? { ...j, spentThisMonth: Math.max(0, j.spentThisMonth - txn.amount) } : j;
        }));
      }
    }

    setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
      info('Đã xóa giao dịch và hoàn lại số dư');
    } catch (e) {
      console.error('Lỗi xóa giao dịch:', e);
    }
  };

  // Thêm giao dịch thủ công (hỗ trợ chuyển tiền nội bộ toAccountId & nguồn thu incomeSourceId)
  const handleAddTransaction = async (newTxn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    incomeSourceId?: string;
    accountId: string;
    toAccountId?: string;
  }) => {
    const cleanAmount = Math.round(newTxn.amount);

    setAccounts(prev => prev.map(acc => {
      if (acc.id === newTxn.accountId) {
        const delta = newTxn.type === 'income' ? cleanAmount : -cleanAmount;
        return { ...acc, balance: acc.balance + delta };
      }
      if (newTxn.type === 'transfer' && newTxn.toAccountId && acc.id === newTxn.toAccountId) {
        return { ...acc, balance: acc.balance + cleanAmount };
      }
      return acc;
    }));

    const sourceAcc = accounts.find(a => a.id === newTxn.accountId);
    const targetAcc = newTxn.toAccountId ? accounts.find(a => a.id === newTxn.toAccountId) : undefined;
    const matchedJar = jars.find(j => j.id === newTxn.jarId);
    const matchedIncomeSrc = newTxn.incomeSourceId
      ? incomeSources.find(s => s.id === newTxn.incomeSourceId)
      : undefined;
    const jarCode = matchedJar?.code || 'NEC';

    if (newTxn.type === 'expense' && newTxn.jarId) {
      setJars(prev => prev.map(j => (
        j.id === newTxn.jarId ? { ...j, spentThisMonth: j.spentThisMonth + cleanAmount } : j
      )));
    }

    const txnId = `txn_${Date.now()}`;
    const isoNow = new Date().toISOString();
    const categoryLabel =
      newTxn.type === 'income'
        ? (matchedIncomeSrc?.name || 'Thu nhập khác')
        : newTxn.type === 'transfer'
        ? 'Chuyển tiền nội bộ'
        : (matchedJar?.name || 'Chi tiêu');

    const createdTxn: Transaction = {
      id: txnId,
      accountId: newTxn.accountId,
      bankCode: sourceAcc?.bankCode || 'CASH',
      accountMask: sourceAcc?.accountNumberMask || 'VÍ',
      accountName: sourceAcc?.name || 'Ghi chép thủ công',
      toAccountId: newTxn.toAccountId,
      toAccountName: targetAcc?.name,
      type: newTxn.type,
      amount: cleanAmount,
      description: newTxn.description,
      suggestedCategory: categoryLabel,
      suggestedJarCode: jarCode,
      jarId: newTxn.type === 'expense' ? newTxn.jarId : undefined,
      incomeSourceId: newTxn.type === 'income' ? newTxn.incomeSourceId : undefined,
      incomeSourceName: matchedIncomeSrc?.name,
      occurredAt: formatOccurredTime(isoNow),
      occurredAtIso: isoNow,
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [createdTxn, ...prev]);
    success(`Đã ghi chép thành công: ${formatVND(cleanAmount)}`);

    try {
      await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: txnId,
          accountId: newTxn.accountId,
          toAccountId: newTxn.toAccountId,
          type: newTxn.type,
          amount: cleanAmount,
          description: newTxn.description,
          jarId: newTxn.type === 'expense' ? newTxn.jarId : undefined,
          jarCode,
          incomeSourceId: newTxn.type === 'income' ? newTxn.incomeSourceId : undefined,
          categoryName: categoryLabel,
          occurredAt: isoNow
        })
      });
    } catch (e) {
      console.error('Lỗi lưu giao dịch thủ công:', e);
    }
  };

  // Thêm / cập nhật tài sản đầu tư
  const handleAddHolding = async (newHolding: Holding) => {
    const cleanHolding = mapHolding(newHolding);
    setHoldings(prev => {
      const idx = prev.findIndex(h => h.symbol.toUpperCase() === cleanHolding.symbol.toUpperCase());
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = cleanHolding;
        return updated;
      }
      return [...prev, cleanHolding];
    });

    try {
      await fetch(`${API_BASE}/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanHolding)
      });
      success(`Đã lưu tài sản "${cleanHolding.symbol}"`);
    } catch (e) {
      console.error('Lỗi lưu tài sản:', e);
    }
  };

  // Xóa tài sản đầu tư
  const handleDeleteHolding = async (symbol: string) => {
    setHoldings(prev => prev.filter(h => h.symbol.toUpperCase() !== symbol.toUpperCase()));
    try {
      await fetch(`${API_BASE}/holdings/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      info(`Đã xóa tài sản ${symbol}`);
    } catch (e) {
      console.error('Lỗi xóa tài sản:', e);
    }
  };

  // Cập nhật giá thị trường tự động (Fmarket NAV, Vàng, Bạc, Crypto)
  const handleSyncMarketPrices = async () => {
    setIsSyncingPrices(true);
    try {
      const res = await fetch(`${API_BASE}/market/sync-prices`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.holdings)) {
          setHoldings(data.holdings.map(mapHolding));
        } else {
          await loadDataFromBackend();
        }
        success('Đã cập nhật giá mới nhất từ Fmarket & Thị trường');
      } else {
        error('Không thể đồng bộ giá thị trường lúc này');
      }
    } catch (e) {
      console.error('Lỗi đồng bộ giá:', e);
      error('Không thể kết nối máy chủ giá thị trường');
    } finally {
      setIsSyncingPrices(false);
    }
  };

  // Giả lập thông báo ngân hàng
  const handleSimulateNotification = async (notif: { title: string; text: string; packageName?: string }) => {
    try {
      const res = await fetch(`${API_BASE}/notifications/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageName: notif.packageName || 'com.VCB',
          title: notif.title,
          text: notif.text
        })
      });
      if (res.ok) {
        await loadDataFromBackend();
        success('Đã nhận thông báo biến động số dư mới');
      }
    } catch (e) {
      console.error('Lỗi test notification:', e);
    }
  };

  // Thêm hũ mới (sinh mã code riêng trên Backend tránh trùng tiền tố "Chi tiêu...")
  const handleAddJar = async (newJar: {
    name: string;
    code?: string;
    targetPercent: number;
    monthlyLimit: number;
    color?: string;
    isDefault?: boolean;
  }) => {
    const jarId = `jar_${Date.now()}`;
    const tempCode =
      newJar.code ||
      newJar.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .toUpperCase()
        .trim()
        .split(/\s+/)
        .map(w => w[0])
        .join('')
        .slice(0, 5) ||
      'JAR';

    const createdJar: Jar = {
      id: jarId,
      code: tempCode,
      name: newJar.name,
      targetPercent: newJar.targetPercent,
      monthlyLimit: Math.round(newJar.monthlyLimit),
      spentThisMonth: 0,
      color: newJar.color || '#8CC7AE',
      isDefault: Boolean(newJar.isDefault)
    };

    setJars(prev => {
      const base = newJar.isDefault ? prev.map(j => ({ ...j, isDefault: false })) : prev;
      return [...base, createdJar];
    });
    success(`Đã tạo hũ "${newJar.name}"`);

    try {
      const res = await fetch(`${API_BASE}/jars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: jarId,
          name: newJar.name,
          monthlyLimit: Math.round(newJar.monthlyLimit),
          targetPercent: newJar.targetPercent,
          color: newJar.color || '#8CC7AE',
          isDefault: Boolean(newJar.isDefault)
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.code) {
          setJars(prev => prev.map(j => (j.id === jarId ? { ...j, code: data.code } : j)));
        }
      }
    } catch (e) {
      console.error('Lỗi thêm hũ:', e);
    }
  };

  // Sửa hũ
  const handleUpdateJar = async (
    jarId: string,
    updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string; isDefault?: boolean }
  ) => {
    setJars(prev => prev.map(j => {
      if (j.id === jarId) {
        return {
          ...j,
          name: updates.name ?? j.name,
          targetPercent: updates.targetPercent ?? j.targetPercent,
          monthlyLimit: updates.monthlyLimit !== undefined ? Math.round(updates.monthlyLimit) : j.monthlyLimit,
          color: updates.color ?? j.color,
          isDefault: updates.isDefault !== undefined ? updates.isDefault : j.isDefault
        };
      }
      if (updates.isDefault === true) {
        return { ...j, isDefault: false };
      }
      return j;
    }));

    try {
      await fetch(`${API_BASE}/jars/${jarId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: updates.name,
          monthlyLimit: updates.monthlyLimit !== undefined ? Math.round(updates.monthlyLimit) : undefined,
          targetPercent: updates.targetPercent,
          color: updates.color,
          isDefault: updates.isDefault
        })
      });
      success('Đã cập nhật hũ');
    } catch (e) {
      console.error('Lỗi lưu hũ:', e);
    }
  };

  // Cân bằng % các hũ
  const handleBatchUpdateJarsPercent = async (
    updates: Array<{ id: string; targetPercent: number; monthlyLimit: number }>
  ) => {
    setJars(prev => prev.map(j => {
      const u = updates.find(item => item.id === j.id);
      if (u) {
        return { ...j, targetPercent: u.targetPercent, monthlyLimit: Math.round(u.monthlyLimit) };
      }
      return j;
    }));

    try {
      await Promise.all(
        updates.map(u =>
          fetch(`${API_BASE}/jars/${u.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              targetPercent: u.targetPercent,
              monthlyLimit: Math.round(u.monthlyLimit)
            })
          })
        )
      );
      success('Đã cân bằng tỷ lệ các hũ thành công');
    } catch (e) {
      console.error('Lỗi đồng bộ % các hũ:', e);
    }
  };

  // Xóa hũ
  const handleDeleteJar = async (jarId: string) => {
    setJars(prev => prev.filter(j => j.id !== jarId));
    try {
      await fetch(`${API_BASE}/jars/${jarId}`, { method: 'DELETE' });
      info('Đã xóa hũ');
    } catch (e) {
      console.error('Lỗi xóa hũ:', e);
    }
  };

  // Tự động phân bổ hũ theo % từ Tổng Thu Dự Kiến
  const handleAutoAllocateJars = async (totalIncome: number) => {
    const cleanIncome = Math.round(totalIncome);
    const updated = jars.map(j => ({
      ...j,
      monthlyLimit: Math.round(cleanIncome * (j.targetPercent || 0))
    }));
    setJars(updated);

    try {
      await fetch(`${API_BASE}/jars/auto-allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalIncome: cleanIncome })
      });
      success('Đã tự động tính hạn mức các hũ theo % thu nhập');
    } catch (e) {
      console.error('Lỗi tự động phân bổ hũ:', e);
    }
  };

  return (
    <div className="min-h-screen bg-[#0E1314] text-[#F2F5F5] font-sans antialiased pb-12 selection:bg-[#8CC7AE] selection:text-[#0E1314]">
      {/* Top Navbar */}
      <Navbar
        pendingCount={pendingTransactions.length}
        onOpenInbox={() => setCurrentTab('transactions')}
        onOpenSettings={() => setIsSettingsOpen(true)}
        userProfile={userProfile}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode(!privacyMode)}
        onRefresh={handleRefreshAll}
        isRefreshing={isSyncing}
      />

      {/* Main View Area */}
      <main className="max-w-md mx-auto pt-2">
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
            onUpdateConfirmed={handleUpdateConfirmed}
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
            accounts={accounts}
            onAddIncomeSource={handleAddIncomeSource}
            onUpdateIncomeSource={handleUpdateIncomeSource}
            onDeleteIncomeSource={handleDeleteIncomeSource}
            onAddPlannedExpense={handleAddPlannedExpense}
            onUpdatePlannedExpense={handleUpdatePlannedExpense}
            onDeletePlannedExpense={handleDeletePlannedExpense}
            onAddJar={handleAddJar}
            onUpdateJar={handleUpdateJar}
            onBatchUpdateJarsPercent={handleBatchUpdateJarsPercent}
            onDeleteJar={handleDeleteJar}
            onAutoAllocateJars={handleAutoAllocateJars}
            onAddTransaction={handleAddTransaction}
            onOpenQuickAddIncome={(sourceId) => {
              openTransactionComposer({ type: 'income', incomeSourceId: sourceId });
            }}
            onOpenQuickAddExpense={(jarId) => {
              openTransactionComposer({ type: 'expense', jarId });
            }}
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
        onOpenQuickAdd={() => {
          setQuickAddInitialType('expense');
          setIsQuickAddOpen(true);
        }}
        pendingCount={pendingTransactions.length}
      />

      {/* Quick Add Modal */}
      <QuickAddModal
        isOpen={isQuickAddOpen}
        onClose={() => {
          setIsQuickAddOpen(false);
          setQuickAddJarId(undefined);
          setQuickAddIncomeSourceId(undefined);
        }}
        jars={jars}
        incomeSources={incomeSources}
        accounts={accounts}
        initialType={quickAddInitialType}
        initialJarId={quickAddJarId}
        initialIncomeSourceId={quickAddIncomeSourceId}
        onAddTransaction={handleAddTransaction}
      />

      {/* Settings & Accounts Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        accounts={accounts}
        onAddAccount={handleAddAccount}
        onUpdateAccount={handleUpdateAccount}
        onUpdateAccountBalance={handleUpdateAccountBalance}
        onDeleteAccount={handleDeleteAccount}
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
