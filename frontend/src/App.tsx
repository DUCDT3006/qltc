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
import { readServerCollection } from './utils/serverCollections';
import { hasVerifiedPriceUpdates } from './utils/marketSync';
import { applyResetScope } from './utils/resetState';
import { closeTopOverlay } from './utils/overlayManager';
import { fetchFmarketFunds, FmarketFeedStatus } from './utils/fmarketFunds';
import { formatVND, formatPrivacyVND, allocateVndExact, cadenceFromRecurrence, recurrenceFromCadence } from './utils/financeMath';
import {
  API_BASE,
  installAuthenticatedFetchInterceptor,
  generateOperationId,
  saveDraftToOutbox,
  getDraftOutbox,
  removeDraftFromOutbox,
  replayDraftOutbox,
  fetchAllTransactions,
  apiRequestJson,
  checkAuthSessionWithTimeout
} from './services/apiClient';

// Cài đặt interceptor tự động đính kèm Authorization / X-Operation-Id cho toàn bộ /api/* (V2-01, V2-07)
installAuthenticatedFetchInterceptor();

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
  type: (a.type || 'bank') as BankAccount['type'],
  isActive: a.isActive !== undefined ? Boolean(a.isActive) : a.is_active !== undefined ? Boolean(a.is_active) : true,
  archivedAt: a.archivedAt ?? a.archived_at ?? null,
  revision: Number(a.revision ?? 1)
});

const mapHolding = (h: any): Holding => ({
  id: h.id,
  symbol: String(h.symbol || '').toUpperCase(),
  name: h.name || h.asset_name || h.symbol || 'Tài sản',
  assetClass: (h.assetClass ?? h.asset_class ?? 'fund') as Holding['assetClass'],
  quantity: Number(h.quantity ?? 0),
  avgCost: Number(h.avgCost ?? h.avg_cost ?? 0),
  currentPrice: Number(h.currentPrice ?? h.current_price ?? 0),
  unit: h.unit || h.holding_unit || h.source || 'CCQ',
  quoteUnit: h.quoteUnit ?? h.quote_unit ?? undefined,
  provider: h.provider ?? undefined,
  priceAsOf: h.priceAsOf ?? h.price_as_of ?? undefined,
  syncStatus: h.syncStatus ?? h.sync_status ?? 'ok',
  priceUpdatedAt: h.priceUpdatedAt ?? h.price_updated_at ?? undefined,
  autoSync: (h.autoSync ?? h.auto_sync) === undefined ? true : Boolean(h.autoSync ?? h.auto_sync),
  costBasisVnd: h.costBasisVnd !== undefined ? Number(h.costBasisVnd) : undefined,
  marketValueVnd: h.marketValueVnd !== undefined ? Number(h.marketValueVnd) : undefined,
  unrealizedPnlVnd: h.unrealizedPnlVnd !== undefined ? Number(h.unrealizedPnlVnd) : undefined,
  simpleRoiPct: h.simpleRoiPct !== undefined ? h.simpleRoiPct : undefined
});

const mapIncomeSource = (s: any): IncomeSource => ({
  id: s.id,
  name: s.name || 'Nguồn thu',
  kind: (s.kind || 'fixed') as IncomeSource['kind'],
  expectedAmount: Math.round(Number(s.expectedAmount ?? s.expected_amount ?? 0)),
  recurrence: s.recurrence || recurrenceFromCadence(s.cadence),
  cadence: s.cadence || cadenceFromRecurrence(s.recurrence),
  oneTimeDate: s.oneTimeDate ?? s.one_time_date ?? null,
  effectiveFromMonth: s.effectiveFromMonth ?? s.effective_from_month ?? undefined,
  color: s.color || '#8CC7AE',
  keywords: s.keywords || undefined
});

