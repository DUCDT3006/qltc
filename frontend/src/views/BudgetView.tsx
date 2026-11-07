import React, { useState } from 'react';
import { Jar, IncomeSource, PlannedExpense, Transaction } from '../types';
import { formatVND } from '../mockData';
import {
  Sparkles,
  Check,
  Edit2,
  X,
  Settings2,
  Trash2,
  Plus,
  AlertTriangle,
  Palette,
  Scale,
  Receipt,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

interface BudgetViewProps {
  jars: Jar[];
  incomeSources: IncomeSource[];
  plannedExpenses: PlannedExpense[];
  confirmedTransactions: Transaction[];
  onAddIncomeSource: (source: IncomeSource) => void;
  onDeleteIncomeSource: (id: string) => void;
  onAddPlannedExpense: (exp: PlannedExpense) => void;
  onDeletePlannedExpense: (id: string) => void;
  onAddJar: (newJar: { name: string; code?: string; targetPercent: number; monthlyLimit: number; color?: string }) => Promise<void>;
  onUpdateJar: (jarId: string, updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string }) => Promise<void>;
  onBatchUpdateJarsPercent?: (updates: Array<{ id: string; targetPercent: number; monthlyLimit: number }>) => Promise<void>;
  onDeleteJar: (jarId: string) => Promise<void>;
  onAutoAllocateJars: (totalIncome: number) => Promise<void>;
}

const PRESET_COLORS = [
  '#657D81', '#8CC7AE', '#D4A373', '#95B0B4', '#E07A5F', '#A288E3', '#E29578', '#4EA8DE'
];

// Tính phần trăm làm tròn chuẩn sao cho tổng luôn bằng đúng 100% (Largest Remainder Method)
export function computeExact100Percentages(amounts: number[]): number[] {
  const total = amounts.reduce((s, a) => s + Math.max(0, a), 0);
  if (total <= 0 || amounts.length === 0) {
    return amounts.map(() => 0);
  }
  const exact = amounts.map(a => (Math.max(0, a) / total) * 100);
  const floored = exact.map(x => Math.floor(x));
  let remainder = 100 - floored.reduce((s, x) => s + x, 0);

  const indices = exact
    .map((x, idx) => ({ idx, rem: x - Math.floor(x) }))
    .sort((a, b) => b.rem - a.rem);

  for (let i = 0; i < remainder && i < indices.length; i++) {
    floored[indices[i].idx] += 1;
  }
  return floored;
}

