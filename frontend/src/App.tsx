import React, { useState, useEffect, useCallback } from 'react';
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
import {
  INITIAL_JARS,
  INITIAL_ACCOUNTS,
  INITIAL_INCOME_SOURCES,
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
import { formatOccurredTime } from './utils/dateUtils';
import { formatVND } from './utils/financeMath';

const API_BASE = 'https://qltc-backend.dtd-store.workers.dev/api';

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
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingPrices, setIsSyncingPrices] = useState(false);

  // States - khởi tạo từ localStorage cache nếu có để tránh flash dữ liệu mẫu
  const [jars, setJars] = useState<Jar[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_jars');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_JARS;
  });

  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_income_sources');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_INCOME_SOURCES;
  });

  const [plannedExpenses, setPlannedExpenses] = useState<PlannedExpense[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_planned_expenses');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [accounts, setAccounts] = useState<BankAccount[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_accounts');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_ACCOUNTS;
  });

  const [pendingTransactions, setPendingTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_pending');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [confirmedTransactions, setConfirmedTransactions] = useState<Transaction[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_confirmed');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [holdings, setHoldings] = useState<Holding[]>(() => {
    try {
      const saved = localStorage.getItem('qltc_cached_holdings');
      if (saved) return JSON.parse(saved);
    } catch {}
    return INITIAL_HOLDINGS;
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
      phone: '0988.xxx.xxx',
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=256&q=80'
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

  // Android Hardware Back button / Gestures (L-11)
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
      return false;
    };

    return () => {
      delete (window as any).__handleBackPress;
    };
  }, [isQuickAddOpen, isSettingsOpen, isResetOpen, currentTab]);

  // Đồng bộ dữ liệu từ Cloudflare Backend
  const loadDataFromBackend = useCallback(async () => {
    try {
      const [overviewRes, txnsRes, jarsRes, fmarketRes, profileRes] = await Promise.all([
        fetch(`${API_BASE}/overview`).catch(() => null),
        fetch(`${API_BASE}/transactions?limit=250`).catch(() => null),
        fetch(`${API_BASE}/jars`).catch(() => null),
        fetch(`${API_BASE}/investments/fmarket/top`).catch(() => null),
        fetch(`${API_BASE}/user/profile`).catch(() => null)
      ]);

      if (overviewRes && overviewRes.ok) {
        const oData = await overviewRes.json();
        if (oData.accounts && Array.isArray(oData.accounts)) {
          setAccounts(oData.accounts);
        }
        if (oData.holdings && Array.isArray(oData.holdings)) {
          setHoldings(oData.holdings);
        }
        if (oData.incomeSources && Array.isArray(oData.incomeSources)) {
          setIncomeSources(oData.incomeSources);
          localStorage.setItem('qltc_income_sources', JSON.stringify(oData.incomeSources));
        }
        if (oData.plannedExpenses && Array.isArray(oData.plannedExpenses)) {
          setPlannedExpenses(oData.plannedExpenses);
          localStorage.setItem('qltc_planned_expenses', JSON.stringify(oData.plannedExpenses));
        }
      }

      if (jarsRes && jarsRes.ok) {
        const jData = await jarsRes.json();
        if (jData.jars && Array.isArray(jData.jars)) {
          setJars(jData.jars);
        }
      }

      if (txnsRes && txnsRes.ok) {
        const tData = await txnsRes.json();
        if (tData.transactions && Array.isArray(tData.transactions)) {
          const allTxns: Transaction[] = tData.transactions.map((t: any) => ({
            id: t.id,
            bankCode: t.bankCode || 'VCB',
            accountMask: t.accountMask || '9737',
            accountName: t.accountName || 'Vietcombank',
            toAccountId: t.toAccountId,
            toAccountName: t.toAccountName,
            type: t.type || 'expense',
            originalType: t.originalType,
            amount: t.amount,
            description: t.description,
            suggestedCategory: t.suggestedCategory || (t.type === 'income' ? 'Thu nhập' : 'Ăn uống'),
            suggestedJarCode: t.suggestedJarCode || 'NEC',
            jarId: t.jarId,
            occurredAt: formatOccurredTime(t.occurredAt),
            occurredAtIso: t.occurredAt,
            status: t.status || 'pending',
            confidence: t.confidence || 0.9,
            rawQuote: t.rawQuote,
            pairedAccountName: t.pairedAccountName,
            pairedBankCode: t.pairedBankCode
          }));

          const pending = allTxns.filter(t => t.status === 'pending');
          const confirmed = allTxns.filter(t => t.status === 'confirmed');
          setPendingTransactions(pending);
          setConfirmedTransactions(confirmed);
        }
      }

      if (fmarketRes && fmarketRes.ok) {
        const fData = await fmarketRes.json();
        if (fData.funds && Array.isArray(fData.funds)) {
          setFmarketFunds(fData.funds);
        }
      }

      if (profileRes && profileRes.ok) {
        const pData = await profileRes.json();
        if (pData.profile) {
          setUserProfile(pData.profile);
          localStorage.setItem('qltc_user_profile', JSON.stringify(pData.profile));
        }
      }
    } catch (e) {
      console.warn('Backend offline, giữ cache local:', e);
    }
  }, []);

  useEffect(() => {
    loadDataFromBackend();
  }, [loadDataFromBackend]);

  // Cập nhật Profile
  const handleUpdateUserProfile = (updated: Partial<UserProfile>) => {
    setUserProfile(prev => {
      const next = { ...prev, ...updated };
      localStorage.setItem('qltc_user_profile', JSON.stringify(next));
      return next;
    });
    success('Đã cập nhật thông tin cá nhân');
  };

  // Cập nhật nhanh số dư tài khoản
  const handleUpdateAccountBalance = async (
    accountId: string,
    newBalance: number,
    name?: string,
    type?: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto' | 'savings'
  ) => {
    setAccounts(prev => prev.map(a => {
      if (a.id === accountId) {
        return {
          ...a,
          balance: newBalance,
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
        body: JSON.stringify({ balance: newBalance, name, type })
      });
      success('Đã cập nhật số dư tài khoản');
    } catch (e) {
      console.error('Lỗi lưu số dư:', e);
    }
  };

  // Thêm tài khoản mới
  const handleAddAccount = async (newAcc: BankAccount) => {
    setAccounts(prev => [...prev, newAcc]);
    try {
      await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAcc)
      });
      success(`Đã thêm tài khoản "${newAcc.name}"`);
    } catch (e) {
      console.error('Lỗi lưu tài khoản mới:', e);
    }
  };

  // Làm mới toàn diện từ Cloudflare
  const handleRefreshAll = async () => {
    setIsSyncing(true);
    await loadDataFromBackend();
    setIsSyncing(false);
    info('Dữ liệu đã được đồng bộ mới nhất');
  };

  // Tính tổng số dư và tài sản ròng
  const liquidCash = accounts
    .filter(a => ['bank', 'cash', 'ewallet', 'savings'].includes(a.type))
    .reduce((sum, a) => sum + (a.balance || 0), 0);

  const totalInvestments = holdings.reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const netWorth = liquidCash + totalInvestments;

  // Xác nhận giao dịch (approve / swipe right)
  const handleConfirmTransaction = async (id: string, jarCode?: string, categoryName?: string, jarId?: string) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (!txn) return;

    const targetJar = jars.find(j => j.id === jarId) || jars.find(j => j.code === jarCode) || jars[0];
    const finalJarCode = targetJar?.code || jarCode || txn.suggestedJarCode || 'NEC';
    const finalJarId = targetJar?.id || jarId;
    const finalCategory = categoryName || targetJar?.name || txn.suggestedCategory;

    // Cập nhật số dư chi tiêu của hũ
    if (txn.type === 'expense' && finalJarId) {
      setJars(prev => prev.map(j => {
        if (j.id === finalJarId || j.code === finalJarCode) {
          return { ...j, spentThisMonth: j.spentThisMonth + txn.amount };
        }
        return j;
      }));
    }

    const confirmedTxn: Transaction = {
      ...txn,
      suggestedJarCode: finalJarCode,
      jarId: finalJarId,
      suggestedCategory: finalCategory,
      occurredAtIso: txn.occurredAtIso || new Date().toISOString(),
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [confirmedTxn, ...prev]);
    setPendingTransactions(prev => prev.filter(t => t.id !== id));

    // Hiển thị Undo Toast trong 5 giây
    undoToast(`Đã duyệt: ${formatVND(txn.amount)} (${finalCategory})`, async () => {
      // Revert lại trạng thái chờ duyệt
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
          jarId: finalJarId,
          jarCode: finalJarCode,
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

    undoToast(`Đã bỏ qua giao dịch ${formatVND(txn.amount)}`, () => {
      setPendingTransactions(prev => [txn, ...prev]);
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

  // Cập nhật giao dịch đã duyệt (chỉnh hũ, ghi chú)
  const handleUpdateConfirmed = async (
    id: string,
    updates: { jarId?: string; jarCode?: string; category?: string; description?: string }
  ) => {
    setConfirmedTransactions(prev => prev.map(t => {
      if (t.id === id) {
        return {
          ...t,
          jarId: updates.jarId ?? t.jarId,
          suggestedJarCode: updates.jarCode ?? t.suggestedJarCode,
          suggestedCategory: updates.category ?? t.suggestedCategory,
          description: updates.description ?? t.description
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
          categoryName: updates.category
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

  // Thực hiện Reset trực tiếp (Sửa triệt để bug xóa nhầm transactions khi reset income)
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
      // Gửi đúng scope (không đổi income thành transactions!)
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
    setIncomeSources(prev => {
      const next = [...prev, newSource];
      localStorage.setItem('qltc_income_sources', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/income-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSource)
      });
      success(`Đã thêm nguồn thu "${newSource.name}"`);
    } catch (e) {
      console.error('Lỗi lưu nguồn thu:', e);
    }
  };

  // Cập nhật Nguồn thu dự kiến
  const handleUpdateIncomeSource = async (id: string, updates: Partial<IncomeSource>) => {
    setIncomeSources(prev => {
      const next = prev.map(s => s.id === id ? { ...s, ...updates } : s);
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
    setPlannedExpenses(prev => {
      const next = [...prev, newExp];
      localStorage.setItem('qltc_planned_expenses', JSON.stringify(next));
      return next;
    });

    try {
      await fetch(`${API_BASE}/planned-expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newExp)
      });
      success(`Đã thêm khoản chi "${newExp.name}"`);
    } catch (e) {
      console.error('Lỗi lưu khoản chi dự kiến:', e);
    }
  };

  // Cập nhật Khoản chi dự kiến
  const handleUpdatePlannedExpense = async (id: string, updates: Partial<PlannedExpense>) => {
    setPlannedExpenses(prev => {
      const next = prev.map(e => e.id === id ? { ...e, ...updates } : e);
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

  // Xóa giao dịch đã duyệt (hoàn lại số dư tài khoản)
  const handleDeleteConfirmed = async (id: string) => {
    const txn = confirmedTransactions.find(t => t.id === id);
    if (txn) {
      setAccounts(prev => prev.map(acc => {
        if (acc.name === txn.accountName) {
          const revertDelta = txn.type === 'income' ? -txn.amount : txn.amount;
          return { ...acc, balance: acc.balance + revertDelta };
        }
        return acc;
      }));
    }

    setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
      info('Đã xóa giao dịch và hoàn lại số dư');
    } catch (e) {
      console.error('Lỗi xóa giao dịch:', e);
    }
  };

  // Thêm giao dịch thủ công (hỗ trợ chuyển tiền nội bộ toAccountId)
  const handleAddTransaction = async (newTxn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    accountId: string;
    toAccountId?: string;
  }) => {
    // Cập nhật số dư tài khoản nguồn & đích
    setAccounts(prev => prev.map(acc => {
      if (acc.id === newTxn.accountId) {
        const delta = newTxn.type === 'income' ? newTxn.amount : -newTxn.amount;
        return { ...acc, balance: acc.balance + delta };
      }
      if (newTxn.type === 'transfer' && newTxn.toAccountId && acc.id === newTxn.toAccountId) {
        return { ...acc, balance: acc.balance + newTxn.amount };
      }
      return acc;
    }));

    const sourceAcc = accounts.find(a => a.id === newTxn.accountId);
    const targetAcc = newTxn.toAccountId ? accounts.find(a => a.id === newTxn.toAccountId) : undefined;
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
      bankCode: sourceAcc?.bankCode || 'CASH',
      accountMask: sourceAcc?.accountNumberMask || 'VÍ',
      accountName: sourceAcc?.name || 'Ghi chép thủ công',
      toAccountId: newTxn.toAccountId,
      toAccountName: targetAcc?.name,
      type: newTxn.type,
      amount: newTxn.amount,
      description: newTxn.description,
      suggestedCategory: newTxn.type === 'income' ? 'Thu nhập' : newTxn.type === 'transfer' ? 'Chuyển tiền nội bộ' : (matchedJar?.name || 'Chi tiêu'),
      suggestedJarCode: jarCode,
      jarId: newTxn.jarId,
      occurredAt: 'Vừa xong',
      occurredAtIso: isoNow,
      status: 'confirmed'
    };

    setConfirmedTransactions(prev => [createdTxn, ...prev]);
    success(`Đã ghi chép thành công: ${formatVND(newTxn.amount)}`);

    try {
      await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: txnId,
          accountId: newTxn.accountId,
          toAccountId: newTxn.toAccountId,
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

  // Thêm / cập nhật tài sản đầu tư
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
      success(`Đã lưu tài sản "${newHolding.symbol}"`);
    } catch (e) {
      console.error('Lỗi lưu tài sản:', e);
    }
  };

  // Xóa tài sản đầu tư
  const handleDeleteHolding = async (symbol: string) => {
    setHoldings(prev => prev.filter(h => h.symbol.toUpperCase() !== symbol.toUpperCase()));
    try {
      await fetch(`${API_BASE}/holdings/${symbol}`, { method: 'DELETE' });
      info(`Đã xóa tài sản ${symbol}`);
    } catch (e) {
      console.error('Lỗi xóa tài sản:', e);
    }
  };

  // Cập nhật giá thị trường tự động
  const handleSyncMarketPrices = async () => {
    setIsSyncingPrices(true);
    try {
      const res = await fetch(`${API_BASE}/investments/sync-prices`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.holdings && Array.isArray(data.holdings)) {
          setHoldings(data.holdings);
        }
        success('Đã cập nhật giá mới nhất từ Fmarket & Thị trường');
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

  // Thêm hũ mới
  const handleAddJar = async (newJar: { name: string; code?: string; targetPercent: number; monthlyLimit: number; color?: string }) => {
    const jarId = `jar_${Date.now()}`;
    const jarCode = newJar.code || newJar.name.substring(0, 4).toUpperCase();
    const createdJar: Jar = {
      id: jarId,
      code: jarCode,
      name: newJar.name,
      targetPercent: newJar.targetPercent,
      monthlyLimit: newJar.monthlyLimit,
      spentThisMonth: 0,
      color: newJar.color || '#8CC7AE'
    };

    setJars(prev => [...prev, createdJar]);
    success(`Đã tạo hũ "${newJar.name}"`);

    try {
      await fetch(`${API_BASE}/jars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: jarId,
          code: jarCode,
          name: newJar.name,
          monthly_limit: newJar.monthlyLimit,
          target_percent: newJar.targetPercent,
          color: newJar.color
        })
      });
    } catch (e) {
      console.error('Lỗi thêm hũ:', e);
    }
  };

  // Sửa hũ
  const handleUpdateJar = async (
    jarId: string,
    updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string }
  ) => {
    setJars(prev => prev.map(j => {
      if (j.id === jarId) {
        return {
          ...j,
          name: updates.name ?? j.name,
          targetPercent: updates.targetPercent ?? j.targetPercent,
          monthlyLimit: updates.monthlyLimit ?? j.monthlyLimit,
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
    const updated = jars.map(j => ({
      ...j,
      monthlyLimit: Math.round(totalIncome * (j.targetPercent || 0))
    }));
    setJars(updated);

    try {
      await fetch(`${API_BASE}/jars/auto-allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalIncome })
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        userProfile={userProfile}
        privacyMode={privacyMode}
        onTogglePrivacy={() => setPrivacyMode(!privacyMode)}
        onRefresh={handleRefreshAll}
        isRefreshing={isSyncing}
      />

      {/* Main View Area */}
      <main className="max-w-md mx-auto pt-3">
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
            onOpenQuickAddIncome={() => {
              setQuickAddInitialType('income');
              setIsQuickAddOpen(true);
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
        onClose={() => setIsQuickAddOpen(false)}
        jars={jars}
        accounts={accounts}
        initialType={quickAddInitialType}
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