const mapPlannedExpense = (e: any): PlannedExpense => ({
  id: e.id,
  name: e.name || 'Khoản chi',
  jarCode: e.jarCode ?? e.jar_code ?? 'NEC',
  jarId: e.jarId ?? e.jar_id ?? undefined,
  expectedAmount: Math.round(Number(e.expectedAmount ?? e.expected_amount ?? 0)),
  recurrence: e.recurrence || recurrenceFromCadence(e.cadence),
  cadence: e.cadence || cadenceFromRecurrence(e.recurrence),
  oneTimeDate: e.oneTimeDate ?? e.one_time_date ?? null,
  effectiveFromMonth: e.effectiveFromMonth ?? e.effective_from_month ?? undefined,
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
    note: typeof t.note === 'string' ? t.note : undefined,
    suggestedCategory: category,
    suggestedJarCode: type === 'expense' ? (t.jar_code ?? t.suggestedJarCode ?? 'NEC') : '',
    jarId: type === 'expense' ? (t.jarId ?? t.jar_id ?? undefined) : undefined,
    incomeSourceId: type === 'income' ? (t.incomeSourceId ?? t.income_source_id ?? undefined) : undefined,
    incomeSourceName: type === 'income' ? (t.incomeSourceName ?? t.income_source_name ?? undefined) : undefined,
    balanceAfter: t.balanceAfter ?? t.balance_after ?? undefined,
    occurredAt: formatOccurredTime(rawIso),
    occurredAtIso: rawIso,
    status: t.status || 'pending',
    needsAccountReview: Boolean(t.needsAccountReview ?? t.needs_account_review),
    parseStatus: t.parseStatus ?? t.parse_status ?? undefined,
    confidence: t.confidence ?? 0.9,
    rawQuote: t.rawQuote ?? t.raw_body ?? undefined,
    transferPairId: t.transferPairId ?? t.transfer_pair_id ?? null,
    suggestedPairId: t.suggestedPairId ?? t.suggested_pair_id ?? null,
    pairedTxnId: t.pairedTxnId ?? t.paired_txn_id ?? null,
    pairedAccountName: t.pairedAccountName ?? t.paired_account_name ?? t.to_account_name ?? null,
    pairedBankCode: t.pairedBankCode ?? t.paired_bank_code ?? t.to_bank_code ?? null,
    pairedAccountMask: t.pairedAccountMask ?? t.paired_account_mask ?? t.to_account_number_mask ?? null,
    pairedType: t.pairedType ?? t.paired_type ?? null,
    revision: Number(t.revision ?? 1)
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
  const [authState, setAuthState] = useState<'checking' | 'signedOut' | 'signedIn' | 'unavailable'>('checking');
  const [authCheckAttempt, setAuthCheckAttempt] = useState(0);
  const [ownerTokenInput, setOwnerTokenInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [privacyMode, setPrivacyMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('qltc_privacy_mode') === '1';
    } catch {
      return false;
    }
  });
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingPrices, setIsSyncingPrices] = useState(false);
  const lastBackPressRef = useRef<number>(0);
  // V2-07 / AT2-16: Hàng đợi serialize các thao tác bất đồng bộ theo từng giao dịch (đảm bảo Confirm -> Undo luôn thực thi đúng thứ tự)
  const inFlightTxMutationsRef = useRef<Map<string, Promise<any>>>(new Map());

  const enqueueTxMutation = useCallback(<T,>(txId: string, fn: () => Promise<T>): Promise<T> => {
    const prev = inFlightTxMutationsRef.current.get(txId) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    inFlightTxMutationsRef.current.set(txId, next);
    return next;
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('qltc_privacy_mode', privacyMode ? '1' : '0');
    } catch {}
  }, [privacyMode]);

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
    return [];
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
  const [fmarketFeedStatus, setFmarketFeedStatus] = useState<FmarketFeedStatus>('unavailable');

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

  // Android Hardware Back button / Gestures + Escape Key + Double-Back-to-Exit (V2-22)
  useEffect(() => {
    const closeTopModalIfAny = (): boolean => {
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
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (closeTopModalIfAny()) {
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);

    (window as any).__handleBackPress = () => {
      if (closeTopOverlay()) {
        return true;
      }
      if (closeTopModalIfAny()) {
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
      window.removeEventListener('keydown', onKeyDown);
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
        profileRes
      ] = await Promise.all([
        fetch(`${API_BASE}/accounts`).catch(() => null),
        fetch(`${API_BASE}/jars`).catch(() => null),
        fetchAllTransactions().catch(() => null),
        fetch(`${API_BASE}/holdings`).catch(() => null),
        fetch(`${API_BASE}/income-sources`).catch(() => null),
        fetch(`${API_BASE}/planned-expenses`).catch(() => null),
        fetch(`${API_BASE}/user/profile`).catch(() => null)
      ]);

      let complete = [accountsRes, jarsRes, holdingsRes, incomeRes, plannedExpRes, profileRes].every(res => res?.ok)
        && Array.isArray(txnsRes);

      if (accountsRes && accountsRes.ok) {
        const aData = await accountsRes.json();
        if (Array.isArray(aData.accounts)) {
          setAccounts(aData.accounts.map(mapAccount));
        } else complete = false;
      }

      if (jarsRes && jarsRes.ok) {
        const jData = await jarsRes.json();
        const serverJars = readServerCollection(jData, 'jars', mapJar);
        if (serverJars !== null) setJars(serverJars);
        else complete = false;
      }

      if (holdingsRes && holdingsRes.ok) {
        const hData = await holdingsRes.json();
        if (Array.isArray(hData.holdings)) {
          setHoldings(hData.holdings.map(mapHolding));
        } else complete = false;
      }

      if (incomeRes && incomeRes.ok) {
        const iData = await incomeRes.json();
        if (Array.isArray(iData.incomeSources)) {
          const mappedIncome = iData.incomeSources.map(mapIncomeSource);
          setIncomeSources(mappedIncome);
          localStorage.setItem('qltc_income_sources', JSON.stringify(mappedIncome));
        } else complete = false;
      }

      if (plannedExpRes && plannedExpRes.ok) {
        const peData = await plannedExpRes.json();
        if (Array.isArray(peData.plannedExpenses)) {
          const mappedPe = peData.plannedExpenses.map(mapPlannedExpense);
          setPlannedExpenses(mappedPe);
          localStorage.setItem('qltc_planned_expenses', JSON.stringify(mappedPe));
        } else complete = false;
      }

      if (txnsRes) {
        if (Array.isArray(txnsRes)) {
          const allTxns: Transaction[] = txnsRes.map(mapTransaction);
          const outboxDrafts = getDraftOutbox();
          const pendingWithDrafts = [
            ...outboxDrafts.filter(d => d.method === 'POST' && d.endpoint === '/transactions').map(d => mapTransaction({ ...d.payload, id: d.id, status: 'draft' })),
            ...allTxns.filter(t => t.status === 'pending')
          ];
          setPendingTransactions(pendingWithDrafts);
          setConfirmedTransactions(allTxns.filter(t => t.status === 'confirmed'));
        }
      }

      if (profileRes && profileRes.ok) {
        const pData = await profileRes.json();
        const remoteProfile = pData.user || pData.profile;
        if (remoteProfile) {
          setUserProfile(remoteProfile);
          localStorage.setItem('qltc_user_profile', JSON.stringify(remoteProfile));
        } else complete = false;
      }
      if (!complete) error('Chưa tải đủ dữ liệu từ máy chủ. Một phần dữ liệu đang hiển thị có thể là bản đã lưu. Anh thử tải lại.');
      return complete;
    } catch (e) {
      console.warn('Backend offline, giữ cache local:', e);
      error('Không thể tải đầy đủ dữ liệu. Dữ liệu đã lưu vẫn được giữ nguyên. Anh thử tải lại.');
      return false;
    }
  }, [error]);

  useEffect(() => {
    let active = true;
    const authCheck = checkAuthSessionWithTimeout(fetch, 10000);
    setAuthState('checking');
    setAuthError('');

    authCheck.promise.then(result => {
      if (active) {
        const unavailable = result === 'unavailable' || result === 'timeout';
        setAuthState(unavailable ? 'unavailable' : result);
        if (result === 'timeout') {
          setAuthError('Máy chủ phản hồi quá lâu. Dữ liệu đã lưu trên thiết bị vẫn được giữ nguyên. Hãy thử kết nối lại.');
        } else if (result === 'unavailable') {
          setAuthError('Máy chủ đang tạm thời không khả dụng. Dữ liệu đã lưu trên thiết bị vẫn được giữ nguyên. Hãy thử lại khi có kết nối.');
        }
      }
    });

    return () => {
      active = false;
      authCheck.cancel();
    };
  }, [authCheckAttempt]);

  // Fetch the public fund catalog independently so a slow/unavailable quote feed
  // cannot block accounts, transactions, or other canonical app data.
  useEffect(() => {
    if (authState !== 'signedIn') return;
    let cancelled = false;
    fetchFmarketFunds(fetch, `${API_BASE}/market/fmarket-funds`)
      .then(result => {
        if (!cancelled) {
          setFmarketFunds(result.funds);
          setFmarketFeedStatus(result.status);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFmarketFunds([]);
          setFmarketFeedStatus('unavailable');
        }
      });
    return () => { cancelled = true; };
  }, [authState]);

  useEffect(() => {
    if (authState !== 'signedIn') return;
    const sync = async () => {
      if (!navigator.onLine) return;
      await replayDraftOutbox().catch(() => {});
      await loadDataFromBackend();
    };
    void sync();
    window.addEventListener('online', sync);
    return () => window.removeEventListener('online', sync);
  }, [authState, loadDataFromBackend]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    const token = ownerTokenInput.trim();
    if (!token) return;
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token })
      });
      if (!res.ok) throw new Error('Mã truy cập không hợp lệ');
      const session = await fetch(`${API_BASE}/auth/session`);
      if (!session.ok) throw new Error('Không xác nhận được phiên truy cập');
      setOwnerTokenInput('');
      setAuthState('signedIn');
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : 'Không thể đăng nhập');
    }
  };

  const signOut = async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'same-origin' });
    } finally {
      setAuthState('signedOut');
    }
  };

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

  // Cập nhật nhanh số dư / thông tin tài khoản (V2-07: Kiểm tra res.ok trước khi cập nhật sổ cái)
  const handleUpdateAccountBalance = async (
    accountId: string,
    newBalance: number,
    name?: string,
    type?: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto' | 'savings'
  ) => {
    const cleanBalance = Math.round(newBalance);
    try {
      const res = await fetch(`${API_BASE}/accounts/${accountId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: cleanBalance, name, type, operationId: generateOperationId('acc_bal') })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể cập nhật số dư tài khoản trên máy chủ');
        return;
      }
      const data = await res.json().catch(() => ({}));
      setAccounts(prev => prev.map(a => {
        if (a.id === accountId) {
          return data.account ? mapAccount(data.account) : {
            ...a,
            balance: cleanBalance,
            name: name || a.name,
            type: type || a.type
          };
        }
        return a;
      }));
      success('Đã cập nhật số dư tài khoản');
    } catch (e) {
      console.error('Lỗi lưu số dư:', e);
      error('Không thể kết nối máy chủ để cập nhật số dư');
    }
  };

  // Cập nhật toàn diện thông tin tài khoản (Tên, STK, Chủ TK, Chi nhánh, Số dư, Ngân hàng - V2-08)
  const handleUpdateAccount = async (updatedAcc: BankAccount) => {
    const cleanAcc: BankAccount = { ...updatedAcc, balance: Math.round(updatedAcc.balance || 0) };
    try {
      const res = await fetch(`${API_BASE}/accounts/${cleanAcc.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cleanAcc, operationId: generateOperationId('acc_upd') })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể lưu thay đổi tài khoản');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const merged = data.account ? mapAccount(data.account) : cleanAcc;
      setAccounts(prev => prev.map(a => a.id === cleanAcc.id ? merged : a));
      success(`Đã cập nhật thông tin "${merged.name}"`);
    } catch (e) {
      console.error('Lỗi cập nhật tài khoản:', e);
      error('Lỗi kết nối khi cập nhật tài khoản');
    }
  };

  // Thêm tài khoản mới (V2-07, V2-08)
  const handleAddAccount = async (newAcc: BankAccount) => {
    const cleanAcc: BankAccount = { ...newAcc, balance: Math.round(newAcc.balance || 0) };
    try {
      const res = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cleanAcc, operationId: generateOperationId('acc_add') })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể tạo tài khoản mới');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const created = data.account ? mapAccount(data.account) : cleanAcc;
      setAccounts(prev => [...prev, created]);
      success(`Đã thêm tài khoản "${created.name}"`);
    } catch (e) {
      console.error('Lỗi lưu tài khoản mới:', e);
      error('Không thể kết nối máy chủ để thêm tài khoản');
    }
  };

  // Xóa hoặc Lưu trữ tài khoản (V2-11 / AT2-22: Bảo toàn lịch sử giao dịch và tài sản ròng)
  const handleDeleteAccount = async (accountId: string) => {
    try {
      const res = await fetch(`${API_BASE}/accounts/${accountId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể xóa tài khoản');
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (data.action === 'archived') {
        setAccounts(prev => prev.map(a => a.id === accountId ? { ...a, isActive: false, archivedAt: new Date().toISOString() } : a));
        info(data.message || 'Tài khoản có lịch sử đã được chuyển sang Lưu trữ (Archived)');
      } else {
        setAccounts(prev => prev.filter(a => a.id !== accountId));
        info('Đã xóa tài khoản');
      }
    } catch (e) {
      console.error('Lỗi xóa tài khoản:', e);
      error('Lỗi kết nối khi xóa tài khoản');
    }
  };

  // Làm mới toàn diện từ Cloudflare
  const handleRefreshAll = async () => {
    setIsSyncing(true);
    try {
      if (await loadDataFromBackend()) info('Đã tải đầy đủ dữ liệu từ máy chủ');
    } finally {
      setIsSyncing(false);
    }
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

  // Xác nhận giao dịch (approve / swipe right) - V2-07, V2-03, V2-23
  const handleConfirmTransaction = async (
    id: string,
    jarCode?: string,
    categoryName?: string,
    jarId?: string,
    incomeSourceId?: string,
    accountIdOverride?: string,
    note?: string
  ) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (!txn) return;

    const effectiveAccountId = accountIdOverride || txn.accountId;
    if ((txn.needsAccountReview || effectiveAccountId === 'acc_unassigned') && !accountIdOverride) {
      error('Giao dịch chưa xác định rõ tài khoản ngân hàng. Vui lòng chọn tài khoản trước khi duyệt.');
      return;
    }

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

    const opIdConfirm = generateOperationId('tx_confirm');

    await enqueueTxMutation(id, async () => {
      try {
        const res = await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId: opIdConfirm,
            status: 'confirmed',
            accountId: effectiveAccountId,
            note,
            jarId: txn.type === 'expense' ? (finalJarId || null) : null,
            jarCode: txn.type === 'expense' ? finalJarCode : null,
            incomeSourceId: txn.type === 'income' ? (incomeSourceId || null) : null,
            categoryName: finalCategory
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          error(errData?.error || 'Không thể duyệt giao dịch trên máy chủ');
          return;
        }

        const respData = await res.json().catch(() => ({}));
        const txWithAccount: Transaction = { ...txn, accountId: effectiveAccountId };

        // 1. Cập nhật sổ cái tài khoản & hũ chi tiêu sau khi máy chủ đã xác nhận
        applyAccountLedgerDelta(txWithAccount, false);

        if (txn.type === 'expense' && finalJarId) {
          setJars(prev => prev.map(j => (
            j.id === finalJarId ? { ...j, spentThisMonth: j.spentThisMonth + txn.amount } : j
          )));
        }

        const confirmedTxn: Transaction = {
          ...txWithAccount,
          note: (note === undefined ? txn.note : note)?.trim() || undefined,
          suggestedJarCode: finalJarCode,
          jarId: finalJarId,
          incomeSourceId: txn.type === 'income' ? incomeSourceId : undefined,
          suggestedCategory: finalCategory,
          occurredAtIso: txn.occurredAtIso || new Date().toISOString(),
          status: 'confirmed',
          needsAccountReview: false,
          revision: respData.revision ?? (txn.revision || 1) + 1
        };

        setConfirmedTransactions(prev => [confirmedTxn, ...prev]);
        setPendingTransactions(prev => prev.filter(t => t.id !== id));
        removeDraftFromOutbox(id);

        // 2. Hiển thị Undo Toast trong 5 giây (tuần tự hóa sau Confirm theo V2-07 / AT2-16, tôn trọng privacyMode V2-23)
        undoToast(`Đã duyệt: ${formatPrivacyVND(txn.amount, privacyMode)} (${finalCategory})`, async () => {
          await enqueueTxMutation(id, async () => {
            try {
              const undoRes = await fetch(`${API_BASE}/transactions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  operationId: generateOperationId('tx_undo'),
                  status: 'pending'
                })
              });
              if (!undoRes.ok) {
                error('Không thể hoàn tác giao dịch trên máy chủ');
                return;
              }
              applyAccountLedgerDelta(txWithAccount, true);
              if (txn.type === 'expense' && finalJarId) {
                setJars(prev => prev.map(j => (
                  j.id === finalJarId ? { ...j, spentThisMonth: Math.max(0, j.spentThisMonth - txn.amount) } : j
                )));
              }
              setConfirmedTransactions(prev => prev.filter(t => t.id !== id));
              setPendingTransactions(prev => [{ ...txn, note: confirmedTxn.note }, ...prev]);
            } catch {
              error('Lỗi kết nối khi hoàn tác giao dịch');
            }
          });
        }, 5000);
      } catch (err) {
        console.error('Lỗi cập nhật giao dịch:', err);
        error('Không thể kết nối máy chủ để duyệt giao dịch');
      }
    });
  };

  // Bỏ qua giao dịch (reject / swipe left) - V2-07, V2-23
  const handleRejectTransaction = async (id: string) => {
    const txn = pendingTransactions.find(t => t.id === id);
    if (!txn) return;

    await enqueueTxMutation(id, async () => {
      try {
        const res = await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId: generateOperationId('tx_reject'),
            status: 'rejected'
          })
        });
        if (!res.ok) {
          error('Không thể từ chối giao dịch trên máy chủ');
          return;
        }

        setPendingTransactions(prev => prev.filter(t => t.id !== id));

        undoToast(`Đã bỏ qua giao dịch ${formatPrivacyVND(txn.amount, privacyMode)}`, async () => {
          await enqueueTxMutation(id, async () => {
            try {
              const undoRes = await fetch(`${API_BASE}/transactions/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  operationId: generateOperationId('tx_undo_reject'),
                  status: 'pending'
                })
              });
              if (undoRes.ok) {
                setPendingTransactions(prev => [txn, ...prev]);
              }
            } catch {}
          });
        }, 5000);
      } catch (err) {
        console.error('Lỗi từ chối giao dịch:', err);
        error('Lỗi kết nối khi từ chối giao dịch');
      }
    });
  };

  // Cập nhật giao dịch đã duyệt (chỉnh hũ, nguồn thu, ghi chú, số tiền, tài khoản, ngày giao dịch - V2-20 / AT2-37)
  const handleUpdateConfirmed = async (
    id: string,
    updates: {
      jarId?: string;
      jarCode?: string;
      category?: string;
      description?: string;
      note?: string;
      incomeSourceId?: string | null;
      amount?: number;
      accountId?: string;
      occurredAt?: string;
    }
  ) => {
    const existing = confirmedTransactions.find(t => t.id === id);
    if (!existing) return;

    await enqueueTxMutation(id, async () => {
      try {
        const res = await fetch(`${API_BASE}/transactions/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operationId: generateOperationId('tx_edit'),
            description: updates.description,
            note: updates.note,
            jarId: updates.jarId,
            jarCode: updates.jarCode,
            categoryName: updates.category,
            incomeSourceId: updates.incomeSourceId,
            amount: updates.amount !== undefined ? Math.round(updates.amount) : undefined,
            accountId: updates.accountId,
            occurredAt: updates.occurredAt
          })
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          error(errData?.error || 'Không thể lưu thay đổi giao dịch');
          return;
        }

        // Nếu thay đổi số tiền, tài khoản hoặc ngày giao dịch thì đồng bộ lại từ máy chủ để sổ cái chính xác 100%
        if (
          (updates.amount !== undefined && updates.amount !== existing.amount) ||
          (updates.accountId !== undefined && updates.accountId !== existing.accountId) ||
          updates.occurredAt !== undefined
        ) {
          await loadDataFromBackend();
        } else {
          if (existing.type === 'expense' && updates.jarId && updates.jarId !== existing.jarId) {
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
                note: updates.note === undefined ? t.note : updates.note.trim() || undefined,
                incomeSourceId: updates.incomeSourceId !== undefined ? (updates.incomeSourceId || undefined) : t.incomeSourceId
              };
            }
            return t;
          }));
        }

        success('Đã lưu thay đổi giao dịch');
      } catch (e) {
        console.error('Lỗi lưu giao dịch:', e);
        error('Không thể kết nối máy chủ để lưu thay đổi');
      }
    });
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

  // Thực hiện Reset trực tiếp (V2-07, V2-09: Chờ xác nhận máy chủ trước khi xóa state)
  const handleDirectReset = async (scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'all') => {
    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, clearNotifications: true, operationId: generateOperationId('reset') })
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể đặt lại dữ liệu trên máy chủ');
        throw new Error(errData?.error || 'Reset failed');
      }

      const resetState = applyResetScope({
        accounts,
        jars,
        holdings,
        incomeSources,
        plannedExpenses,
        pendingTransactions,
        confirmedTransactions
      }, scope);
      setPendingTransactions(resetState.pendingTransactions);
      setConfirmedTransactions(resetState.confirmedTransactions);
      setAccounts(resetState.accounts);
      setJars(resetState.jars);
      setHoldings(resetState.holdings);
      setIncomeSources(resetState.incomeSources);
      setPlannedExpenses(resetState.plannedExpenses);

      if (scope === 'income' || scope === 'all') {
        localStorage.setItem('qltc_income_sources', '[]');
      }
      if (scope === 'all') {
        localStorage.setItem('qltc_planned_expenses', '[]');
      }

      await loadDataFromBackend();
      success('Đã thiết lập lại dữ liệu thành công');
    } catch (err) {
      console.error('Lỗi gọi API reset:', err);
      error('Không thể kết nối máy chủ để đặt lại dữ liệu');
      throw err;
    }
  };

  // Thêm Nguồn thu dự kiến
  const handleAddIncomeSource = async (newSource: IncomeSource) => {
    const cleanSource = mapIncomeSource(newSource);
    try {
      await apiRequestJson(`${API_BASE}/income-sources`, {
        method: 'POST',
        body: { ...cleanSource, cadence: cadenceFromRecurrence(cleanSource.recurrence), oneTimeDate: cleanSource.oneTimeDate }
      });
      await loadDataFromBackend();
      success(`Đã thêm nguồn thu "${cleanSource.name}"`);
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không lưu được nguồn thu');
    }
  };

  // Cập nhật Nguồn thu dự kiến
  const handleUpdateIncomeSource = async (id: string, updates: Partial<IncomeSource>) => {
    try {
      const next = { ...incomeSources.find(s => s.id === id), ...updates };
      await apiRequestJson(`${API_BASE}/income-sources/${id}`, {
        method: 'PUT',
        body: { ...next, cadence: cadenceFromRecurrence(next.recurrence), oneTimeDate: next.oneTimeDate }
      });
      await loadDataFromBackend();
      success('Đã cập nhật nguồn thu');
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không cập nhật được nguồn thu');
    }
  };

  // Xóa Nguồn thu dự kiến
  const handleDeleteIncomeSource = async (id: string) => {
    try {
      await apiRequestJson(`${API_BASE}/income-sources/${id}`, { method: 'DELETE' });
      await loadDataFromBackend();
      info('Đã xóa nguồn thu');
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không xóa được nguồn thu');
    }
  };

  // Thêm Khoản chi dự kiến
  const handleAddPlannedExpense = async (newExp: PlannedExpense) => {
    const cleanExp = mapPlannedExpense(newExp);
    try {
      await apiRequestJson(`${API_BASE}/planned-expenses`, {
        method: 'POST',
        body: { ...cleanExp, cadence: cadenceFromRecurrence(cleanExp.recurrence), oneTimeDate: cleanExp.oneTimeDate, jarId: jars.find(j => j.code === cleanExp.jarCode)?.id }
      });
      await loadDataFromBackend();
      success(`Đã thêm khoản chi "${cleanExp.name}"`);
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không lưu được khoản chi dự kiến');
    }
  };

  // Cập nhật Khoản chi dự kiến
  const handleUpdatePlannedExpense = async (id: string, updates: Partial<PlannedExpense>) => {
    try {
      const next = { ...plannedExpenses.find(e => e.id === id), ...updates };
      await apiRequestJson(`${API_BASE}/planned-expenses/${id}`, {
        method: 'PUT',
        body: { ...next, cadence: cadenceFromRecurrence(next.recurrence), oneTimeDate: next.oneTimeDate, jarId: jars.find(j => j.code === next.jarCode)?.id }
      });
      await loadDataFromBackend();
      success('Đã cập nhật khoản chi dự kiến');
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không cập nhật được khoản chi dự kiến');
    }
  };

  // Xóa Khoản chi dự kiến
  const handleDeletePlannedExpense = async (id: string) => {
    try {
      await apiRequestJson(`${API_BASE}/planned-expenses/${id}`, { method: 'DELETE' });
      await loadDataFromBackend();
      info('Đã xóa khoản chi dự kiến');
    } catch (e) {
      error(e instanceof Error ? e.message : 'Không xóa được khoản chi dự kiến');
    }
  };

  // Xóa giao dịch đã duyệt (hoàn lại số dư tài khoản & hũ chi tiêu - V2-07)
  const handleDeleteConfirmed = async (id: string) => {
    const txn = confirmedTransactions.find(t => t.id === id);
    try {
      const res = await fetch(`${API_BASE}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể xóa giao dịch trên máy chủ');
        return;
      }

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
      info('Đã xóa giao dịch và hoàn lại số dư');
    } catch (e) {
      console.error('Lỗi xóa giao dịch:', e);
      error('Không thể kết nối máy chủ để xóa giao dịch');
    }
  };

  // Thêm giao dịch thủ công (hỗ trợ chuyển tiền nội bộ toAccountId, nguồn thu incomeSourceId & ngày occurredAt - V2-07, V2-20, V2-23)
  const handleAddTransaction = async (newTxn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    incomeSourceId?: string;
    accountId: string;
    toAccountId?: string;
    occurredAt?: string;
  }) => {
    const cleanAmount = Math.round(newTxn.amount);
    const sourceAcc = accounts.find(a => a.id === newTxn.accountId);
    const targetAcc = newTxn.toAccountId ? accounts.find(a => a.id === newTxn.toAccountId) : undefined;
    const matchedJar = jars.find(j => j.id === newTxn.jarId);
    const matchedIncomeSrc = newTxn.incomeSourceId
      ? incomeSources.find(s => s.id === newTxn.incomeSourceId)
      : undefined;
    const jarCode = matchedJar?.code || 'NEC';

    const txnId = `txn_${Date.now()}`;
    const isoOccurred = newTxn.occurredAt ? new Date(newTxn.occurredAt).toISOString() : new Date().toISOString();
    const operationId = generateOperationId('tx_create');
    const categoryLabel =
      newTxn.type === 'income'
        ? (matchedIncomeSrc?.name || 'Thu nhập khác')
        : newTxn.type === 'transfer'
        ? 'Chuyển tiền nội bộ'
        : (matchedJar?.name || 'Chi tiêu');

    const requestBody = {
      id: txnId,
      operationId,
      accountId: newTxn.accountId,
      toAccountId: newTxn.toAccountId,
      type: newTxn.type,
      amount: cleanAmount,
      description: newTxn.description,
      jarId: newTxn.type === 'expense' ? newTxn.jarId : undefined,
      jarCode,
      incomeSourceId: newTxn.type === 'income' ? newTxn.incomeSourceId : undefined,
      categoryName: categoryLabel,
      occurredAt: isoOccurred
    };

    try {
      const res = await fetch(`${API_BASE}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || `Không thể lưu giao dịch (HTTP ${res.status})`);
      }

      const respData = await res.json().catch(() => ({}));

      // Cập nhật số dư từ kết quả máy chủ trả về hoặc áp dụng delta
      if (Array.isArray(respData.affectedAccounts) && respData.affectedAccounts.length > 0) {
        setAccounts(prev => prev.map(acc => {
          const updated = respData.affectedAccounts.find((u: any) => u.id === acc.id);
          return updated ? { ...acc, balance: Number(updated.balance), revision: Number(updated.revision || acc.revision || 1) } : acc;
        }));
      }

      if (newTxn.type === 'expense' && newTxn.jarId) {
        setJars(prev => prev.map(j => (
          j.id === newTxn.jarId ? { ...j, spentThisMonth: j.spentThisMonth + cleanAmount } : j
        )));
      }

      const createdTxn: Transaction = {
        id: respData.id || txnId,
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
        occurredAt: formatOccurredTime(isoOccurred),
        occurredAtIso: isoOccurred,
        status: 'confirmed',
        revision: respData.revision || 1
      };

      setConfirmedTransactions(prev => [createdTxn, ...prev]);
      success(`Đã ghi chép thành công: ${formatPrivacyVND(cleanAmount, privacyMode)}`);
    } catch (e) {
      // V2-07 / AT2-15: Khi mất mạng, giữ bản ghi ở trạng thái draft chờ đồng bộ thay vì giả mạo confirmed
      console.error('Lỗi lưu giao dịch thủ công, chuyển vào outbox draft:', e);
      const persisted = saveDraftToOutbox({
        id: txnId,
        operationId,
        endpoint: '/transactions',
        method: 'POST',
        payload: requestBody,
        createdAt: isoOccurred,
        status: 'draft'
      });
      if (!persisted) {
        error('Không lưu được bản nháp trên thiết bị. Vui lòng sao chép thông tin giao dịch trước khi đóng ứng dụng.');
        return;
      }

      const draftTxn: Transaction = {
        id: txnId,
        accountId: newTxn.accountId,
        bankCode: sourceAcc?.bankCode || 'CASH',
        accountMask: sourceAcc?.accountNumberMask || 'VÍ',
        accountName: sourceAcc?.name || 'Ghi chép thủ công',
        toAccountId: newTxn.toAccountId,
        toAccountName: targetAcc?.name,
        type: newTxn.type,
        amount: cleanAmount,
        description: `[Chờ đồng bộ] ${newTxn.description}`,
        suggestedCategory: categoryLabel,
        suggestedJarCode: jarCode,
        jarId: newTxn.type === 'expense' ? newTxn.jarId : undefined,
        incomeSourceId: newTxn.type === 'income' ? newTxn.incomeSourceId : undefined,
        incomeSourceName: matchedIncomeSrc?.name,
        occurredAt: formatOccurredTime(isoOccurred),
        occurredAtIso: isoOccurred,
        status: 'draft'
      };

      setPendingTransactions(prev => [draftTxn, ...prev]);
      info(`Giao dịch lưu nháp, chưa vào sổ: ${e instanceof Error ? e.message : 'Không thể kết nối máy chủ'}`);
    }
  };

  // Thêm / cập nhật tài sản đầu tư (V2-18: Cập nhật theo id ổn định khi đổi symbol để không nhân đôi dòng)
  const handleAddHolding = async (newHolding: Holding) => {
    const cleanHolding = mapHolding(newHolding);
    try {
      const res = await fetch(`${API_BASE}/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cleanHolding, operationId: generateOperationId('hld_save') })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể lưu tài sản đầu tư');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const savedHolding: Holding = {
        ...cleanHolding,
        id: data.id || cleanHolding.id
      };

      setHoldings(prev => {
        const idxById = savedHolding.id ? prev.findIndex(h => h.id === savedHolding.id) : -1;
        if (idxById >= 0) {
          const updated = [...prev];
          updated[idxById] = savedHolding;
          return updated;
        }
        const idxBySym = prev.findIndex(h => h.symbol.toUpperCase() === savedHolding.symbol.toUpperCase());
        if (idxBySym >= 0) {
          const updated = [...prev];
          updated[idxBySym] = savedHolding;
          return updated;
        }
        return [...prev, savedHolding];
      });
      success(`Đã lưu tài sản "${savedHolding.symbol}"`);
    } catch (e) {
      console.error('Lỗi lưu tài sản:', e);
      error('Không thể kết nối máy chủ để lưu tài sản');
    }
  };

  // Xóa tài sản đầu tư
  const handleDeleteHolding = async (symbolOrId: string) => {
    try {
      const res = await fetch(`${API_BASE}/holdings/${encodeURIComponent(symbolOrId)}`, { method: 'DELETE' });
      if (!res.ok) {
        error('Không thể xóa tài sản đầu tư trên máy chủ');
        return;
      }
      setHoldings(prev => prev.filter(h => h.id !== symbolOrId && h.symbol.toUpperCase() !== symbolOrId.toUpperCase()));
      info(`Đã xóa tài sản ${symbolOrId}`);
    } catch (e) {
      console.error('Lỗi xóa tài sản:', e);
      error('Không thể kết nối máy chủ để xóa tài sản');
    }
  };

  // Cập nhật giá thị trường tự động (Fmarket NAV, Vàng, Bạc, Crypto)
  const handleSyncMarketPrices = async (): Promise<boolean> => {
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
        if (hasVerifiedPriceUpdates(data)) {
          success(`Đã cập nhật ${Object.keys(data.updated as Record<string, unknown>).length} giá có nguồn xác minh`);
          return true;
        } else {
          info('Chưa có giá mới xác minh; giữ giá cũ và trạng thái stale nếu nguồn lỗi');
          return false;
        }
      } else {
        error('Không thể đồng bộ giá thị trường lúc này');
        return false;
      }
    } catch (e) {
      console.error('Lỗi đồng bộ giá:', e);
      error('Không thể kết nối máy chủ giá thị trường');
      return false;
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

  // Tự động phân bổ hũ theo % từ Tổng Thu Dự Kiến (V2-17: Largest Remainder chính xác từng đồng VND, chặn tổng % != 100%)
  const handleAutoAllocateJars = async (totalIncome: number) => {
    const cleanIncome = Math.round(totalIncome);
    if (!Number.isSafeInteger(cleanIncome) || cleanIncome <= 0) {
      error('Tổng thu nhập dự kiến phải là số nguyên dương hợp lệ');
      return;
    }

    const totalPctBps = jars.reduce((s, j) => s + Math.round((j.targetPercent || 0) * 10000), 0);
    if (Math.abs(totalPctBps - 10000) > 1) {
      error(`Tổng tỷ lệ các hũ đang là ${(totalPctBps / 100).toFixed(1)}% (yêu cầu đúng 100% trước khi phân bổ)`);
      return;
    }

    const exactShares = allocateVndExact(
      cleanIncome,
      jars.map(j => Math.round((j.targetPercent || 0) * 10000))
    );

    try {
      const res = await fetch(`${API_BASE}/jars/auto-allocate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ totalIncome: cleanIncome })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        error(errData?.error || 'Không thể tự động phân bổ hạn mức hũ trên máy chủ');
        return;
      }
      const data = await res.json().catch(() => ({}));
      const updated = jars.map((j, idx) => ({
        ...j,
        monthlyLimit:
          data.allocations && typeof data.allocations[j.id] === 'number'
            ? Number(data.allocations[j.id])
            : exactShares[idx] || 0
      }));
      setJars(updated);
      success('Đã tự động tính hạn mức các hũ chính xác từng đồng theo % thu nhập');
    } catch (e) {
      console.error('Lỗi tự động phân bổ hũ:', e);
      error('Không thể kết nối máy chủ để lưu phân bổ hũ');
    }
  };

  if (authState !== 'signedIn') return (
    <main className="min-h-screen bg-[#0E1314] text-[#F2F5F5] flex items-center justify-center p-5">
      <form onSubmit={signIn} className="w-full max-w-sm rounded-3xl bg-[#161C1E] border border-[#8BA5AA]/20 p-6 space-y-4">
        <h1 className="text-xl font-bold">QLTC cá nhân</h1>
        {authState === 'checking' ? <p role="status">Đang kiểm tra phiên truy cập…</p> : authState === 'unavailable' ? <>
          {authError && <p role="alert" className="text-sm text-[#F2C879]">{authError}</p>}
          <button type="button" onClick={() => setAuthCheckAttempt(attempt => attempt + 1)} className="w-full rounded-xl p-3 bg-[#8CC7AE] text-[#0E1314] font-bold">Thử kết nối lại</button>
        </> : <>
          <p className="text-sm text-[#BFD0D3]">Nhập mã chủ tài khoản đã cấu hình trên máy chủ để đồng bộ dữ liệu. Phiên đăng nhập được lưu bằng cookie trên thiết bị này.</p>
          <label className="block text-sm">Mã truy cập
            <input type="password" autoComplete="off" value={ownerTokenInput} onChange={e => setOwnerTokenInput(e.target.value)} className="mt-2 w-full rounded-xl p-3 bg-[#20292B] border border-[#8BA5AA]/30" />
          </label>
          {authError && <p role="alert" className="text-[#E06D6D] text-sm">{authError}</p>}
          <button type="submit" disabled={!ownerTokenInput.trim()} className="w-full rounded-xl p-3 bg-[#8CC7AE] text-[#0E1314] font-bold disabled:opacity-40">Đăng nhập</button>
        </>}
      </form>
    </main>
  );

  return (
    <div className="min-h-screen bg-[#0E1314] text-[#F2F5F5] font-sans antialiased pb-12 selection:bg-[#8CC7AE] selection:text-[#0E1314]">
      {/* Top Navbar */}
      <div className="flex justify-end px-5 pt-2">
        <button type="button" onClick={signOut} className="text-xs text-[#BFD0D3] underline underline-offset-2">Đăng xuất</button>
      </div>
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
        {currentTab === 'dashboard' && accounts.length === 0 && jars.length === 0 && (
          <section className="mx-4 mb-3 rounded-2xl border border-[#8BA5AA]/20 bg-[#1C2426] p-4" aria-label="Bắt đầu thiết lập tài chính">
            <h2 className="text-sm font-bold text-[#F2F5F5]">Bắt đầu với dữ liệu của anh</h2>
            <p className="mt-1 text-xs leading-relaxed text-[#BFD0D3]">Tài khoản và hũ hiện đang trống. Thêm tài khoản ngân hàng/ví thực tế trong Cài đặt, rồi tạo các hũ ngân sách trong mục Ngân sách.</p>
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setIsSettingsOpen(true)} className="flex-1 rounded-xl bg-[#657D81] px-3 py-2 text-xs font-semibold text-white">Thêm tài khoản</button>
              <button type="button" onClick={() => setCurrentTab('budget')} className="flex-1 rounded-xl bg-[#232E31] px-3 py-2 text-xs font-semibold text-[#C4D0D2]">Thiết lập hũ</button>
            </div>
          </section>
        )}
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
            privacyMode={privacyMode}
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
            privacyMode={privacyMode}
          />
        )}

        {currentTab === 'investments' && (
          <InvestmentsView
            holdings={holdings}
            fmarketFunds={fmarketFunds}
            fmarketFeedStatus={fmarketFeedStatus}
            isSyncingPrices={isSyncingPrices}
            onAddHolding={handleAddHolding}
            onDeleteHolding={handleDeleteHolding}
            onSyncMarketPrices={handleSyncMarketPrices}
            privacyMode={privacyMode}
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
        privacyMode={privacyMode}
        onRefreshAll={async () => { await loadDataFromBackend(); }}
        onDirectReset={handleDirectReset}
      />
    </div>
  );
}

export default App;