export const BudgetView: React.FC<BudgetViewProps> = ({
  jars,
  incomeSources,
  plannedExpenses,
  confirmedTransactions,
  onAddIncomeSource,
  onDeleteIncomeSource,
  onAddPlannedExpense,
  onDeletePlannedExpense,
  onAddJar,
  onUpdateJar,
  onBatchUpdateJarsPercent,
  onDeleteJar,
  onAutoAllocateJars
}) => {
  const [subTab, setSubTab] = useState<'planned' | 'actual'>('planned');
  const [allocatedSuccess, setAllocatedSuccess] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showPlannedExpModal, setShowPlannedExpModal] = useState(false);
  const [showAddJarModal, setShowAddJarModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);

  // State chỉnh sửa 1 hũ
  const [selectedJarForEdit, setSelectedJarForEdit] = useState<Jar | null>(null);
  const [editName, setEditName] = useState('');
  const [editLimitStr, setEditLimitStr] = useState('');
  const [editPercentStr, setEditPercentStr] = useState('10');
  const [editColor, setEditColor] = useState('#657D81');
  const [isDeletingJar, setIsDeletingJar] = useState(false);

  // State cân bằng % toàn bộ các hũ (tổng = 100%)
  const [draftPercents, setDraftPercents] = useState<Record<string, number>>({});

  // State thêm hũ mới
  const [newJarName, setNewJarName] = useState('');
  const [newJarPercentStr, setNewJarPercentStr] = useState('10');
  const [newJarLimitStr, setNewJarLimitStr] = useState('');
  const [newJarColor, setNewJarColor] = useState('#8CC7AE');

  // Form thêm nguồn thu dự kiến
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceKind, setNewSourceKind] = useState<'fixed' | 'irregular' | 'passive'>('fixed');
  const [newSourceAmount, setNewSourceAmount] = useState('');
  const [newSourceRecurrence, setNewSourceRecurrence] = useState('Hàng tháng');

  // Form thêm khoản chi dự kiến
  const [newExpName, setNewExpName] = useState('');
  const [newExpAmount, setNewExpAmount] = useState('');
  const [newExpJarCode, setNewExpJarCode] = useState('NEC');
  const [newExpRecurrence, setNewExpRecurrence] = useState('Hàng tháng');

  // --- SỐ LIỆU DỰ KIẾN ---
  const totalExpectedIncome = incomeSources.reduce((sum, s) => sum + s.expectedAmount, 0);
  const totalPlannedExpenses = plannedExpenses.reduce((sum, e) => sum + e.expectedAmount, 0);
  const totalLimit = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalTargetPercent = Math.round(jars.reduce((sum, j) => sum + (j.targetPercent * 100), 0));

  // --- SỐ LIỆU THỰC TẾ (từ giao dịch đã duyệt) ---
  const actualIncomeTxns = confirmedTransactions.filter(t => t.type === 'income');
  const actualExpenseTxns = confirmedTransactions.filter(t => t.type === 'expense');

  const totalActualIncome = actualIncomeTxns.reduce((sum, t) => sum + t.amount, 0);

  // Tính số tiền thực chi của từng hũ (ưu tiên từ giao dịch đã duyệt hoặc jar.spentThisMonth)
  const jarActualSpent = jars.map(jar => {
    const fromTxns = actualExpenseTxns
      .filter(t => t.suggestedJarCode === jar.code)
      .reduce((sum, t) => sum + t.amount, 0);
    return Math.max(jar.spentThisMonth || 0, fromTxns);
  });

  const totalActualSpent = jarActualSpent.reduce((sum, val) => sum + val, 0);
  // Tự động tính % thực tế của các hũ sao cho tổng = 100%
  const actualJarPercentages = computeExact100Percentages(jarActualSpent);
  const totalActualPercentSum = actualJarPercentages.reduce((s, p) => s + p, 0);

  const remainingPlanned = totalLimit - totalActualSpent;

  const handleOpenBalanceModal = () => {
    const map: Record<string, number> = {};
    jars.forEach(j => {
      map[j.id] = Math.round((j.targetPercent || 0) * 100);
    });
    setDraftPercents(map);
    setShowBalanceModal(true);
  };

  const draftTotalPercent = Object.values(draftPercents).reduce((s, v) => s + (Number(v) || 0), 0);

  // Tự động chuẩn hóa các hũ về đúng 100%
  const handleAutoNormalizeDraftTo100 = () => {
    const rawValues = jars.map(j => Math.max(0, draftPercents[j.id] ?? Math.round((j.targetPercent || 0) * 100)));
    const sum = rawValues.reduce((s, v) => s + v, 0);
    const normalized = sum > 0
      ? computeExact100Percentages(rawValues)
      : computeExact100Percentages(jars.map(() => 1));
    const nextMap: Record<string, number> = {};
    jars.forEach((j, idx) => {
      nextMap[j.id] = normalized[idx];
    });
    setDraftPercents(nextMap);
  };

  const handleSaveBalancedPercents = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draftTotalPercent !== 100) {
      alert(`Tổng tỷ lệ các hũ phải bằng đúng 100% (hiện tại đang là ${draftTotalPercent}%). Anh bấm "Tự động cân bằng 100%" hoặc điều chỉnh lại nhé!`);
      return;
    }

    const updates = jars.map(j => {
      const pct = (draftPercents[j.id] || 0) / 100;
      const limit = totalExpectedIncome > 0 ? Math.round(totalExpectedIncome * pct) : j.monthlyLimit;
      return { id: j.id, targetPercent: pct, monthlyLimit: limit };
    });

    if (onBatchUpdateJarsPercent) {
      await onBatchUpdateJarsPercent(updates);
    } else {
      for (const u of updates) {
        await onUpdateJar(u.id, { targetPercent: u.targetPercent, monthlyLimit: u.monthlyLimit });
      }
    }
    setShowBalanceModal(false);
  };

  const handleSimulateAllocation = async () => {
    if (totalExpectedIncome <= 0) {
      alert('Vui lòng thêm ít nhất 1 nguồn thu nhập dự kiến ở mục "Nguồn thu" để chia hũ tự động nhé anh!');
      return;
    }
    if (totalTargetPercent !== 100) {
      handleOpenBalanceModal();
      return;
    }
    await onAutoAllocateJars(totalExpectedIncome);
    setAllocatedSuccess(true);
    setTimeout(() => setAllocatedSuccess(false), 3000);
  };

  const handleCreateIncomeSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim()) return;
    const amount = parseInt(newSourceAmount.replace(/[^\d]/g, ''), 10) || 0;

    onAddIncomeSource({
      id: `inc_${Date.now()}`,
      name: newSourceName.trim(),
      kind: newSourceKind,
      expectedAmount: amount,
      recurrence: newSourceRecurrence
    });

    setNewSourceName('');
    setNewSourceAmount('');
    setShowIncomeModal(false);
  };

  const handleCreatePlannedExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExpName.trim()) return;
    const amount = parseInt(newExpAmount.replace(/[^\d]/g, ''), 10) || 0;

    onAddPlannedExpense({
      id: `pexp_${Date.now()}`,
      name: newExpName.trim(),
      jarCode: newExpJarCode || 'NEC',
      expectedAmount: amount,
      recurrence: newExpRecurrence
    });

    setNewExpName('');
    setNewExpAmount('');
    setShowPlannedExpModal(false);
  };

  const handleOpenEditJar = (jar: Jar) => {
    setSelectedJarForEdit(jar);
    setEditName(jar.name);
    setEditLimitStr(new Intl.NumberFormat('vi-VN').format(jar.monthlyLimit));
    setEditPercentStr(String(Math.round((jar.targetPercent || 0.1) * 100)));
    setEditColor(jar.color || '#657D81');
    setIsDeletingJar(false);
  };

  const handleSaveJar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJarForEdit) return;
    const limit = parseInt(editLimitStr.replace(/[^\d]/g, ''), 10) || 0;
    const pct = Math.max(0, Math.min(100, parseFloat(editPercentStr) || 0)) / 100;

    await onUpdateJar(selectedJarForEdit.id, {
      name: editName.trim() || selectedJarForEdit.name,
      monthlyLimit: limit,
      targetPercent: pct,
      color: editColor
    });

    setSelectedJarForEdit(null);
  };

  const handleDeleteCurrentJar = async () => {
    if (!selectedJarForEdit) return;
    await onDeleteJar(selectedJarForEdit.id);
    setSelectedJarForEdit(null);
  };

  const handleCreateNewJar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJarName.trim()) return;
    const limit = parseInt(newJarLimitStr.replace(/[^\d]/g, ''), 10) || 0;
    const pct = Math.max(0, Math.min(100, parseFloat(newJarPercentStr) || 10)) / 100;

    await onAddJar({
      name: newJarName.trim(),
      monthlyLimit: limit,
      targetPercent: pct,
      color: newJarColor
    });

    setNewJarName('');
    setNewJarLimitStr('');
    setNewJarPercentStr('10');
    setShowAddJarModal(false);
  };

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[20px] font-bold text-[#F2F5F5]">Ngân sách & Hũ</span>
          <div className="text-xs text-[#869699] mt-0.5">
            {jars.length} hũ · Còn lại <b className="num text-[#F2F5F5]">{formatVND(remainingPlanned > 0 ? remainingPlanned : 0)}</b>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowIncomeModal(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold bg-[#657D81]/25 text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95 transition-transform"
          >
            <Settings2 size={12} /> Thu ({incomeSources.length})
          </button>
          <button
            onClick={() => setShowPlannedExpModal(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold bg-[#20292B] text-[#DEB48A] border border-[#DEB48A]/25 active:scale-95 transition-transform"
          >
            <Receipt size={12} /> Chi ({plannedExpenses.length})
          </button>
        </div>
      </div>

      {/* Mode Switcher: Thu Chi Dự Kiến vs Thu Chi Thực Tế */}
      <div className="grid grid-cols-2 gap-1.5 p-1 bg-[#161C1E] border border-[#8BA5AA]/15 rounded-2xl">
        <button
          onClick={() => setSubTab('planned')}
          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            subTab === 'planned'
              ? 'bg-[#657D81] text-[#F2F5F5] shadow'
              : 'text-[#869699] hover:text-[#D5E1E3]'
          }`}
        >
          📋 Thu Chi Dự Kiến
        </button>
        <button
          onClick={() => setSubTab('actual')}
          className={`py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
            subTab === 'actual'
              ? 'bg-[#8CC7AE] text-[#0E1314] shadow'
              : 'text-[#869699] hover:text-[#D5E1E3]'
          }`}
        >
          📊 Thu Chi Thực Tế
        </button>
      </div>

      {subTab === 'planned' ? (
        <>
          {/* CARD 1: Tổng quan Thu & Chi Dự Kiến */}
          <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-4.5 shadow-[0_16px_36px_rgba(0,0,0,0.35)] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider flex items-center gap-1">
                  <ArrowUpRight size={12} className="text-[#8CC7AE]" />
                  Tổng Thu Dự Kiến ({incomeSources.length} khoản)
                </div>
                <div className="num text-[22px] font-bold text-[#F2F5F5] mt-0.5">
                  {formatVND(totalExpectedIncome)}
                </div>
              </div>
              <button
                onClick={handleSimulateAllocation}
                className="px-3 py-2 rounded-xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
              >
                {allocatedSuccess ? <Check size={14} className="text-[#8CC7AE]" /> : <Sparkles size={14} className="text-[#DEB48A]" />}
                {allocatedSuccess ? 'Đã chia hũ!' : 'Chia hũ theo %'}
              </button>
            </div>

            {totalExpectedIncome > 0 ? (
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#869699]">
                {incomeSources.map((s) => (
                  <span key={s.id}>
                    • {s.name}: <b className="text-[#D5E1E3] num">{formatVND(s.expectedAmount)}</b>
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-[#869699]">
                Anh bấm nút <b>"Thu ({incomeSources.length})"</b> ở góc trên để thêm các khoản thu dự kiến nhé.
              </div>
            )}

            {/* Khoản Chi Dự Kiến */}
            <div className="pt-2.5 border-t border-[#8BA5AA]/15 flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider flex items-center gap-1">
                  <ArrowDownRight size={12} className="text-[#DEB48A]" />
                  Các Khoản Chi Dự Kiến ({plannedExpenses.length} khoản)
                </div>
                <div className="num text-[16px] font-bold text-[#DEB48A] mt-0.5">
                  {formatVND(totalPlannedExpenses)}
                </div>
              </div>
              <button
                onClick={() => setShowPlannedExpModal(true)}
                className="px-2.5 py-1.5 rounded-xl bg-[#20292B] hover:bg-[#2A3639] text-[#DEB48A] border border-[#DEB48A]/30 text-[11px] font-semibold flex items-center gap-1 active:scale-95"
              >
                <Plus size={12} /> Thêm khoản chi
              </button>
            </div>

            {plannedExpenses.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {plannedExpenses.map(exp => {
                  const jar = jars.find(j => j.code === exp.jarCode);
                  return (
                    <span
                      key={exp.id}
                      className="text-[10.5px] px-2.5 py-1 rounded-lg bg-[#161C1E]/80 border border-[#8BA5AA]/15 text-[#C4D0D2]"
                    >
                      {exp.name}: <b className="num text-[#F2F5F5]">{formatVND(exp.expectedAmount)}</b>{' '}
                      <span className="text-[#8CC7AE]">({jar?.name || exp.jarCode})</span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cảnh báo nếu tổng % dự kiến khác 100% */}
          {totalTargetPercent !== 100 && (
            <div className="bg-[#2D221B] border border-[#D4A373]/40 rounded-2xl p-3 flex items-center justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-[#DEB48A] shrink-0 mt-0.5" />
                <div className="text-[11px] text-[#F2E3D5] leading-relaxed">
                  Tổng tỷ lệ các hũ dự kiến đang là <b>{totalTargetPercent}%</b> (yêu cầu đúng <b>100%</b>).
                </div>
              </div>
              <button
                onClick={handleOpenBalanceModal}
                className="px-2.5 py-1.5 rounded-xl bg-[#D4A373] text-[#141A1C] text-[11px] font-bold whitespace-nowrap shrink-0 active:scale-95"
              >
                Cân bằng 100%
              </button>
            </div>
          )}

          {/* Jars List Header & Buttons */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider">
                Tỷ lệ Hũ Dự Kiến ({jars.length})
              </span>
              <button
                onClick={handleOpenBalanceModal}
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                  totalTargetPercent === 100
                    ? 'bg-[#8CC7AE]/10 text-[#8CC7AE] border-[#8CC7AE]/25'
                    : 'bg-[#D4A373]/15 text-[#DEB48A] border-[#D4A373]/35'
                }`}
              >
                <Scale size={10} /> Tổng: {totalTargetPercent}% / 100%
              </button>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleOpenBalanceModal}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#20292B] text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95"
              >
                <Scale size={12} /> Chỉnh %
              </button>
              <button
                onClick={() => setShowAddJarModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 active:scale-95"
              >
                <Plus size={12} /> Thêm hũ
              </button>
            </div>
          </div>

          {/* Jars Grid (Planned Mode) */}
          <div className="grid grid-cols-2 gap-2.5">
            {jars.map((jar, idx) => {
              const actualSpent = jarActualSpent[idx] || 0;
              const pctUsed = jar.monthlyLimit > 0
                ? Math.min(100, Math.round((actualSpent / jar.monthlyLimit) * 100))
                : 0;
              const remainingAmount = jar.monthlyLimit - actualSpent;
              const isWarn = pctUsed >= 90;
              const targetPct = Math.round((jar.targetPercent || 0) * 100);
              const plannedForJar = plannedExpenses
                .filter(e => e.jarCode === jar.code)
                .reduce((s, e) => s + e.expectedAmount, 0);

              return (
                <div
                  key={jar.id}
                  onClick={() => handleOpenEditJar(jar)}
                  className={`bg-[#1C2426]/75 border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer active:scale-98 transition-transform hover:border-[#8BA5AA]/30 ${
                    isWarn ? 'border-[#D4A373]/35' : 'border-[#8BA5AA]/12'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-semibold text-[#F2F5F5] truncate max-w-[95px]">{jar.name}</span>
                    <span className="num text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#232E31] text-[#8CC7AE] border border-[#8CC7AE]/25">
                      Dự kiến {targetPct}%
                    </span>
                  </div>

                  <div className="num text-[15.5px] font-bold text-[#F2F5F5]">
                    {formatVND(jar.monthlyLimit)}
                  </div>
                  <div className="text-[10.5px] text-[#869699] num mt-0.5 flex items-center justify-between">
                    <span>
                      {plannedForJar > 0
                        ? `Chi dự kiến: ${formatVND(plannedForJar)}`
                        : `Còn: ${formatVND(remainingAmount > 0 ? remainingAmount : 0)}`}
                    </span>
                    <Edit2 size={11} className="text-[#869699] ml-1 opacity-70 shrink-0" />
                  </div>

                  <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden mt-2.5">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pctUsed}%`, backgroundColor: jar.color || '#657D81' }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* --- TAB 2: THU CHI THỰC TẾ --- */
        <>
          <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#8CC7AE]/25 rounded-3xl p-4.5 shadow-[0_16px_36px_rgba(0,0,0,0.35)] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-semibold text-[#8CC7AE] uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 size={12} /> Thu Thực Tế (Đã duyệt)
                </div>
                <div className="num text-[22px] font-bold text-[#F2F5F5] mt-0.5">
                  +{formatVND(totalActualIncome)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10.5px] font-semibold text-[#DEB48A] uppercase tracking-wider">
                  Chi Thực Tế (Đã duyệt)
                </div>
                <div className="num text-[20px] font-bold text-[#DEB48A] mt-0.5">
                  −{formatVND(totalActualSpent)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#8BA5AA]/15 text-[11px]">
              <div className="bg-[#161C1E]/70 rounded-xl p-2.5 border border-[#8BA5AA]/10">
                <span className="text-[#869699] block">So với Thu dự kiến</span>
                <span className="num font-bold text-[#8CC7AE] text-xs mt-0.5 block">
                  {totalExpectedIncome > 0
                    ? `Đạt ${Math.round((totalActualIncome / totalExpectedIncome) * 100)}% (${formatVND(totalExpectedIncome)})`
                    : 'Chưa đặt Thu dự kiến'}
                </span>
              </div>
              <div className="bg-[#161C1E]/70 rounded-xl p-2.5 border border-[#8BA5AA]/10">
                <span className="text-[#869699] block">So với Hạn mức Hũ</span>
                <span className="num font-bold text-[#D5E1E3] text-xs mt-0.5 block">
                  {totalLimit > 0
                    ? `Đã dùng ${Math.round((totalActualSpent / totalLimit) * 100)}% (${formatVND(totalLimit)})`
                    : 'Chưa chia hạn mức'}
                </span>
              </div>
            </div>
          </div>

          {/* Header Hũ Thực Tế */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider">
              Cơ cấu % Hũ Thực Tế (Tự động tính)
            </span>
            <span className="text-[10.5px] font-mono px-2.5 py-0.5 rounded-full bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/30">
              Tổng % thực tế: {totalActualSpent > 0 ? `${totalActualPercentSum}%` : '0% (Chưa phát sinh chi)'}
            </span>
          </div>

          {/* Jars Grid (Actual Mode) */}
          <div className="grid grid-cols-2 gap-2.5">
            {jars.map((jar, idx) => {
              const actualSpent = jarActualSpent[idx] || 0;
              const actualPctShare = actualJarPercentages[idx] || 0;
              const plannedPctShare = Math.round((jar.targetPercent || 0) * 100);
              const vsLimitPct = jar.monthlyLimit > 0
                ? Math.round((actualSpent / jar.monthlyLimit) * 100)
                : 0;

              return (
                <div
                  key={jar.id}
                  className="bg-[#1C2426]/85 border border-[#8BA5AA]/15 rounded-2xl p-3.5 flex flex-col justify-between"
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[13px] font-semibold text-[#F2F5F5] truncate max-w-[90px]">{jar.name}</span>
                    <span className="num text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/30">
                      {actualPctShare}%
                    </span>
                  </div>

                  <div className="num text-[16px] font-bold text-[#F2F5F5]">
                    {formatVND(actualSpent)}
                  </div>

                  <div className="text-[10.5px] text-[#869699] num mt-1 flex items-center justify-between">
                    <span>Dự kiến: {plannedPctShare}%</span>
                    <span className={vsLimitPct > 100 ? 'text-[#E07A5F] font-semibold' : 'text-[#8CC7AE]'}>
                      {jar.monthlyLimit > 0 ? `Đạt ${vsLimitPct}% hũ` : '—'}
                    </span>
                  </div>

                  {/* Thanh so sánh % thực tế vs % dự kiến */}
                  <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden mt-2.5">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, actualPctShare)}%`,
                        backgroundColor: jar.color || '#8CC7AE'
                      }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* MODAL 1: Quản lý Nguồn thu Dự kiến */}
      {showIncomeModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">Khoản Thu Dự Kiến</span>
              <button
                onClick={() => setShowIncomeModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {incomeSources.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#869699] bg-[#1C2426]/50 rounded-2xl border border-[#8BA5AA]/10">
                  Chưa có khoản thu dự kiến nào. Anh thêm ở bên dưới nhé!
                </div>
              ) : (
                incomeSources.map((s) => (
                  <div key={s.id} className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-2xl p-3 flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-[#F2F5F5]">{s.name}</div>
                      <div className="text-[10.5px] text-[#869699]">
                        {s.recurrence} · {s.kind === 'fixed' ? 'Cố định' : s.kind === 'passive' ? 'Thụ động' : 'Không đều'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="num text-xs font-bold text-[#8CC7AE]">
                        {formatVND(s.expectedAmount)}
                      </div>
                      <button
                        type="button"
                        onClick={() => onDeleteIncomeSource(s.id)}
                        className="w-7 h-7 rounded-lg bg-[#282121] text-[#E06D6D] hover:bg-[#3B2525] flex items-center justify-center active:scale-90 transition-transform"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleCreateIncomeSource} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">Thêm khoản thu dự kiến</span>
              <input
                type="text"
                placeholder="Tên nguồn thu (VD: Lương, Cho thuê nhà, Cổ tức...)"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newSourceKind}
                  onChange={(e) => setNewSourceKind(e.target.value as any)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]"
                >
                  <option value="fixed">Cố định</option>
                  <option value="irregular">Không đều</option>
                  <option value="passive">Thụ động</option>
                </select>
                <input
                  type="text"
                  placeholder="Chu kỳ (Hàng tháng)"
                  value={newSourceRecurrence}
                  onChange={(e) => setNewSourceRecurrence(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <input
                type="text"
                placeholder="Số tiền dự kiến mỗi tháng (₫)"
                value={newSourceAmount}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setNewSourceAmount(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                }}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow active:scale-98 transition-transform"
              >
                + Lưu khoản thu dự kiến
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1B: Quản lý Khoản Chi Dự Kiến */}
      {showPlannedExpModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">Các Khoản Chi Dự Kiến</span>
              <button
                onClick={() => setShowPlannedExpModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2">
              {plannedExpenses.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#869699] bg-[#1C2426]/50 rounded-2xl border border-[#8BA5AA]/10">
                  Chưa có khoản chi dự kiến nào (VD: Tiền nhà, Điện nước, Học phí...). Anh thêm ở dưới nhé!
                </div>
              ) : (
                plannedExpenses.map((exp) => {
                  const jar = jars.find(j => j.code === exp.jarCode);
                  return (
                    <div key={exp.id} className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-2xl p-3 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-[#F2F5F5]">{exp.name}</div>
                        <div className="text-[10.5px] text-[#869699]">
                          Hũ: <b className="text-[#8CC7AE]">{jar?.name || exp.jarCode}</b> · {exp.recurrence}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="num text-xs font-bold text-[#DEB48A]">
                          {formatVND(exp.expectedAmount)}
                        </div>
                        <button
                          type="button"
                          onClick={() => onDeletePlannedExpense(exp.id)}
                          className="w-7 h-7 rounded-lg bg-[#282121] text-[#E06D6D] hover:bg-[#3B2525] flex items-center justify-center active:scale-90"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={handleCreatePlannedExpense} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">Thêm khoản chi dự kiến</span>
              <input
                type="text"
                placeholder="Tên khoản chi (VD: Tiền thuê nhà, Điện nước, Xăng xe...)"
                value={newExpName}
                onChange={(e) => setNewExpName(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newExpJarCode}
                  onChange={(e) => setNewExpJarCode(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]"
                >
                  {jars.map(j => (
                    <option key={j.id} value={j.code}>Hũ: {j.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Chu kỳ (Hàng tháng)"
                  value={newExpRecurrence}
                  onChange={(e) => setNewExpRecurrence(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <input
                type="text"
                placeholder="Số tiền chi dự kiến (₫)"
                value={newExpAmount}
                onChange={(e) => {
                  const raw = e.target.value.replace(/[^\d]/g, '');
                  setNewExpAmount(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                }}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#D4A373] text-[#141A1C] text-xs font-bold shadow active:scale-98 transition-transform"
              >
                + Lưu khoản chi dự kiến
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CÂN BẰNG TỶ LỆ % CÁC HŨ DỰ KIẾN (BẮT BUỘC TỔNG = 100%) */}
      {showBalanceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-[#161C1E] border border-[#8BA5AA]/25 rounded-3xl p-5 shadow-2xl space-y-3.5 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-bold text-[#F2F5F5] block">
                  Thiết lập % các Hũ Dự Kiến
                </span>
                <span className="text-[11px] text-[#869699]">
                  Tổng tỷ lệ các hũ bắt buộc bằng đúng 100%
                </span>
              </div>
              <button
                onClick={() => setShowBalanceModal(false)}
                className="w-7 h-7 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className={`p-3 rounded-2xl border flex items-center justify-between ${
              draftTotalPercent === 100
                ? 'bg-[#8CC7AE]/10 border-[#8CC7AE]/30 text-[#8CC7AE]'
                : 'bg-[#D4A373]/15 border-[#D4A373]/40 text-[#DEB48A]'
            }`}>
              <span className="text-xs font-bold">
                Tổng % hiện tại: {draftTotalPercent}% / 100%
              </span>
              {draftTotalPercent !== 100 && (
                <button
                  type="button"
                  onClick={handleAutoNormalizeDraftTo100}
                  className="px-2.5 py-1 rounded-lg bg-[#D4A373] text-[#141A1C] text-[11px] font-bold active:scale-95"
                >
                  Tự cân bằng 100%
                </button>
              )}
            </div>

            <form onSubmit={handleSaveBalancedPercents} className="space-y-2.5">
              {jars.map((jar) => {
                const val = draftPercents[jar.id] ?? Math.round((jar.targetPercent || 0) * 100);
                const estLimit = totalExpectedIncome > 0 ? Math.round((totalExpectedIncome * val) / 100) : jar.monthlyLimit;
                return (
                  <div key={jar.id} className="bg-[#20292B] border border-[#8BA5AA]/15 rounded-xl p-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[#F2F5F5] truncate">{jar.name}</div>
                      <div className="text-[10.5px] text-[#869699] num">
                        Dự kiến: {formatVND(estLimit)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={val}
                        onChange={(e) => {
                          const n = Math.max(0, Math.min(100, parseInt(e.target.value || '0', 10)));
                          setDraftPercents(prev => ({ ...prev, [jar.id]: n }));
                        }}
                        className="w-16 bg-[#161C1E] border border-[#8BA5AA]/25 rounded-lg px-2 py-1.5 text-right text-xs font-bold num text-[#F2F5F5]"
                      />
                      <span className="text-xs text-[#869699] font-bold">%</span>
                    </div>
                  </div>
                );
              })}

              <button
                type="submit"
                disabled={draftTotalPercent !== 100}
                className={`w-full py-2.5 rounded-xl text-xs font-bold shadow transition-all ${
                  draftTotalPercent === 100
                    ? 'bg-[#8CC7AE] text-[#0E1314] active:scale-98'
                    : 'bg-[#232D30] text-[#869699] cursor-not-allowed'
                }`}
              >
                {draftTotalPercent === 100
                  ? '✓ Lưu tỷ lệ 100% & Cập nhật hạn mức'
                  : `Cần điều chỉnh thêm ${100 - draftTotalPercent}% để đạt 100%`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Chỉnh sửa & Xóa Hũ */}
      {selectedJarForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-[#161C1E] border border-[#8BA5AA]/25 rounded-3xl p-5 shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#F2F5F5]">
                Cài đặt hũ: {selectedJarForEdit.name}
              </span>
              <button
                onClick={() => setSelectedJarForEdit(null)}
                className="w-7 h-7 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveJar} className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tên hũ
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#F2F5F5] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Hạn mức (₫)
                  </label>
                  <input
                    type="text"
                    value={editLimitStr}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setEditLimitStr(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                    }}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-bold num text-[#F2F5F5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Tỷ lệ dự kiến (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editPercentStr}
                    onChange={(e) => {
                      setEditPercentStr(e.target.value);
                      const pctVal = parseFloat(e.target.value) || 0;
                      if (totalExpectedIncome > 0) {
                        const autoLim = Math.round((totalExpectedIncome * pctVal) / 100);
                        setEditLimitStr(new Intl.NumberFormat('vi-VN').format(autoLim));
                      }
                    }}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-bold num text-[#F2F5F5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                  <Palette size={12} /> Màu nhận diện
                </label>
                <div className="flex gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setEditColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        editColor === c ? 'scale-110 border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] text-xs font-bold shadow active:scale-98 transition-transform"
                >
                  Lưu thay đổi
                </button>

                {!isDeletingJar ? (
                  <button
                    type="button"
                    onClick={() => setIsDeletingJar(true)}
                    className="w-full py-2 rounded-xl bg-transparent text-[#E06D6D] hover:bg-[#282121] border border-[#E06D6D]/30 text-xs font-medium flex items-center justify-center gap-1.5 active:scale-98 transition-transform"
                  >
                    <Trash2 size={13} /> Xóa hũ này
                  </button>
                ) : (
                  <div className="p-2.5 rounded-xl bg-[#2D1F20] border border-[#E06D6D]/40 space-y-2">
                    <span className="text-[11px] text-[#FFBEBE] block text-center">
                      Anh có chắc chắn muốn xóa hũ <strong>{selectedJarForEdit.name}</strong> không?
                    </span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setIsDeletingJar(false)}
                        className="py-1.5 rounded-lg bg-[#20292B] text-xs text-[#D5E1E3]"
                      >
                        Hủy
                      </button>
                      <button
                        type="button"
                        onClick={handleDeleteCurrentJar}
                        className="py-1.5 rounded-lg bg-[#E06D6D] text-xs font-bold text-[#140E0E]"
                      >
                        Đồng ý xóa
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Thêm Hũ Mới */}
      {showAddJarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-[#161C1E] border border-[#8BA5AA]/25 rounded-3xl p-5 shadow-2xl space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#F2F5F5]">
                Thêm hũ chi tiêu mới
              </span>
              <button
                onClick={() => setShowAddJarModal(false)}
                className="w-7 h-7 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateNewJar} className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tên hũ chi tiêu
                </label>
                <input
                  type="text"
                  placeholder="VD: Quỹ du lịch, Sức khỏe, Trả nợ..."
                  value={newJarName}
                  onChange={(e) => setNewJarName(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-semibold text-[#F2F5F5] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Hạn mức dự kiến (₫)
                  </label>
                  <input
                    type="text"
                    placeholder="0 ₫"
                    value={newJarLimitStr}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/[^\d]/g, '');
                      setNewJarLimitStr(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                    }}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-bold num text-[#F2F5F5] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Tỷ lệ % phân bổ
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={newJarPercentStr}
                    onChange={(e) => setNewJarPercentStr(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-bold num text-[#F2F5F5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1.5 flex items-center gap-1">
                  <Palette size={12} /> Chọn màu sắc
                </label>
                <div className="flex gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      type="button"
                      key={c}
                      onClick={() => setNewJarColor(c)}
                      className={`w-6 h-6 rounded-full border-2 transition-transform ${
                        newJarColor === c ? 'scale-110 border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#8CC7AE] text-[#0E1314] text-xs font-bold shadow active:scale-98 transition-transform"
                >
                  + Tạo hũ mới
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
