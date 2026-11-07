import React, { useState } from 'react';
import { Sparkline } from '../components/Sparkline';
import { Jar, Holding, IncomeSource, PlannedExpense, Transaction, BankAccount, getMonthlyIncomeAmount } from '../types';
import { formatVND } from '../mockData';
import { computeExact100Percentages } from './BudgetView';
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
  Scale
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
  onSyncMarketPrices: () => Promise<void>;
  onUpdateAccountBalance: (accountId: string, newBalance: number, name?: string, type?: 'bank' | 'cash' | 'ewallet') => Promise<void>;
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
  const now = new Date();
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [selectedYear, setSelectedYear] = useState<number>(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1); // 1..12
  const [selectedQuarter, setSelectedQuarter] = useState<number>(Math.floor(now.getMonth() / 3) + 1); // 1..4

  // Modal chỉnh nhanh số dư Ngân hàng / Tiền mặt ngay tại Tổng quan
  const [showQuickCashModal, setShowQuickCashModal] = useState(false);
  const [editingAccId, setEditingAccId] = useState<string>('');
  const [editingBalanceStr, setEditingBalanceStr] = useState<string>('');
  const [newCashName, setNewCashName] = useState('');
  const [newCashType, setNewCashType] = useState<'bank' | 'cash'>('cash');
  const [newCashBalanceStr, setNewCashBalanceStr] = useState('');
  const [syncDone, setSyncDone] = useState(false);

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

  const isCurrentMonthPeriod =
    periodMode === 'month' &&
    selectedYear === now.getFullYear() &&
    selectedMonth === now.getMonth() + 1;

  // Lọc các giao dịch đã duyệt nằm trong kỳ được chọn
  const periodTransactions = confirmedTransactions.filter(t => {
    const rawDate = t.occurredAtIso ? new Date(t.occurredAtIso) : now;
    const d = isNaN(rawDate.getTime()) ? now : rawDate;
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const q = Math.floor((m - 1) / 3) + 1;

    if (periodMode === 'month') return y === selectedYear && m === selectedMonth;
    if (periodMode === 'quarter') return y === selectedYear && q === selectedQuarter;
    return y === selectedYear;
  });

  // ============================================================================
  // 1. THỐNG KÊ TÀI SẢN THỰC TẾ HIỆN CÓ (6 NHÓM TÀI SẢN)
  // ============================================================================
  const bankAccounts = accounts.filter(a => a.type === 'bank' || a.type === 'ewallet');
  const cashAccounts = accounts.filter(a => a.type === 'cash');

  const bankTotal = bankAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const cashTotal = cashAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

  const financialHoldings = holdings.filter(h => ['fund', 'stock', 'crypto'].includes(h.assetClass));
  const goldHoldings = holdings.filter(h => h.assetClass === 'gold');
  const silverHoldings = holdings.filter(h => h.assetClass === 'silver');
  const landHoldings = holdings.filter(h => h.assetClass === 'land');

  const financialTotal = financialHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const goldTotal = goldHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const silverTotal = silverHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);
  const landTotal = landHoldings.reduce((s, h) => s + h.quantity * h.currentPrice, 0);

  // ============================================================================
  // 2. SO SÁNH NGUỒN THU THỰC TẾ VS DỰ KIẾN (THEO THÁNG / QUÝ / NĂM)
  // ============================================================================
  const baseMonthlyExpectedIncome = incomeSources.reduce((sum, s) => sum + getMonthlyIncomeAmount(s.expectedAmount, s.recurrence), 0);
  const expectedIncomeForPeriod = baseMonthlyExpectedIncome * periodMultiplier;

  const actualIncomeTxns = periodTransactions.filter(t => t.type === 'income');
  const actualIncomeForPeriod = actualIncomeTxns.reduce((sum, t) => sum + t.amount, 0);

  const incomeAchievedPct = expectedIncomeForPeriod > 0
    ? Math.round((actualIncomeForPeriod / expectedIncomeForPeriod) * 100)
    : 0;

  // So sánh từng nguồn thu dự kiến với thực tế (quy đổi theo kỳ: tháng * 1, quý * 3, năm * 12)
  const incomeSourceComparison = incomeSources.map(src => {
    const monthlyExpected = getMonthlyIncomeAmount(src.expectedAmount, src.recurrence);
    const expected = monthlyExpected * periodMultiplier;
    const matchedActual = actualIncomeTxns
      .filter(t => {
        const cat = (t.suggestedCategory || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        const nameLower = src.name.toLowerCase();
        return cat === nameLower || cat.includes(nameLower) || desc.includes(nameLower);
      })
      .reduce((s, t) => s + t.amount, 0);
    const pct = expected > 0 ? Math.round((matchedActual / expected) * 100) : 0;
    return {
      ...src,
      monthlyExpected,
      expected,
      actual: matchedActual,
      pct
    };
  });

  // ============================================================================
  // 3. SO SÁNH CÁC HŨ THỰC TẾ VS DỰ KIẾN (THEO THÁNG / QUÝ / NĂM)
  // ============================================================================
  const actualExpenseTxns = periodTransactions.filter(t => t.type === 'expense');

  const jarActualAmounts = jars.map(jar => {
    const fromPeriodTxns = actualExpenseTxns
      .filter(t => t.suggestedJarCode === jar.code)
      .reduce((s, t) => s + t.amount, 0);
    if (isCurrentMonthPeriod) {
      return Math.max(jar.spentThisMonth || 0, fromPeriodTxns);
    }
    return fromPeriodTxns;
  });

  const totalActualSpentForPeriod = jarActualAmounts.reduce((s, a) => s + a, 0);

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

  const totalPlannedExpensesForPeriod =
    plannedExpenses.reduce((s, e) => s + e.expectedAmount, 0) * periodMultiplier;

  const handleSyncPricesClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await onSyncMarketPrices();
    setSyncDone(true);
    setTimeout(() => setSyncDone(false), 3000);
  };

  const handleSaveQuickAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (editingAccId) {
      const bal = parseInt(editingBalanceStr.replace(/[^\d]/g, ''), 10) || 0;
      await onUpdateAccountBalance(editingAccId, bal);
      setEditingAccId('');
      setEditingBalanceStr('');
    }
  };

  const handleCreateQuickCashOrBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCashName.trim()) return;
    const bal = parseInt(newCashBalanceStr.replace(/[^\d]/g, ''), 10) || 0;
    onAddAccount({
      id: `acc_${Date.now()}`,
      name: newCashName.trim(),
      type: newCashType,
      balance: bal
    });
    setNewCashName('');
    setNewCashBalanceStr('');
  };

  return (
    <div className="space-y-3.5 pb-24 px-4">
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
              {privacyMode ? '••••••••••' : new Intl.NumberFormat('vi-VN').format(Math.round(netWorth))}{' '}
              <span className="text-[18px] font-normal text-[#95B0B4]">₫</span>
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

        <Sparkline />

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
                className="text-[10.5px] text-[#DEB48A] font-semibold hover:underline"
              >
                Sửa Vàng/Bạc/Đất/Quỹ ›
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* 1. Tài khoản ngân hàng */}
            <div
              onClick={() => setShowQuickCashModal(true)}
              className="bg-[#161C1E]/80 border border-[#8BA5AA]/12 rounded-2xl p-2.5 cursor-pointer hover:border-[#8BA5AA]/30 transition-colors"
            >
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span className="flex items-center gap-1">
                  <Landmark size={12} className="text-[#95B0B4]" /> TK Ngân hàng
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

            {/* 3. Tài sản tài chính (Fmarket, CP, Crypto) */}
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
              incomeAchievedPct >= 100
                ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/35'
                : incomeAchievedPct >= 50
                ? 'bg-[#657D81]/25 text-[#D5E1E3] border-[#8BA5AA]/30'
                : 'bg-[#D4A373]/15 text-[#DEB48A] border-[#D4A373]/30'
            }`}
          >
            Đạt {incomeAchievedPct}% dự kiến
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
              {privacyMode ? '••••••' : formatVND(expectedIncomeForPeriod)}
            </span>
          </div>
        </div>

        {/* Thanh tiến độ đạt thu nhập dự kiến */}
        <div className="space-y-1">
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
            <button onClick={onOpenBudget} className="text-[#8CC7AE] hover:underline">
              Chỉnh thu dự kiến ›
            </button>
          </div>
        </div>

        {/* Chi tiết từng nguồn thu dự kiến */}
        {incomeSourceComparison.length > 0 && (
          <div className="pt-2 border-t border-[#8BA5AA]/12 space-y-2">
            {incomeSourceComparison.map(item => (
              <div key={item.id} className="space-y-1">
                <div className="flex items-center justify-between text-[11.5px]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[#D5E1E3] font-medium truncate max-w-[130px]">{item.name}</span>
                    <span className="text-[9.5px] px-1.5 py-0.2 rounded bg-[#141A1C] text-[#8CC7AE] border border-[#8CC7AE]/20 shrink-0">
                      {item.recurrence}
                    </span>
                  </div>
                  <div className="num text-right shrink-0">
                    <b className="text-[#F2F5F5]">{formatVND(item.actual)}</b>
                    <span className="text-[#869699]"> / {formatVND(item.expected)}</span>{' '}
                    <span className={`font-bold ml-1 ${item.pct >= 100 ? 'text-[#8CC7AE]' : 'text-[#DEB48A]'}`}>
                      ({item.pct}%)
                    </span>
                  </div>
                </div>
                <div className="h-1 rounded-full bg-[#141A1C] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-[#8CC7AE]"
                    style={{ width: `${Math.min(100, item.pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
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

        {totalPlannedExpensesForPeriod > 0 && (
          <div className="text-[11px] text-[#869699] flex items-center justify-between px-1">
            <span>Khoản chi cố định dự kiến ({periodLabel}):</span>
            <b className="num text-[#D5E1E3]">
              {formatVND(totalPlannedExpensesForPeriod)} (Đạt{' '}
              {Math.round((totalActualSpentForPeriod / totalPlannedExpensesForPeriod) * 100)}%)
            </b>
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
                className={`bg-[#141A1C]/85 border rounded-2xl p-3 space-y-2 ${
                  isOver ? 'border-[#E07A5F]/40' : 'border-[#8BA5AA]/12'
                }`}
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
        </div>
      </div>

      {/* MODAL CẬP NHẬT NHANH SỐ DƯ TÀI KHOẢN NGÂN HÀNG & TIỀN MẶT */}
      {showQuickCashModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">
                Cập nhật Tài khoản Ngân hàng & Tiền mặt
              </span>
              <button
                onClick={() => setShowQuickCashModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {accounts.map(acc => (
                <div
                  key={acc.id}
                  className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3 flex items-center justify-between gap-2"
                >
                  <div>
                    <div className="text-xs font-bold text-[#F2F5F5]">{acc.name}</div>
                    <div className="text-[10.5px] text-[#869699]">
                      {acc.type === 'cash' ? '💵 Tiền mặt' : '🏦 Ngân hàng / Ví'}
                    </div>
                  </div>

                  {editingAccId === acc.id ? (
                    <form onSubmit={handleSaveQuickAccount} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={editingBalanceStr}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/[^\d]/g, '');
                          setEditingBalanceStr(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                        }}
                        className="w-28 bg-[#141A1C] border border-[#8CC7AE] rounded-lg px-2 py-1 text-xs font-bold num text-[#F2F5F5] text-right"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="px-2.5 py-1 rounded-lg bg-[#8CC7AE] text-[#0E1314] text-xs font-bold"
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
                          setEditingBalanceStr(new Intl.NumberFormat('vi-VN').format(acc.balance));
                        }}
                        className="px-2 py-1 rounded-lg bg-[#232D30] text-[11px] text-[#D5E1E3]"
                      >
                        Sửa
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Thêm nhanh ví tiền mặt hoặc tài khoản ngân hàng */}
            <form onSubmit={handleCreateQuickCashOrBank} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">
                Thêm Ví Tiền Mặt hoặc Tài Khoản Ngân Hàng
              </span>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newCashType}
                  onChange={(e) => setNewCashType(e.target.value as 'bank' | 'cash')}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2.5 py-2 text-xs text-[#F2F5F5]"
                >
                  <option value="cash">💵 Ví Tiền mặt</option>
                  <option value="bank">🏦 TK Ngân hàng</option>
                </select>
                <input
                  type="text"
                  placeholder="Tên (VD: Tiền mặt két sắt, VCB...)"
                  value={newCashName}
                  onChange={(e) => setNewCashName(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                />
              </div>
              <input
                type="text"
                placeholder="Số dư thực tế hiện có (₫)"
                value={newCashBalanceStr}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setNewCashBalanceStr(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                }}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] num"
              />
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
    </div>
  );
};
