import React, { useState, useEffect } from 'react';
import { Sparkline } from '../components/Sparkline';
import { Jar, Holding, IncomeSource, PlannedExpense, Transaction, BankAccount } from '../types';
import { formatVND, normalizeToMonthlyAmount, computeExact100Percentages } from '../utils/financeMath';
import { isTxnInPeriod, getVietnamDate, periodBoundsUtc } from '../utils/dateUtils';
import { API_BASE } from '../services/apiClient';
import { resolvePlannedValue, SummaryRequestState } from '../utils/plannedSummary';
import { CurrencyInput } from '../components/CurrencyInput';
import { JarDetailModal } from '../components/JarDetailModal';
import { IncomeSourceDetailModal } from '../components/IncomeSourceDetailModal';
import { AccountQrModal } from '../components/AccountQrModal';
import { useManagedOverlay } from '../utils/overlayManager';
import { findBankByCode } from '../utils/vietnamBanks';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Wallet,
  TrendingUp,
  Coins,
  MapPin,
  Edit3,
  Check,
  X,
  ArrowUpRight,
  Scale,
  Plus,
  QrCode,
  Copy
} from 'lucide-react';

interface DashboardViewProps {
  netWorth: number;
  liquidCash: number;
  totalInvestments: number;
  accounts: BankAccount[];
  jars: Jar[];
  holdings: Holding[];
  incomeSources: IncomeSource[];
  plannedExpenses: PlannedExpense[];
  confirmedTransactions: Transaction[];
  pendingCount: number;
  privacyMode: boolean;
  isSyncingPrices?: boolean;
  onSyncMarketPrices: () => Promise<boolean>;
  onUpdateAccountBalance: (accountId: string, newBalance: number, name?: string, type?: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto' | 'savings') => Promise<void>;
  onAddAccount: (acc: BankAccount) => void;
  onOpenInbox: () => void;
  onOpenBudget: () => void;
  onOpenInvestments: () => void;
}

type PeriodMode = 'month' | 'quarter' | 'year';

export const DashboardView: React.FC<DashboardViewProps> = ({
  netWorth,
  liquidCash,
  totalInvestments,
  accounts,
  jars,
  holdings,
  incomeSources,
  plannedExpenses,
  confirmedTransactions,
  pendingCount,
  privacyMode,
  isSyncingPrices = false,
  onSyncMarketPrices,
  onUpdateAccountBalance,
  onAddAccount,
  onOpenInbox,
  onOpenBudget,
  onOpenInvestments
}) => {
  const nowVN = getVietnamDate();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [selectedYear, setSelectedYear] = useState<number>(nowVN.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(nowVN.getMonth() + 1); // 1..12
  const [selectedQuarter, setSelectedQuarter] = useState<number>(Math.floor(nowVN.getMonth() / 3) + 1); // 1..4

  // Modal chỉnh nhanh số dư Ngân hàng / Tiền mặt ngay tại Tổng quan
  const [showQuickCashModal, setShowQuickCashModal] = useState(false);
  const [editingAccId, setEditingAccId] = useState<string>('');
  const [qrModalAccount, setQrModalAccount] = useState<BankAccount | null>(null);
  const [copiedAccId, setCopiedAccId] = useState<string | null>(null);
  const [editingBalance, setEditingBalance] = useState<number>(0);
  const [newCashName, setNewCashName] = useState('');
  const [newCashType, setNewCashType] = useState<'bank' | 'cash' | 'savings'>('cash');
  const [newCashBalance, setNewCashBalance] = useState<number>(0);
  const [syncDone, setSyncDone] = useState(false);
  const [selectedJarForDetail, setSelectedJarForDetail] = useState<Jar | null>(null);
  const [selectedIncomeSourceForDetail, setSelectedIncomeSourceForDetail] = useState<IncomeSource | null>(null);
  const [isUnassignedIncomeDetail, setIsUnassignedIncomeDetail] = useState(false);
  const quickCashDialogProps = useManagedOverlay(showQuickCashModal, () => setShowQuickCashModal(false), 'Cập nhật số dư tài khoản');

  // Điều hướng kỳ thống kê
  const handlePrevPeriod = () => {
    if (periodMode === 'month') {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear(y => y - 1);
      } else {
        setSelectedMonth(m => m - 1);
      }
    } else if (periodMode === 'quarter') {
      if (selectedQuarter === 1) {
        setSelectedQuarter(4);
        setSelectedYear(y => y - 1);
      } else {
        setSelectedQuarter(q => q - 1);
      }
    } else {
      setSelectedYear(y => y - 1);
    }
  };

  const handleNextPeriod = () => {
    if (periodMode === 'month') {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear(y => y + 1);
      } else {
        setSelectedMonth(m => m + 1);
      }
    } else if (periodMode === 'quarter') {
      if (selectedQuarter === 4) {
        setSelectedQuarter(1);
        setSelectedYear(y => y + 1);
      } else {
        setSelectedQuarter(q => q + 1);
      }
    } else {
      setSelectedYear(y => y + 1);
    }
  };

  const periodMultiplier = periodMode === 'month' ? 1 : periodMode === 'quarter' ? 3 : 12;
  const periodLabel =
    periodMode === 'month'
      ? `Tháng ${selectedMonth}/${selectedYear}`
      : periodMode === 'quarter'
      ? `Quý ${selectedQuarter}/${selectedYear}`
      : `Năm ${selectedYear}`;

  // L-11: Tải thống kê tổng hợp từ D1 cho kỳ Quý / Năm (hoặc khi vượt quá bộ nhớ đệm client)
  const [serverSummary, setServerSummary] = useState<{
    totals: { actualIncome: number; actualExpense: number; plannedIncome: number | null; plannedExpense: number | null };
    jarBuckets: Array<{ id: string; actualSpent: number }>;
    incomeBuckets: Array<{ id: string; actualReceived: number; expectedAmount: number }>;
    unassigned: { income: number; expense: number };
    orphaned: { income: number; expense: number };
  } | null>(null);
  const [summaryRequestState, setSummaryRequestState] = useState<SummaryRequestState>('loading');

  useEffect(() => {
    let cancelled = false;
    setServerSummary(null);
    setSummaryRequestState('loading');
    const { fromInclusiveUtc, toExclusiveUtc } = periodBoundsUtc(periodMode, { year: selectedYear, month: selectedMonth, quarter: selectedQuarter });
    fetch(
      `${API_BASE}/analytics/summary?period=${periodMode}&startDate=${encodeURIComponent(fromInclusiveUtc)}&toExclusive=${encodeURIComponent(toExclusiveUtc)}`
    )
      .then(async response => {
        if (!response.ok) throw new Error(`Summary API HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (cancelled) return;
        if (!data || typeof data !== 'object' || !data.totals || !Array.isArray(data.jarBuckets) || !Array.isArray(data.incomeBuckets)) {
          throw new Error('Summary API response is invalid');
        }
        setServerSummary(data);
        setSummaryRequestState('loaded');
      })
      .catch(() => {
        if (!cancelled) {
          setServerSummary(null);
          setSummaryRequestState('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [periodMode, selectedYear, selectedMonth, selectedQuarter, confirmedTransactions, jars, incomeSources, plannedExpenses]);

  // Lọc các giao dịch đã duyệt nằm trong kỳ được chọn (chuẩn múi giờ UTC+7, đọc từ occurredAtIso)
  const periodTransactions = confirmedTransactions.filter(t =>
    isTxnInPeriod(t.occurredAtIso || t.occurredAt, periodMode, {
      year: selectedYear,
      month: selectedMonth,
      quarter: selectedQuarter
    })
  );

  // ============================================================================
  // 1. THỐNG KÊ TÀI SẢN THỰC TẾ HIỆN CÓ (6 NHÓM TÀI SẢN TOÀN DIỆN)
  // ============================================================================
  const bankAccounts = accounts.filter(a => a.type === 'bank' || a.type === 'ewallet' || a.type === 'savings');
  const cashAccounts = accounts.filter(a => a.type === 'cash');
  const securitiesCashAccounts = accounts.filter(a => a.type === 'securities' || a.type === 'crypto');

  const bankTotal = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const cashTotal = cashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const securitiesCashTotal = securitiesCashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  const financialHoldings = holdings.filter(h => ['fund', 'stock', 'crypto'].includes(h.assetClass));
  const goldHoldings = holdings.filter(h => h.assetClass === 'gold');
  const silverHoldings = holdings.filter(h => h.assetClass === 'silver');
  const landHoldings = holdings.filter(h => h.assetClass === 'land');

  const financialHoldingsTotal = financialHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const financialTotal = financialHoldingsTotal + securitiesCashTotal;
  const goldTotal = goldHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const silverTotal = silverHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const landTotal = landHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);

  const totalCalculatedNetWorth = bankTotal + cashTotal + financialTotal + goldTotal + silverTotal + landTotal;

  // ============================================================================
  // TÍNH ĐIỂM DỮ LIỆU THẬT CHO SPARKLINE
  // ============================================================================
  const sparklinePoints: number[] = (() => {
    if (periodTransactions.length === 0) {
      return [0, 0, 0, 0, 0, 0, 0];
    }
    // Lấy 7 mốc biến động số dư theo thời gian của kỳ
    const sorted = [...periodTransactions].sort((a, b) => {
      const ta = new Date(a.occurredAtIso || a.occurredAt).getTime();
      const tb = new Date(b.occurredAtIso || b.occurredAt).getTime();
      return ta - tb;
    });

    let runningBal = 0;
    const pts = sorted.map(t => {
      if (t.type === 'income') runningBal += t.amount;
      else if (t.type === 'expense') runningBal -= t.amount;
      return runningBal;
    });

    return pts.length >= 2 ? pts : [0, runningBal];
  })();

  // ============================================================================
  // 2. SO SÁNH NGUỒN THU THỰC TẾ VS DỰ KIẾN (THEO THÁNG / QUÝ / NĂM)
  // ============================================================================
  const baseMonthlyExpectedIncome = incomeSources.reduce(
    (sum, s) => sum + normalizeToMonthlyAmount(s.expectedAmount, s.recurrence),
    0
  );
  const selectedPeriodStartMonth = periodMode === 'year' ? 1 : periodMode === 'quarter' ? (selectedQuarter - 1) * 3 + 1 : selectedMonth;
  const selectedPeriodMonthCount = periodMode === 'year' ? 12 : periodMode === 'quarter' ? 3 : 1;
  const isOneTime = (recurrence?: string) => /một lần|one[_ -]?time/i.test(recurrence || '');
  const plannedForPeriod = (amount: number | undefined, recurrence: string | undefined, date: string | null | undefined) => {
    if (!isOneTime(recurrence)) return normalizeToMonthlyAmount(amount, recurrence) * periodMultiplier;
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return 0;
    const [year, month] = date.slice(0, 10).split('-').map(Number);
    return year === selectedYear && month >= selectedPeriodStartMonth && month < selectedPeriodStartMonth + selectedPeriodMonthCount
      ? Math.round(amount || 0)
      : 0;
  };
  const isSelectedMonthCurrent = periodMode === 'month' && selectedYear === nowVN.getFullYear() && selectedMonth === nowVN.getMonth() + 1;
  const localPlannedIncomeForPeriod = incomeSources.reduce(
    (sum, source) => sum + plannedForPeriod(source.expectedAmount, source.recurrence, source.oneTimeDate),
    0
  );
  const plannedIncomeResolution = resolvePlannedValue(
    serverSummary?.totals.plannedIncome,
    summaryRequestState,
    localPlannedIncomeForPeriod,
    isSelectedMonthCurrent
  );
  const expectedIncomeForPeriod = plannedIncomeResolution.amount;

  const actualIncomeTxns = periodTransactions.filter(t => t.type === 'income');
  // V2-12, V2-14: Tính tổng thu trực tiếp từ các giao dịch đã duyệt, không lấy Math.max giả
  const actualIncomeForPeriod = serverSummary?.totals.actualIncome ?? actualIncomeTxns.reduce((sum, t) => sum + t.amount, 0);

  const incomeAchievedPct = expectedIncomeForPeriod !== null && expectedIncomeForPeriod > 0
    ? Math.round((actualIncomeForPeriod / expectedIncomeForPeriod) * 100)
    : 0;

  // V2-12: Phân loại nguồn thu duy nhất theo incomeSourceId, tuyệt đối KHÔNG dò tên theo includes để cộng trùng!
  const incomeSourceComparison = incomeSources.map(src => {
    const monthlyExpected = normalizeToMonthlyAmount(src.expectedAmount, src.recurrence);
    const expected = plannedIncomeResolution.source === 'none'
      ? null
      : plannedForPeriod(src.expectedAmount, src.recurrence, src.oneTimeDate);
    // Khớp duy nhất theo ID nguồn thu
    const matchedActual = serverSummary?.incomeBuckets.find(b => b.id === src.id)?.actualReceived ?? actualIncomeTxns
      .filter(t => t.incomeSourceId === src.id)
      .reduce((s, t) => s + t.amount, 0);
    const pct = expected !== null && expected > 0 ? Math.round((matchedActual / expected) * 100) : 0;
    return {
      ...src,
      monthlyExpected,
      expected,
      actual: matchedActual,
      pct
    };
  });

  const matchedActualTotal = incomeSourceComparison.reduce((s, i) => s + i.actual, 0);
  // Khoản thu ngoài dự kiến là toàn bộ các khoản confirmed income chưa được gán source ID
  const unmatchedActual = actualIncomeTxns
    .filter(t => !t.incomeSourceId || !incomeSources.some(s => s.id === t.incomeSourceId))
    .reduce((s, t) => s + t.amount, 0);

  // 3. SO SÁNH CÁC HŨ THỰC TẾ VS DỰ KIẾN (THEO THÁNG / QUÝ / NĂM) - V2-13
  const actualExpenseTxns = periodTransactions.filter(t => t.type === 'expense');
  const actualExpenseForPeriod = serverSummary?.totals.actualExpense ?? actualExpenseTxns.reduce((s, t) => s + t.amount, 0);

  const jarActualAmounts = jars.map(jar => {
    return serverSummary?.jarBuckets.find(b => b.id === jar.id)?.actualSpent ?? actualExpenseTxns
      .filter(t => (t.jarId ? t.jarId === jar.id : t.suggestedJarCode === jar.code))
      .reduce((s, t) => s + t.amount, 0);
  });

  const unassignedExpenses = serverSummary ? serverSummary.unassigned.expense + serverSummary.orphaned.expense : actualExpenseTxns
    .filter(t => !t.jarId && (!t.suggestedJarCode || !jars.some(j => j.code === t.suggestedJarCode)))
    .reduce((s, t) => s + t.amount, 0);

  const totalActualSpentForPeriod = actualExpenseForPeriod;

  // Tỷ trọng % thực tế của từng hũ (tổng = 100%)
  const actualJarSharePercents = computeExact100Percentages(jarActualAmounts);
  // Tỷ trọng % dự kiến của từng hũ (tổng = 100%)
  const plannedJarSharePercents = computeExact100Percentages(
    jars.map(j => Math.round((j.targetPercent || 0) * 100))
  );

  // Hạn mức dự kiến của từng hũ trong kỳ
  const jarExpectedLimits = jars.map(jar => {
    const baseLimit = jar.monthlyLimit > 0
      ? jar.monthlyLimit
      : Math.round(baseMonthlyExpectedIncome * (jar.targetPercent || 0));
    return baseLimit * periodMultiplier;
  });

  const totalExpectedJarLimitForPeriod = jarExpectedLimits.reduce((s, l) => s + l, 0);
  const totalJarUsagePct = totalExpectedJarLimitForPeriod > 0
    ? Math.round((totalActualSpentForPeriod / totalExpectedJarLimitForPeriod) * 100)
    : 0;

  const localPlannedExpensesForPeriod = plannedExpenses.reduce(
    (sum, expense) => sum + plannedForPeriod(expense.expectedAmount, expense.recurrence, expense.oneTimeDate),
    0
  );
  const plannedExpenseResolution = resolvePlannedValue(
    serverSummary?.totals.plannedExpense,
    summaryRequestState,
    localPlannedExpensesForPeriod,
    isSelectedMonthCurrent
  );
  const totalPlannedExpensesForPeriod = plannedExpenseResolution.amount;

  const handleSyncPricesClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = await onSyncMarketPrices();
    if (updated) {
      setSyncDone(true);
      setTimeout(() => setSyncDone(false), 3000);
    }
  };

  const handleSaveQuickAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAccId) {
      await onUpdateAccountBalance(editingAccId, editingBalance);
      setEditingAccId('');
      setEditingBalance(0);
    }
  };

  const handleCreateQuickCashOrBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCashName.trim()) return;
    onAddAccount({
      id: `acc_${Date.now()}`,
      name: newCashName.trim(),
      type: newCashType,
      balance: newCashBalance
    });
    setNewCashName('');
    setNewCashBalance(0);
  };

  return (
    <div className="space-y-3.5 pb-24 px-4 select-none">
      {/* Pending Banner if any */}
      {pendingCount > 0 && (
        <div
          onClick={onOpenInbox}
          className="bg-gradient-to-r from-[#273336] to-[#182022] border border-[#8BA5AA]/25 rounded-2xl p-3 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform shadow-md"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#8CC7AE] animate-ping"></span>
            <span className="text-xs font-semibold text-[#F2F5F5]">
              {pendingCount} giao dịch thực tế mới chờ anh duyệt
            </span>
          </div>
          <span className="text-xs font-bold text-[#8CC7AE]">Duyệt ngay ›</span>
        </div>
      )}

      {/* BỘ CHỌN KỲ THỐNG KÊ & SO SÁNH: THÁNG / QUÝ / NĂM */}
      <div className="bg-[#1C2426]/90 border border-[#8BA5AA]/18 rounded-2xl p-2 flex items-center justify-between gap-2">
        <div className="flex gap-1 bg-[#141A1C] p-1 rounded-xl">
          {([
            { id: 'month', label: 'Tháng' },
            { id: 'quarter', label: 'Quý' },
            { id: 'year', label: 'Năm' }
          ] as Array<{ id: PeriodMode; label: string }>).map(tab => (
            <button
              key={tab.id}
              onClick={() => setPeriodMode(tab.id)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                periodMode === tab.id
                  ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                  : 'text-[#869699] hover:text-[#D5E1E3]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handlePrevPeriod}
            className="w-7 h-7 rounded-lg bg-[#232D30] text-[#D5E1E3] flex items-center justify-center active:scale-90"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-bold text-[#F2F5F5] min-w-[92px] text-center num">
            {periodLabel}
          </span>
          <button
            onClick={handleNextPeriod}
            className="w-7 h-7 rounded-lg bg-[#232D30] text-[#D5E1E3] flex items-center justify-center active:scale-90"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* ==========================================================================
          PHẦN 1: TÀI SẢN RÒNG & THỐNG KÊ TÀI SẢN THỰC TẾ HIỆN CÓ (6 NHÓM)
         ========================================================================== */}
      <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-5 shadow-[0_16px_36px_rgba(0,0,0,0.35)] space-y-3.5">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block">
              Tổng Tài Sản Thực Tế Hiện Có
            </span>
            <div className="num text-[28px] font-bold text-[#F2F5F5] tracking-tight mt-0.5">
              {privacyMode ? '••••••••••' : formatVND(totalCalculatedNetWorth)}
            </div>
          </div>

          <button
            onClick={handleSyncPricesClick}
            disabled={isSyncingPrices}
            className="px-2.5 py-1.5 rounded-xl bg-[#20292B] hover:bg-[#2A3639] border border-[#8CC7AE]/30 text-[#8CC7AE] text-[10.5px] font-semibold flex items-center gap-1 active:scale-95"
            title="Cập nhật giá Fmarket, Vàng, Bạc, Crypto theo ngày"
          >
            {syncDone ? (
              <>
                <Check size={12} /> Đã cập nhật
              </>
            ) : (
              <>
                <RefreshCw size={12} className={isSyncingPrices ? 'animate-spin' : ''} />
                {isSyncingPrices ? 'Đang lấy...' : 'Giá Fmarket'}
              </>
            )}
          </button>
        </div>

        {/* U-01: Thanh phân bổ tỷ trọng 6 lớp tài sản trực quan (V2-24: Tỷ lệ thực tế) */}
        {totalCalculatedNetWorth > 0 && !privacyMode && (
          <div className="space-y-1.5">
            <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-[#121819]">
              {[
                { label: 'NH', val: bankTotal, color: '#657D81' },
                { label: 'Tiền mặt', val: cashTotal, color: '#8CC7AE' },
                { label: 'TS TC', val: financialTotal, color: '#4EA8DE' },
                { label: 'Vàng', val: goldTotal, color: '#DEB48A' },
                { label: 'Bạc', val: silverTotal, color: '#C4D0D2' },
                { label: 'Đất', val: landTotal, color: '#E07A5F' }
              ]
                .filter(seg => seg.val > 0)
                .map(seg => (
                  <div
                    key={seg.label}
                    title={`${seg.label}: ${Math.round((seg.val / totalCalculatedNetWorth) * 100)}%`}
                    style={{
                      width: `${(seg.val / totalCalculatedNetWorth) * 100}%`,
                      backgroundColor: seg.color
                    }}
                    className="h-full transition-all duration-300"
                  />
                ))}
            </div>
          </div>
        )}

        {/* Bảng chi tiết 6 nhóm Tài sản thực tế */}
        <div className="pt-2 border-t border-[#8BA5AA]/15 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10.5px] font-bold text-[#869699] uppercase tracking-wider">
              Chi tiết 6 lớp tài sản thực tế
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowQuickCashModal(true)}
                className="text-[10.5px] text-[#8CC7AE] font-semibold flex items-center gap-1 hover:underline"
              >
                <Edit3 size={11} /> Sửa số dư TK/Tiền mặt
              </button>
              <span className="text-[#869699]">·</span>
              <button
                onClick={onOpenInvestments}
                className="text-[10.5px] text-[#D5E1E3] font-semibold hover:underline"
              >
                Đầu tư ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* 1. Tài khoản ngân hàng / Ví */}
            <div
              onClick={() => setShowQuickCashModal(true)}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <Landmark size={12} className="text-[#657D81]" /> Ngân hàng & Ví
                </span>
                <span>{bankAccounts.length} TK</span>
              </div>
              <div className="num text-[14px] font-bold text-[#F2F5F5] mt-1">
                {privacyMode ? '••••••' : formatVND(bankTotal)}
              </div>
            </div>

            {/* 2. Tiền mặt */}
            <div
              onClick={() => setShowQuickCashModal(true)}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <Wallet size={12} className="text-[#8CC7AE]" /> Tiền mặt
                </span>
                <span>{cashAccounts.length} ví</span>
              </div>
              <div className="num text-[14px] font-bold text-[#F2F5F5] mt-1">
                {privacyMode ? '••••••' : formatVND(cashTotal)}
              </div>
            </div>

            {/* 3. Tài sản tài chính (Fmarket, CP, Crypto + tiền trong TK CK) */}
            <div
              onClick={onOpenInvestments}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <TrendingUp size={12} className="text-[#8CC7AE]" /> TS Tài chính (Fmarket)
                </span>
                <span>{financialHoldings.length} mã</span>
              </div>
              <div className="num text-[14px] font-bold text-[#8CC7AE] mt-1">
                {privacyMode ? '••••••' : formatVND(financialTotal)}
              </div>
            </div>

            {/* 4. Vàng */}
            <div
              onClick={onOpenInvestments}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <Coins size={12} className="text-[#DEB48A]" /> Vàng tích trữ
                </span>
                <span>
                  {goldHoldings.reduce((s, h) => s + h.quantity, 0)}{' '}
                  {goldHoldings[0]?.unit || 'chỉ'}
                </span>
              </div>
              <div className="num text-[14px] font-bold text-[#DEB48A] mt-1">
                {privacyMode ? '••••••' : formatVND(goldTotal)}
              </div>
            </div>

            {/* 5. Bạc */}
            <div
              onClick={onOpenInvestments}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <Coins size={12} className="text-[#C4D0D2]" /> Bạc tích trữ
                </span>
                <span>
                  {silverHoldings.reduce((s, h) => s + h.quantity, 0)}{' '}
                  {silverHoldings[0]?.unit || 'lượng'}
                </span>
              </div>
              <div className="num text-[14px] font-bold text-[#D5E1E3] mt-1">
                {privacyMode ? '••••••' : formatVND(silverTotal)}
              </div>
            </div>

            {/* 6. Đất / Bất động sản */}
            <div
              onClick={onOpenInvestments}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <MapPin size={12} className="text-[#E07A5F]" /> Đất / BĐS
                </span>
                <span>{landHoldings.length} tài sản</span>
              </div>
              <div className="num text-[14px] font-bold text-[#E07A5F] mt-1">
                {privacyMode ? '••••••' : formatVND(landTotal)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ==========================================================================
          DÒNG TIỀN THU - CHI TRONG KỲ (V2-21, V2-24: Đặt Sparkline đúng khối)
         ========================================================================== */}
      <div className="bg-[#1C2426]/85 backdrop-blur-md border border-[#8BA5AA]/15 rounded-3xl p-4.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider flex items-center gap-1">
              <Scale size={13} className="text-[#95B0B4]" />
              Dòng tiền Thu – Chi · {periodLabel}
            </span>
            <div className="text-[11px] text-[#869699] mt-0.5">
              Chênh lệch ròng tích lũy từ các giao dịch đã duyệt
            </div>
          </div>
          <span className={`px-2.5 py-1 rounded-full text-xs font-bold num border ${
            actualIncomeForPeriod - actualExpenseForPeriod >= 0
              ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/35'
              : 'bg-[#E07A5F]/15 text-[#E07A5F] border-[#E07A5F]/35'
          }`}>
            {actualIncomeForPeriod - actualExpenseForPeriod >= 0 ? 'Dư +' : 'Thâm hụt −'}
            {privacyMode ? '••••••' : formatVND(Math.abs(actualIncomeForPeriod - actualExpenseForPeriod))}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 bg-[#141A1C]/90 rounded-2xl p-3 border border-[#8BA5AA]/10 text-center">
          <div>
            <span className="text-[10px] text-[#869699] block">Tổng Thu</span>
            <span className="num text-[14px] font-bold text-[#8CC7AE] mt-0.5 block">
              {privacyMode ? '••••••' : `+${formatVND(actualIncomeForPeriod)}`}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-[#869699] block">Tổng Chi</span>
            <span className="num text-[14px] font-bold text-[#DEB48A] mt-0.5 block">
              {privacyMode ? '••••••' : `-${formatVND(actualExpenseForPeriod)}`}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-[#869699] block">Dư Ròng</span>
            <span className={`num text-[14px] font-bold mt-0.5 block ${
              actualIncomeForPeriod - actualExpenseForPeriod >= 0 ? 'text-[#8CC7AE]' : 'text-[#E07A5F]'
            }`}>
              {privacyMode ? '••••••' : `${actualIncomeForPeriod - actualExpenseForPeriod >= 0 ? '+' : ''}${formatVND(actualIncomeForPeriod - actualExpenseForPeriod)}`}
            </span>
          </div>
        </div>

        {/* Dynamic Sparkline với nhãn rõ ràng */}
        <div className="pt-1">
          <div className="flex items-center justify-between text-[10.5px] text-[#869699] mb-1">
            <span>Dòng tiền ròng tích lũy trong kỳ</span>
            <span className="num text-[#D5E1E3]">{periodTransactions.length} giao dịch</span>
          </div>
          <Sparkline points={sparklinePoints} />
        </div>
      </div>

      {/* ==========================================================================
          PHẦN 2: SO SÁNH NGUỒN THU THỰC TẾ VS DỰ KIẾN ({periodLabel})
         ========================================================================== */}
      <div className="bg-[#1C2426]/85 backdrop-blur-md border border-[#8BA5AA]/15 rounded-3xl p-4.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider flex items-center gap-1">
              <ArrowUpRight size={13} className="text-[#8CC7AE]" />
              So sánh Nguồn Thu · {periodLabel}
            </span>
            <div className="text-[11px] text-[#869699] mt-0.5">
              Thực tế từ giao dịch đã duyệt so với kế hoạch dự kiến
            </div>
          </div>
          <span
            className={`px-2.5 py-1 rounded-full text-xs font-bold num border ${
              expectedIncomeForPeriod === null
                ? 'bg-[#232E31] text-[#869699] border-[#8BA5AA]/20'
                : incomeAchievedPct >= 100
                ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/35'
                : incomeAchievedPct >= 50
                ? 'bg-[#657D81]/25 text-[#D5E1E3] border-[#8BA5AA]/30'
                : 'bg-[#D4A373]/15 text-[#DEB48B] border-[#D4A373]/30'
            }`}
          >
            {expectedIncomeForPeriod === null ? 'Chưa có kế hoạch kỳ này' : `Đạt ${incomeAchievedPct}% dự kiến`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2.5 bg-[#141A1C]/90 rounded-2xl p-3 border border-[#8BA5AA]/10">
          <div>
            <span className="text-[10.5px] text-[#869699] block">Thu Thực Tế ({periodLabel})</span>
            <span className="num text-[17px] font-bold text-[#8CC7AE] mt-0.5 block">
              {privacyMode ? '••••••' : `+${formatVND(actualIncomeForPeriod)}`}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10.5px] text-[#869699] block">Thu Dự Kiến ({periodLabel})</span>
            <span className="num text-[17px] font-bold text-[#F2F5F5] mt-0.5 block">
              {expectedIncomeForPeriod === null
                ? 'Chưa có kế hoạch kỳ này'
                : privacyMode ? '••••••' : formatVND(expectedIncomeForPeriod)}
            </span>
            {plannedIncomeResolution.source === 'local-unsynced' && (
              <span className="text-[9.5px] text-[#DEB48A] mt-0.5 block">Ước tính từ kế hoạch trên thiết bị · chưa đồng bộ</span>
            )}
          </div>
        </div>

        {/* Thanh tiến độ đạt thu nhập dự kiến */}
        {expectedIncomeForPeriod !== null ? <div className="space-y-1">
          <div className="h-2 rounded-full bg-[#141A1C] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#657D81] to-[#8CC7AE] transition-all duration-500"
              style={{ width: `${Math.min(100, incomeAchievedPct)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10.5px] text-[#869699] num">
            <span>
              Chênh lệch:{' '}
              <b className={actualIncomeForPeriod - expectedIncomeForPeriod >= 0 ? 'text-[#8CC7AE]' : 'text-[#DEB48A]'}>
                {actualIncomeForPeriod - expectedIncomeForPeriod >= 0 ? '+' : ''}
                {formatVND(actualIncomeForPeriod - expectedIncomeForPeriod)}
              </b>
            </span>
            <button onClick={onOpenBudget} className="text-[#8CC7AE] hover:underline font-semibold flex items-center gap-0.5">
              <Plus size={11} /> Thêm / Sửa khoản thu ›
            </button>
          </div>
        </div> : <p className="text-[11px] text-[#869699]">Chưa có kế hoạch kỳ này nên chưa tính phần trăm đạt thu.</p>}

        {/* Chi tiết từng nguồn thu dự kiến */}
        <div className="pt-2 border-t border-[#8BA5AA]/12 space-y-2">
          {incomeSourceComparison.map(item => (
            <div
              key={item.id}
              onClick={() => {
                const src = incomeSources.find(s => s.id === item.id);
                if (src) {
                  setSelectedIncomeSourceForDetail(src);
                  setIsUnassignedIncomeDetail(false);
                }
              }}
              className="space-y-1 p-2 rounded-xl hover:bg-[#20292B]/60 transition-colors cursor-pointer active:scale-98"
              title="Chạm để xem các giao dịch thu đã duyệt"
            >
              <div className="flex items-center justify-between text-[11.5px]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[#D5E1E3] font-medium truncate max-w-[130px]">{item.name}</span>
                  <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#141A1C] text-[#8CC7AE] border border-[#8CC7AE]/20 shrink-0">
                    {item.recurrence}
                  </span>
                </div>
                <div className="num text-right shrink-0">
                  <b className="text-[#8CC7AE]">+{formatVND(item.actual)}</b>
                  {item.expected !== null && item.expected > 0 && <span className="text-[#869699]"> / {formatVND(item.expected)}</span>}{' '}
                  {item.expected !== null && item.expected > 0 && (
                    <span className={`font-bold ml-1 ${item.pct >= 100 ? 'text-[#8CC7AE]' : 'text-[#DEB48A]'}`}>
                      ({item.pct}%)
                    </span>
                  )}
                </div>
              </div>
              {item.expected !== null && item.expected > 0 && (
                <div className="h-1 rounded-full bg-[#141A1C] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#8CC7AE]"
                    style={{ width: `${Math.min(100, item.pct)}%` }}
                  />
                </div>
              )}
            </div>
          ))}

          {/* Khoản thu ngoài dự kiến / khác nếu có */}
          {unmatchedActual > 0 && (
            <div
              onClick={() => {
                setSelectedIncomeSourceForDetail(null);
                setIsUnassignedIncomeDetail(true);
              }}
              className="space-y-1 p-2 rounded-xl hover:bg-[#20292B]/60 transition-colors cursor-pointer active:scale-98 border-t border-dashed border-[#8BA5AA]/15"
              title="Chạm để xem các khoản thu ngoài dự kiến đã duyệt"
            >
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-[#8CC7AE] font-medium">✨ Thu ngoài dự kiến / Khác</span>
                <b className="num text-[#8CC7AE]">+{formatVND(unmatchedActual)}</b>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ==========================================================================
          PHẦN 3: SO SÁNH CÁC HŨ THỰC TẾ VS CÁC HŨ DỰ KIẾN ({periodLabel})
         ========================================================================== */}
      <div className="bg-[#1C2426]/85 backdrop-blur-md border border-[#8BA5AA]/15 rounded-3xl p-4.5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider flex items-center gap-1">
              <Scale size={13} className="text-[#DEB48A]" />
              So sánh Các Hũ: Thực Tế vs Dự Kiến · {periodLabel}
            </span>
            <div className="text-[11px] text-[#869699] mt-0.5">
              Tổng % thực tế: <b className="text-[#8CC7AE]">{totalActualSpentForPeriod > 0 ? '100%' : '0%'}</b> · Tổng % dự kiến: <b className="text-[#D5E1E3]">100%</b>
            </div>
          </div>
          <button
            onClick={onOpenBudget}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[#232E31] text-[#8CC7AE] border border-[#8CC7AE]/25"
          >
            Đã chi {totalJarUsagePct}% ›
          </button>
        </div>

        {/* Tổng chi thực tế vs Tổng hạn mức hũ dự kiến */}
        <div className="grid grid-cols-2 gap-2.5 bg-[#141A1C]/90 rounded-2xl p-3 border border-[#8BA5AA]/10">
          <div>
            <span className="text-[10.5px] text-[#869699] block">Tổng Chi Thực Tế ({periodLabel})</span>
            <span className="num text-[17px] font-bold text-[#DEB48A] mt-0.5 block">
              {privacyMode ? '••••••' : formatVND(totalActualSpentForPeriod)}
            </span>
          </div>
          <div className="text-right">
            <span className="text-[10.5px] text-[#869699] block">Hạn Mức Hũ Dự Kiến ({periodLabel})</span>
            <span className="num text-[17px] font-bold text-[#F2F5F5] mt-0.5 block">
              {privacyMode ? '••••••' : formatVND(totalExpectedJarLimitForPeriod)}
            </span>
          </div>
        </div>

        {totalPlannedExpensesForPeriod === null ? (
          <div className="text-[11px] text-[#869699] px-1">Chưa có kế hoạch kỳ này.</div>
        ) : totalPlannedExpensesForPeriod > 0 && (
          <div className="text-[11px] text-[#869699] flex items-center justify-between px-1">
            <span>Khoản chi cố định dự kiến ({periodLabel}):</span>
            <b className="num text-[#D5E1E3]">
              {formatVND(totalPlannedExpensesForPeriod)} (Đạt{' '}
              {Math.round((totalActualSpentForPeriod / totalPlannedExpensesForPeriod) * 100)}%)
            </b>
            {plannedExpenseResolution.source === 'local-unsynced' && <span className="text-[#DEB48A]">Ước tính trên thiết bị · chưa đồng bộ</span>}
          </div>
        )}

        {/* Danh sách so sánh chi tiết từng Hũ */}
        <div className="space-y-2.5 pt-1">
          {jars.map((jar, idx) => {
            const actualAmt = jarActualAmounts[idx] || 0;
            const expectedAmt = jarExpectedLimits[idx] || 0;
            const achievedVsExpectedPct = expectedAmt > 0
              ? Math.round((actualAmt / expectedAmt) * 100)
              : 0;
            const actualSharePct = actualJarSharePercents[idx] || 0;
            const plannedSharePct = plannedJarSharePercents[idx] || Math.round((jar.targetPercent || 0) * 100);
            const isOver = achievedVsExpectedPct > 100;

            return (
              <div
                key={jar.id}
                onClick={() => setSelectedJarForDetail(jar)}
                className={`bg-[#141A1C]/85 border rounded-2xl p-3 space-y-2 cursor-pointer active:scale-98 transition-transform hover:border-[#8BA5AA]/30 ${
                  isOver ? 'border-[#E07A5F]/40' : 'border-[#8BA5AA]/12'
                }`}
                title="Bấm để xem các khoản thu chi đã ghi nhận"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: jar.color || '#657D81' }}
                    />
                    <span className="text-xs font-bold text-[#F2F5F5]">{jar.name}</span>
                  </div>
                  <span
                    className={`num text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      isOver
                        ? 'bg-[#E07A5F]/15 text-[#E07A5F] border border-[#E07A5F]/30'
                        : 'bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/25'
                    }`}
                  >
                    Đạt {achievedVsExpectedPct}% dự kiến
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] num">
                  <span className="text-[#869699]">
                    Thực tế: <b className="text-[#F2F5F5]">{privacyMode ? '••••' : formatVND(actualAmt)}</b>
                    {' / '}
                    Dự kiến: <b className="text-[#C4D0D2]">{privacyMode ? '••••' : formatVND(expectedAmt)}</b>
                  </span>
                </div>

                {/* So sánh Tỷ trọng % Thực tế (tổng 100%) vs % Dự kiến (tổng 100%) */}
                <div className="flex items-center justify-between text-[10.5px] num bg-[#1C2426] rounded-xl px-2.5 py-1.5">
                  <span className="text-[#8CC7AE] font-semibold">
                    Tỷ trọng Thực tế: {actualSharePct}%
                  </span>
                  <span className="text-[#869699]">vs</span>
                  <span className="text-[#D5E1E3] font-semibold">
                    Tỷ trọng Dự kiến: {plannedSharePct}%
                  </span>
                </div>

                {/* Progress bar thực tế so với hạn mức dự kiến */}
                <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.min(100, achievedVsExpectedPct)}%`,
                      backgroundColor: isOver ? '#E07A5F' : (jar.color || '#8CC7AE')
                    }}
                  />
                </div>
              </div>
            );
          })}

          {/* Khoản chi chưa phân loại / chưa gắn hũ (V2-13) */}
          {unassignedExpenses > 0 && (
            <div className="bg-[#141A1C]/85 border border-dashed border-[#8BA5AA]/20 rounded-2xl p-3 space-y-1">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-[#DEB48A]">✨ Chi chưa phân loại / Khác</span>
                <span className="num text-[#DEB48A]">{privacyMode ? '••••••' : formatVND(unassignedExpenses)}</span>
              </div>
              <div className="text-[10.5px] text-[#869699]">
                Khoản chi chưa gắn vào 6 hũ, chiếm {totalActualSpentForPeriod > 0 ? Math.round((unassignedExpenses / totalActualSpentForPeriod) * 100) : 0}% tổng chi
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL CẬP NHẬT NHANH SỐ DƯ TÀI KHOẢN NGÂN HÀNG & TIỀN MẶT */}
      {showQuickCashModal && (
        <div {...quickCashDialogProps} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">
                Cập nhật Tài khoản Ngân hàng & Tiền mặt
              </span>
              <button
                onClick={() => setShowQuickCashModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {accounts.map(acc => {
                const isCopied = copiedAccId === acc.id;
                const bank = findBankByCode(acc.bankCode);
                const displayNum = acc.accountNumber || (acc.accountNumberMask ? `*${acc.accountNumberMask}` : '');

                return (
                  <div
                    key={acc.id}
                    className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-[#F2F5F5] truncate flex items-center gap-1.5">
                          <span>{acc.name}</span>
                          {bank && (
                            <span className="text-[10px] font-mono px-1 rounded bg-[#0E1314] text-[#869699]">
                              {bank.shortName}
                            </span>
                          )}
                        </div>
                        <div className="text-[10.5px] text-[#869699] flex items-center gap-1 mt-0.5">
                          <span>{acc.type === 'cash' ? '💵 Tiền mặt' : '🏦 Ngân hàng / Ví'}</span>
                          {displayNum && (
                            <>
                              <span>·</span>
                              <span className="font-mono text-[#D5E1E3] font-semibold">{displayNum}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {editingAccId === acc.id ? (
                        <form onSubmit={handleSaveQuickAccount} className="flex items-center gap-1.5">
                          <div className="w-28">
                            <CurrencyInput
                              value={editingBalance}
                              onChange={setEditingBalance}
                              autoFocus
                              showQuickChips={false}
                              className="py-1.5 text-xs text-right"
                            />
                          </div>
                          <button
                            type="submit"
                            className="px-2.5 py-1.5 rounded-lg bg-[#8CC7AE] text-[#0E1314] text-xs font-bold"
                          >
                            Lưu
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="num text-xs font-bold text-[#8CC7AE]">
                            {formatVND(acc.balance)}
                          </span>
                          <button
                            onClick={() => {
                              setEditingAccId(acc.id);
                              setEditingBalance(acc.balance);
                            }}
                            className="px-2 py-1 rounded-lg bg-[#232D30] text-[11px] text-[#D5E1E3] hover:bg-[#2C3B3F]"
                          >
                            Sửa
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Hàng nút Copy & Mã QR nếu là tài khoản ngân hàng */}
                    {acc.type !== 'cash' && (
                      <div className="flex items-center justify-between pt-1 border-t border-[#8BA5AA]/10 text-xs">
                        <span className="text-[10.5px] text-[#869699] truncate">
                          {acc.accountHolder ? `👤 ${acc.accountHolder}` : 'Chuyển khoản nhanh'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const lines = [
                                `🏦 Ngân hàng: ${bank?.shortName || acc.bankCode || 'Ngân hàng'}`,
                                displayNum ? `💳 Số TK: ${displayNum}` : '',
                                acc.accountHolder ? `👤 Chủ TK: ${acc.accountHolder.toUpperCase()}` : '',
                                acc.branch ? `📍 Chi nhánh: ${acc.branch}` : ''
                              ].filter(Boolean);
                              navigator.clipboard.writeText(lines.join('\n'));
                              setCopiedAccId(acc.id);
                              setTimeout(() => setCopiedAccId(null), 2500);
                            }}
                            className="px-2 py-0.5 rounded-lg bg-[#232D30] hover:bg-[#2C3B3F] text-[10.5px] text-[#D5E1E3] flex items-center gap-1"
                          >
                            {isCopied ? <Check size={11} className="text-[#8CC7AE]" /> : <Copy size={11} />}
                            {isCopied ? 'Đã chép' : 'Chép STK'}
                          </button>

                          <button
                            type="button"
                            onClick={() => setQrModalAccount(acc)}
                            className="px-2 py-0.5 rounded-lg bg-[#8CC7AE]/15 hover:bg-[#8CC7AE]/25 text-[10.5px] font-bold text-[#8CC7AE] border border-[#8CC7AE]/30 flex items-center gap-1"
                          >
                            <QrCode size={11} /> Mã QR
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Thêm nhanh ví tiền mặt hoặc tài khoản ngân hàng */}
            <form onSubmit={handleCreateQuickCashOrBank} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">
                Thêm Ví Tiền Mặt hoặc Tài Khoản Ngân Hàng
              </span>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newCashType}
                  onChange={(e) => setNewCashType(e.target.value as any)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2.5 py-2 text-xs text-[#F2F5F5]"
                >
                  <option value="cash">💵 Ví Tiền mặt</option>
                  <option value="bank">🏦 TK Ngân hàng</option>
                  <option value="savings">💰 Sổ Tiết kiệm</option>
                </select>
                <input
                  type="text"
                  placeholder="Tên (VD: Tiền mặt két sắt...)"
                  value={newCashName}
                  onChange={(e) => setNewCashName(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                />
              </div>
              <div>
                <label className="text-[10px] text-[#869699] uppercase block mb-1">Số dư ban đầu</label>
                <CurrencyInput
                  value={newCashBalance}
                  onChange={setNewCashBalance}
                  className="text-sm font-bold"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow active:scale-98"
              >
                + Thêm vào tài sản thực tế
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Modal chi tiết các khoản thu chi của hũ (V2-15: Kế thừa chuẩn xác từ Dashboard) */}
      <JarDetailModal
        isOpen={Boolean(selectedJarForDetail)}
        onClose={() => setSelectedJarForDetail(null)}
        jar={selectedJarForDetail}
        transactions={confirmedTransactions}
        privacyMode={privacyMode}
        periodLabel={periodLabel}
        periodMode={periodMode}
        periodYear={selectedYear}
        periodMonth={selectedMonth}
        periodQuarter={selectedQuarter}
        onEditJar={() => {
          setSelectedJarForDetail(null);
          onOpenBudget();
        }}
      />

      {/* Modal xem chi tiết & thống kê các giao dịch đã duyệt của Nguồn thu */}
      <IncomeSourceDetailModal
        isOpen={Boolean(selectedIncomeSourceForDetail) || isUnassignedIncomeDetail}
        onClose={() => {
          setSelectedIncomeSourceForDetail(null);
          setIsUnassignedIncomeDetail(false);
        }}
        incomeSource={selectedIncomeSourceForDetail}
        isUnassigned={isUnassignedIncomeDetail}
        transactions={confirmedTransactions}
        privacyMode={privacyMode}
        periodLabel={periodLabel}
        periodMode={periodMode}
        periodYear={selectedYear}
        periodMonth={selectedMonth}
        periodQuarter={selectedQuarter}
        onEditSource={() => {
          setSelectedIncomeSourceForDetail(null);
          setIsUnassignedIncomeDetail(false);
          onOpenBudget();
        }}
        onQuickAddIncome={() => {
          setSelectedIncomeSourceForDetail(null);
          setIsUnassignedIncomeDetail(false);
          onOpenBudget();
        }}
      />

      {/* Modal hiển thị mã QR VietQR chuyển khoản nhanh */}
      <AccountQrModal
        isOpen={Boolean(qrModalAccount)}
        onClose={() => setQrModalAccount(null)}
        account={qrModalAccount}
      />
    </div>
  );
};
