import React, { useState } from 'react';
import { Jar, IncomeSource, PlannedExpense, Transaction } from '../types';
import { formatVND, normalizeToMonthlyAmount, computeExact100Percentages, RECURRENCE_PRESETS } from '../utils/financeMath';
import { isTxnInPeriod, getVietnamDate } from '../utils/dateUtils';
import { CurrencyInput } from '../components/CurrencyInput';
import { ConfirmSheet } from '../components/ConfirmSheet';
import {
  Sparkles,
  Check,
  Edit2,
  Edit3,
  X,
  Trash2,
  Plus,
  AlertTriangle,
  Scale,
  Receipt,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  Star
} from 'lucide-react';

interface BudgetViewProps {
  jars: Jar[];
  incomeSources: IncomeSource[];
  plannedExpenses: PlannedExpense[];
  confirmedTransactions: Transaction[];
  onAddIncomeSource: (source: IncomeSource) => void;
  onUpdateIncomeSource?: (id: string, source: Partial<IncomeSource>) => void;
  onDeleteIncomeSource: (id: string) => void;
  onAddPlannedExpense: (exp: PlannedExpense) => void;
  onUpdatePlannedExpense?: (id: string, exp: Partial<PlannedExpense>) => void;
  onDeletePlannedExpense: (id: string) => void;
  onAddJar: (newJar: { name: string; code?: string; targetPercent: number; monthlyLimit: number; color?: string; isDefault?: boolean }) => Promise<void>;
  onUpdateJar: (jarId: string, updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string; isDefault?: boolean }) => Promise<void>;
  onBatchUpdateJarsPercent?: (updates: Array<{ id: string; targetPercent: number; monthlyLimit: number }>) => Promise<void>;
  onDeleteJar: (jarId: string) => Promise<void>;
  onAutoAllocateJars: (totalIncome: number) => Promise<void>;
  onOpenQuickAddIncome?: () => void;
}

const PRESET_COLORS = [
  '#657D81', '#8CC7AE', '#D4A373', '#95B0B4', '#E07A5F', '#A288E3', '#E29578', '#4EA8DE'
];

export const BudgetView: React.FC<BudgetViewProps> = ({
  jars,
  incomeSources,
  plannedExpenses,
  confirmedTransactions,
  onAddIncomeSource,
  onUpdateIncomeSource,
  onDeleteIncomeSource,
  onAddPlannedExpense,
  onUpdatePlannedExpense,
  onDeletePlannedExpense,
  onAddJar,
  onUpdateJar,
  onBatchUpdateJarsPercent,
  onDeleteJar,
  onAutoAllocateJars,
  onOpenQuickAddIncome
}) => {
  const [subTab, setSubTab] = useState<'planned' | 'actual'>('planned');
  const [allocatedSuccess, setAllocatedSuccess] = useState(false);

  // Modal Thêm / Sửa Nguồn thu (U-07: Hợp nhất và dễ sử dụng nhất)
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceAmount, setSourceAmount] = useState<number>(0);
  const [sourceRecurrence, setSourceRecurrence] = useState('Hàng tháng');
  const [sourceKind, setSourceKind] = useState<'fixed' | 'irregular' | 'passive'>('fixed');

  // Modal Khoản chi dự kiến
  const [showPlannedExpModal, setShowPlannedExpModal] = useState(false);
  const [editingExpId, setEditingExpId] = useState<string | null>(null);
  const [expName, setExpName] = useState('');
  const [expAmount, setExpAmount] = useState<number>(0);
  const [expJarCode, setExpJarCode] = useState(jars[0]?.code || 'NEC');
  const [expRecurrence, setExpRecurrence] = useState('Hàng tháng');

  // Modal Thêm / Sửa Hũ
  const [showAddJarModal, setShowAddJarModal] = useState(false);
  const [showBalanceModal, setShowBalanceModal] = useState(false);
  const [selectedJarForEdit, setSelectedJarForEdit] = useState<Jar | null>(null);
  const [editName, setEditName] = useState('');
  const [editLimit, setEditLimit] = useState<number>(0);
  const [editPercentStr, setEditPercentStr] = useState('10');
  const [editColor, setEditColor] = useState('#657D81');
  const [editIsDefault, setEditIsDefault] = useState(false);

  // State thêm hũ mới
  const [newJarName, setNewJarName] = useState('');
  const [newJarPercentStr, setNewJarPercentStr] = useState('10');
  const [newJarLimit, setNewJarLimit] = useState<number>(0);
  const [newJarColor, setNewJarColor] = useState('#8CC7AE');
  const [newJarIsDefault, setNewJarIsDefault] = useState(false);

  // Draft % khi cân bằng các hũ
  const [draftPercents, setDraftPercents] = useState<Record<string, number>>({});

  // Confirm Sheet
  const [confirmSheet, setConfirmSheet] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => {}
  });

  // --- TÍNH TOÁN DỰ KIẾN (Quy đổi toàn bộ nguồn thu về chuẩn hàng tháng) ---
  const totalExpectedIncome = incomeSources.reduce(
    (sum, s) => sum + normalizeToMonthlyAmount(s.expectedAmount, s.recurrence),
    0
  );

  const totalPlannedExpenses = plannedExpenses.reduce(
    (sum, e) => sum + normalizeToMonthlyAmount(e.expectedAmount, e.recurrence),
    0
  );

  const totalLimit = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalTargetPercent = Math.round(jars.reduce((sum, j) => sum + j.targetPercent * 100, 0));

  // --- SỐ LIỆU THỰC TẾ (Lọc chuẩn tháng hiện tại theo múi giờ VN UTC+7) ---
  const nowVN = getVietnamDate();
  const currentMonthTxns = confirmedTransactions.filter(t =>
    isTxnInPeriod(t.occurredAtIso || t.occurredAt, 'month', {
      year: nowVN.getFullYear(),
      month: nowVN.getMonth() + 1
    })
  );

  const actualIncomeTxns = currentMonthTxns.filter(t => t.type === 'income');
  const actualExpenseTxns = currentMonthTxns.filter(t => t.type === 'expense');

  const totalActualIncome = actualIncomeTxns.reduce((sum, t) => sum + t.amount, 0);

  // Tính số tiền thực chi của từng hũ (ưu tiên jarId duy nhất, không dùng Math.max làm kẹt số cũ)
  const jarActualSpent = jars.map(jar => {
    return actualExpenseTxns
      .filter(t => (t.jarId ? t.jarId === jar.id : t.suggestedJarCode === jar.code))
      .reduce((sum, t) => sum + t.amount, 0);
  });

  const totalActualSpent = jarActualSpent.reduce((sum, val) => sum + val, 0);
  const actualJarPercentages = computeExact100Percentages(jarActualSpent);
  const totalActualPercentSum = actualJarPercentages.reduce((s, p) => s + p, 0);
  const remainingPlanned = totalLimit - totalActualSpent;

  // --- HANDLERS NGUỒN THU (U-07) ---
  const handleOpenAddIncome = () => {
    setEditingSourceId(null);
    setSourceName('');
    setSourceAmount(0);
    setSourceRecurrence('Hàng tháng');
    setSourceKind('fixed');
    setShowIncomeModal(true);
  };

  const handleOpenEditIncome = (source: IncomeSource) => {
    setEditingSourceId(source.id);
    setSourceName(source.name);
    setSourceAmount(source.expectedAmount);
    setSourceRecurrence(source.recurrence || 'Hàng tháng');
    setSourceKind(source.kind || 'fixed');
    setShowIncomeModal(true);
  };

  const handleSaveIncomeSource = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceName.trim() || sourceAmount <= 0) return;

    if (editingSourceId) {
      if (onUpdateIncomeSource) {
        onUpdateIncomeSource(editingSourceId, {
          name: sourceName.trim(),
          expectedAmount: sourceAmount,
          recurrence: sourceRecurrence,
          kind: sourceKind
        });
      } else {
        onDeleteIncomeSource(editingSourceId);
        onAddIncomeSource({
          id: editingSourceId,
          name: sourceName.trim(),
          expectedAmount: sourceAmount,
          recurrence: sourceRecurrence,
          kind: sourceKind,
          color: '#8CC7AE'
        });
      }
    } else {
      onAddIncomeSource({
        id: `inc_${Date.now()}`,
        name: sourceName.trim(),
        expectedAmount: sourceAmount,
        recurrence: sourceRecurrence,
        kind: sourceKind,
        color: '#8CC7AE'
      });
    }

    setShowIncomeModal(false);
  };

  // --- HANDLERS KHOẢN CHI DỰ KIẾN ---
  const handleOpenAddPlannedExp = () => {
    setEditingExpId(null);
    setExpName('');
    setExpAmount(0);
    setExpJarCode(jars[0]?.code || 'NEC');
    setExpRecurrence('Hàng tháng');
    setShowPlannedExpModal(true);
  };

  const handleOpenEditPlannedExp = (exp: PlannedExpense) => {
    setEditingExpId(exp.id);
    setExpName(exp.name);
    setExpAmount(exp.expectedAmount);
    setExpJarCode(exp.jarCode);
    setExpRecurrence(exp.recurrence || 'Hàng tháng');
    setShowPlannedExpModal(true);
  };

  const handleSavePlannedExp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expName.trim() || expAmount <= 0) return;

    if (editingExpId) {
      if (onUpdatePlannedExpense) {
        onUpdatePlannedExpense(editingExpId, {
          name: expName.trim(),
          expectedAmount: expAmount,
          jarCode: expJarCode,
          recurrence: expRecurrence
        });
      } else {
        onDeletePlannedExpense(editingExpId);
        onAddPlannedExpense({
          id: editingExpId,
          name: expName.trim(),
          expectedAmount: expAmount,
          jarCode: expJarCode,
          recurrence: expRecurrence
        });
      }
    } else {
      onAddPlannedExpense({
        id: `plan_exp_${Date.now()}`,
        name: expName.trim(),
        expectedAmount: expAmount,
        jarCode: expJarCode,
        recurrence: expRecurrence
      });
    }

    setShowPlannedExpModal(false);
  };

  // --- CHIA HŨ TỰ ĐỘNG ---
  const handleSimulateAllocation = async () => {
    if (totalExpectedIncome <= 0) {
      handleOpenAddIncome();
      return;
    }
    await onAutoAllocateJars(totalExpectedIncome);
    setAllocatedSuccess(true);
    setTimeout(() => setAllocatedSuccess(false), 3000);
  };

  // --- CÂN BẰNG TỶ LỆ HŨ 100% ---
  const handleOpenBalanceModal = () => {
    const initial: Record<string, number> = {};
    jars.forEach(j => {
      initial[j.id] = Math.round((j.targetPercent || 0) * 100);
    });
    setDraftPercents(initial);
    setShowBalanceModal(true);
  };

  const handleSaveDraftPercents = async () => {
    const draftSum = Object.values(draftPercents).reduce((a, b) => a + b, 0);
    if (draftSum !== 100) return;

    if (onBatchUpdateJarsPercent) {
      const updates = jars.map(j => {
        const pct = (draftPercents[j.id] || 0) / 100;
        const newLimit = Math.round(totalExpectedIncome * pct);
        return { id: j.id, targetPercent: pct, monthlyLimit: newLimit };
      });
      await onBatchUpdateJarsPercent(updates);
    } else {
      for (const j of jars) {
        const pct = (draftPercents[j.id] || 0) / 100;
        const newLimit = Math.round(totalExpectedIncome * pct);
        await onUpdateJar(j.id, { targetPercent: pct, monthlyLimit: newLimit });
      }
    }
    setShowBalanceModal(false);
  };

  const handleOpenEditJar = (jar: Jar) => {
    setSelectedJarForEdit(jar);
    setEditName(jar.name);
    setEditLimit(jar.monthlyLimit);
    setEditPercentStr(String(Math.round((jar.targetPercent || 0) * 100)));
    setEditColor(jar.color || '#657D81');
    setEditIsDefault(Boolean(jar.isDefault));
  };

  const handleSaveEditJar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJarForEdit) return;

    const pct = Math.max(0, Math.min(100, parseFloat(editPercentStr) || 0)) / 100;
    await onUpdateJar(selectedJarForEdit.id, {
      name: editName.trim() || selectedJarForEdit.name,
      monthlyLimit: editLimit,
      targetPercent: pct,
      color: editColor,
      isDefault: editIsDefault
    });

    setSelectedJarForEdit(null);
  };

  const handleCreateNewJar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newJarName.trim()) return;
    const pct = Math.max(0, Math.min(100, parseFloat(newJarPercentStr) || 10)) / 100;

    await onAddJar({
      name: newJarName.trim(),
      monthlyLimit: newJarLimit,
      targetPercent: pct,
      color: newJarColor,
      isDefault: newJarIsDefault
    });

    setNewJarName('');
    setNewJarLimit(0);
    setNewJarPercentStr('10');
    setNewJarIsDefault(false);
    setShowAddJarModal(false);
  };

  return (
    <div className="space-y-3 pb-24 px-4 select-none">
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
            onClick={handleOpenAddPlannedExp}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-[#20292B] text-[#DEB48A] border border-[#DEB48A]/25 active:scale-95 transition-transform"
          >
            <Receipt size={12} /> Chi dự kiến ({plannedExpenses.length})
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
          {/* CARD 1: Tổng quan Thu & Chi Dự Kiến (U-07: Thêm & Sửa 1 chạm cực kỳ dễ) */}
          <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-4.5 shadow-[0_16px_36px_rgba(0,0,0,0.35)] space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider flex items-center gap-1">
                  <ArrowUpRight size={12} className="text-[#8CC7AE]" />
                  Tổng Thu Dự Kiến ({incomeSources.length} nguồn)
                </div>
                <div className="num text-[23px] font-bold text-[#F2F5F5] mt-0.5">
                  {formatVND(totalExpectedIncome)}{' '}
                  <span className="text-xs text-[#869699] font-normal">/tháng</span>
                </div>
              </div>

              {/* Nút + Thêm khoản thu to, trực quan, ngay trên Card chính */}
              <button
                type="button"
                onClick={handleOpenAddIncome}
                className="px-3.5 py-2 rounded-xl bg-[#8CC7AE] hover:bg-[#9ED4BC] text-[#0E1314] text-xs font-bold flex items-center gap-1.5 shadow-md active:scale-95 transition-all"
              >
                <Plus size={15} strokeWidth={2.5} />
                Thêm khoản thu
              </button>
            </div>

            {/* Danh sách các khoản thu dạng thẻ chạm tương tác (Bấm vào là Sửa/Xóa ngay) */}
            {incomeSources.length > 0 ? (
              <div className="space-y-1.5 pt-1">
                <div className="text-[10.5px] text-[#869699]">
                  💡 <i>Chạm vào bất kỳ khoản thu nào bên dưới để chỉnh sửa hoặc xóa:</i>
                </div>
                <div className="flex flex-wrap gap-2">
                  {incomeSources.map((s) => {
                    const monthly = normalizeToMonthlyAmount(s.expectedAmount, s.recurrence);
                    const isMonthly = (s.recurrence || '').toLowerCase().includes('tháng') && !s.recurrence.toLowerCase().includes('6 tháng');
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => handleOpenEditIncome(s)}
                        className="inline-flex items-center gap-1.5 bg-[#161C1E]/80 hover:bg-[#20292B] px-3 py-1.5 rounded-xl border border-[#8BA5AA]/20 active:scale-95 transition-all group"
                      >
                        <span className="w-2 h-2 rounded-full bg-[#8CC7AE]"></span>
                        <span className="text-xs font-semibold text-[#F2F5F5]">{s.name}:</span>
                        <b className="text-[#8CC7AE] num text-xs">{formatVND(monthly)}/th</b>
                        {!isMonthly && (
                          <span className="text-[10px] text-[#869699]">
                            ({formatVND(s.expectedAmount)}/{s.recurrence})
                          </span>
                        )}
                        <Edit3 size={11} className="text-[#869699] group-hover:text-[#F2F5F5] ml-0.5" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div
                onClick={handleOpenAddIncome}
                className="text-xs text-[#869699] bg-[#161C1E]/40 border border-dashed border-[#8BA5AA]/25 rounded-2xl p-3 text-center cursor-pointer hover:border-[#8CC7AE]/50 transition-colors"
              >
                Chưa có khoản thu nào. Bấm <b>+ Thêm khoản thu</b> để bắt đầu lập kế hoạch tài chính!
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
                  {formatVND(totalPlannedExpenses)} <span className="text-xs text-[#869699] font-normal">/tháng</span>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenAddPlannedExp}
                className="px-2.5 py-1.5 rounded-xl bg-[#20292B] hover:bg-[#2A3639] text-[#DEB48A] border border-[#DEB48A]/30 text-[11px] font-semibold flex items-center gap-1 active:scale-95"
              >
                <Plus size={12} /> Thêm khoản chi
              </button>
            </div>

            {plannedExpenses.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {plannedExpenses.map(exp => {
                  const jar = jars.find(j => j.code === exp.jarCode);
                  const monthlyExp = normalizeToMonthlyAmount(exp.expectedAmount, exp.recurrence);
                  const isExpMonthly = (exp.recurrence || 'Hàng tháng') === 'Hàng tháng';
                  return (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => handleOpenEditPlannedExp(exp)}
                      className="text-[10.5px] px-2.5 py-1 rounded-lg bg-[#161C1E]/80 border border-[#8BA5AA]/15 text-[#C4D0D2] hover:bg-[#232D30] active:scale-95 transition-all flex items-center gap-1"
                    >
                      <span>{exp.name}:</span>
                      <b className="num text-[#F2F5F5]">{formatVND(monthlyExp)}/th</b>
                      {!isExpMonthly && (
                        <span className="text-[9.5px] text-[#869699]">({exp.recurrence})</span>
                      )}
                      <span className="text-[#8CC7AE]">({jar?.name || exp.jarCode})</span>
                      <Edit2 size={10} className="text-[#869699]" />
                    </button>
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

          {/* Jars List Header & Chia hũ button */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider">
                Hũ Chi Tiêu Dự Kiến ({jars.length})
              </span>
              <button
                onClick={handleOpenBalanceModal}
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full border flex items-center gap-1 ${
                  totalTargetPercent === 100
                    ? 'bg-[#8CC7AE]/10 text-[#8CC7AE] border-[#8CC7AE]/25'
                    : 'bg-[#D4A373]/15 text-[#DEB48A] border-[#D4A373]/35'
                }`}
              >
                <Scale size={10} /> {totalTargetPercent}% / 100%
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Nút Chia hũ theo % được chuyển xuống đúng vị trí quản lý hũ */}
              <button
                onClick={handleSimulateAllocation}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-[#657D81]/25 text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95"
                title="Tự động tính hạn mức các hũ theo % từ Tổng Thu Dự Kiến"
              >
                {allocatedSuccess ? <Check size={12} className="text-[#8CC7AE]" /> : <Sparkles size={12} className="text-[#DEB48A]" />}
                {allocatedSuccess ? 'Đã chia hũ!' : 'Chia hũ %'}
              </button>
              <button
                onClick={handleOpenBalanceModal}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-semibold bg-[#20292B] text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95"
              >
                <Scale size={12} /> Cân bằng
              </button>
              <button
                onClick={() => setShowAddJarModal(true)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-xl text-[11px] font-semibold bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 active:scale-95"
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
                .reduce((s, e) => s + normalizeToMonthlyAmount(e.expectedAmount, e.recurrence), 0);

              return (
                <div
                  key={jar.id}
                  onClick={() => handleOpenEditJar(jar)}
                  className={`bg-[#1C2426]/75 border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer active:scale-98 transition-transform hover:border-[#8BA5AA]/30 ${
                    isWarn ? 'border-[#D4A373]/35' : 'border-[#8BA5AA]/12'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 gap-1">
                    <span className="text-[13px] font-semibold text-[#F2F5F5] truncate flex items-center gap-1 min-w-0">
                      {jar.isDefault && <Star size={11} className="text-[#DEB48A] fill-[#DEB48A] shrink-0" />}
                      <span className="truncate">{jar.name}</span>
                    </span>
                    <span className="num text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#232E31] text-[#8CC7AE] border border-[#8CC7AE]/25 shrink-0">
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
                  <CheckCircle2 size={12} /> Thu Thực Tế (Tháng {nowVN.getMonth() + 1})
                </div>
                <div className="num text-[22px] font-bold text-[#F2F5F5] mt-0.5">
                  +{formatVND(totalActualIncome)}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {onOpenQuickAddIncome && (
                  <button
                    type="button"
                    onClick={onOpenQuickAddIncome}
                    className="px-2.5 py-1.5 rounded-xl bg-[#8CC7AE]/20 hover:bg-[#8CC7AE]/30 text-[#8CC7AE] text-[11px] font-bold border border-[#8CC7AE]/30 active:scale-95"
                  >
                    + Ghi thu
                  </button>
                )}
                <div className="text-right">
                  <div className="text-[10.5px] font-semibold text-[#DEB48A] uppercase tracking-wider">
                    Chi Thực Tế
                  </div>
                  <div className="num text-[20px] font-bold text-[#DEB48A] mt-0.5">
                    −{formatVND(totalActualSpent)}
                  </div>
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

          {/* Header Hũ Thực Tế (Tự động đồng bộ với tab Dự Kiến) */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider">
                Cơ cấu Hũ Thực Tế ({jars.length})
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/30">
                Tổng: {totalActualSpent > 0 ? `${totalActualPercentSum}%` : '0%'}
              </span>
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
                  onClick={() => handleOpenEditJar(jar)}
                  className="bg-[#1C2426]/85 border border-[#8BA5AA]/15 rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer active:scale-98 transition-transform hover:border-[#8BA5AA]/30"
                >
                  <div className="flex items-center justify-between mb-1.5 gap-1">
                    <span className="text-[13px] font-semibold text-[#F2F5F5] truncate flex items-center gap-1 min-w-0">
                      {jar.isDefault && <Star size={11} className="text-[#DEB48A] fill-[#DEB48A] shrink-0" />}
                      <span className="truncate">{jar.name}</span>
                    </span>
                    <span className="num text-[11px] font-bold px-2 py-0.5 rounded-full bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/30 shrink-0">
                      {actualPctShare}%
                    </span>
                  </div>

                  <div className="num text-[16px] font-bold text-[#F2F5F5]">
                    {formatVND(actualSpent)}
                  </div>

                  <div className="text-[10.5px] text-[#869699] num mt-1 flex items-center justify-between">
                    <span>Dự kiến: {plannedPctShare}%</span>
                    <div className="flex items-center gap-1">
                      <span className={vsLimitPct > 100 ? 'text-[#E07A5F] font-semibold' : 'text-[#8CC7AE]'}>
                        {jar.monthlyLimit > 0 ? `Đạt ${vsLimitPct}%` : '—'}
                      </span>
                      <Edit2 size={11} className="text-[#869699] opacity-70 shrink-0" />
                    </div>
                  </div>

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

      {/* ===================================================================== */}
      {/* MODAL 1: THÊM / SỬA KHOẢN THU (U-07)                                  */}
      {/* ===================================================================== */}
      {showIncomeModal && (() => {
        const convertedMonthly = normalizeToMonthlyAmount(sourceAmount, sourceRecurrence);
        const isMonthly = sourceRecurrence === 'Hàng tháng';

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
            <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-base font-bold text-[#F2F5F5] block">
                    {editingSourceId ? 'Chỉnh sửa khoản thu' : 'Thêm khoản thu dự kiến mới'}
                  </span>
                  <span className="text-[11px] text-[#869699]">
                    Quy đổi dòng tiền hàng tháng để tự động chia các hũ
                  </span>
                </div>
                <button
                  onClick={() => setShowIncomeModal(false)}
                  className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveIncomeSource} className="space-y-3.5">
                {/* Tên nguồn thu */}
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Tên khoản thu *
                  </label>
                  <input
                    type="text"
                    value={sourceName}
                    onChange={(e) => setSourceName(e.target.value)}
                    placeholder="VD: Lương chính, Tiền thuê nhà, Thưởng..."
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                  />
                  {/* Gợi ý nhanh */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pt-2 no-scrollbar">
                    {['Lương chính', 'Thưởng KPI', 'Freelance / Làm thêm', 'Cho thuê nhà', 'Cổ tức / Đầu tư'].map(chip => (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setSourceName(chip)}
                        className="px-2.5 py-1 rounded-lg bg-[#243033] hover:bg-[#2C3B3F] text-[10.5px] text-[#C5D5D8] shrink-0 border border-[#8BA5AA]/15 active:scale-95"
                      >
                        {chip}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Số tiền (CurrencyInput với chip) */}
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Số tiền dự kiến nhận *
                  </label>
                  <CurrencyInput
                    value={sourceAmount}
                    onChange={setSourceAmount}
                    autoFocus={!editingSourceId}
                    className="text-lg font-bold"
                  />
                </div>

                {/* Chu kỳ nhận (Recurrence selector với auto division) */}
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Thời gian nhận / Chu kỳ *
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {RECURRENCE_PRESETS.map((preset) => {
                      const isSelected = sourceRecurrence === preset.label;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setSourceRecurrence(preset.label)}
                          className={`p-2 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'bg-[#1D2926] border-[#8CC7AE] text-[#8CC7AE]'
                              : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#C4D0D2] hover:bg-[#253235]'
                          }`}
                        >
                          <div className="text-xs font-semibold">{preset.label}</div>
                          <div className="text-[9.5px] opacity-75">{preset.hint}</div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Hiển thị kết quả quy đổi hàng tháng tự động */}
                  {sourceAmount > 0 && !isMonthly && (
                    <div className="mt-2 p-2.5 bg-[#12191B] rounded-xl border border-[#8CC7AE]/20 flex items-center justify-between text-xs">
                      <span className="text-[#869699]">Tự động chia thành:</span>
                      <span className="font-bold text-[#8CC7AE] num">
                        ~{formatVND(convertedMonthly)} / tháng
                      </span>
                    </div>
                  )}
                </div>

                {/* Loại nguồn thu */}
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Phân loại nguồn thu
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'fixed', label: 'Cố định' },
                      { id: 'irregular', label: 'Không đều' },
                      { id: 'passive', label: 'Thụ động' }
                    ].map(k => (
                      <button
                        key={k.id}
                        type="button"
                        onClick={() => setSourceKind(k.id as any)}
                        className={`py-2 rounded-xl text-xs font-semibold border transition-all ${
                          sourceKind === k.id
                            ? 'bg-[#657D81]/30 border-[#8CC7AE] text-[#8CC7AE]'
                            : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#869699]'
                        }`}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Nút hành động */}
                <div className="flex items-center gap-2 pt-2">
                  {editingSourceId && (
                    <button
                      type="button"
                      onClick={() => {
                        const sid = editingSourceId;
                        setConfirmSheet({
                          isOpen: true,
                          title: 'Xóa khoản thu',
                          description: `Anh có chắc muốn xóa khoản thu "${sourceName}" không?`,
                          isDanger: true,
                          onConfirm: () => {
                            onDeleteIncomeSource(sid);
                            setShowIncomeModal(false);
                          }
                        });
                      }}
                      className="px-3.5 py-3 rounded-2xl bg-[#282121] hover:bg-[#3B2525] text-[#E06D6D] text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-transform"
                    >
                      <Trash2 size={14} /> Xóa
                    </button>
                  )}

                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-2xl bg-[#8CC7AE] hover:bg-[#9ED4BC] text-[#0E1314] font-bold text-xs shadow-md active:scale-98 transition-transform"
                  >
                    {editingSourceId ? 'Cập nhật khoản thu' : 'Lưu khoản thu mới'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ===================================================================== */}
      {/* MODAL 2: THÊM / SỬA KHOẢN CHI DỰ KIẾN                                 */}
      {/* ===================================================================== */}
      {showPlannedExpModal && (() => {
        const convertedExpMonthly = normalizeToMonthlyAmount(expAmount, expRecurrence);
        const isExpMonthly = expRecurrence === 'Hàng tháng';

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
            <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-base font-bold text-[#F2F5F5] block">
                    {editingExpId ? 'Chỉnh sửa khoản chi dự kiến' : 'Thêm khoản chi dự kiến'}
                  </span>
                  <span className="text-[11px] text-[#869699]">
                    Lên kế hoạch các chi phí định kỳ hoặc khoản chi lớn
                  </span>
                </div>
                <button
                  onClick={() => setShowPlannedExpModal(false)}
                  className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSavePlannedExp} className="space-y-3.5">
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Tên khoản chi *
                  </label>
                  <input
                    type="text"
                    value={expName}
                    onChange={(e) => setExpName(e.target.value)}
                    placeholder="VD: Tiền thuê nhà, Tiền học phí, Bảo hiểm..."
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#DEB48A]/50"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Số tiền dự kiến *
                  </label>
                  <CurrencyInput
                    value={expAmount}
                    onChange={setExpAmount}
                    autoFocus={!editingExpId}
                    className="text-lg font-bold"
                  />
                </div>

                {/* Chu kỳ khoản chi dự kiến (L-06) */}
                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1 flex items-center gap-1">
                    <Calendar size={11} /> Chu kỳ chi tiêu *
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {RECURRENCE_PRESETS.map((preset) => {
                      const isSelected = expRecurrence === preset.label;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setExpRecurrence(preset.label)}
                          className={`p-2 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'bg-[#2D221B] border-[#DEB48A] text-[#DEB48A]'
                              : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#C4D0D2] hover:bg-[#253235]'
                          }`}
                        >
                          <div className="text-xs font-semibold">{preset.label}</div>
                          <div className="text-[9.5px] opacity-75">{preset.hint}</div>
                        </button>
                      );
                    })}
                  </div>

                  {expAmount > 0 && !isExpMonthly && (
                    <div className="mt-2 p-2.5 bg-[#12191B] rounded-xl border border-[#DEB48A]/25 flex items-center justify-between text-xs">
                      <span className="text-[#869699]">Tự động quy đổi hàng tháng:</span>
                      <span className="font-bold text-[#DEB48A] num">
                        ~{formatVND(convertedExpMonthly)} / tháng
                      </span>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Gắn vào Hũ chi tiêu *
                  </label>
                  <select
                    value={expJarCode}
                    onChange={(e) => setExpJarCode(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#DEB48A]/50"
                  >
                    {jars.map(j => (
                      <option key={j.id} value={j.code} className="bg-[#161C1E] text-white">
                        Hũ {j.name} ({Math.round(j.targetPercent * 100)}%)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  {editingExpId && (
                    <button
                      type="button"
                      onClick={() => {
                        const eid = editingExpId;
                        setConfirmSheet({
                          isOpen: true,
                          title: 'Xóa khoản chi dự kiến',
                          description: `Anh có chắc muốn xóa khoản chi "${expName}" không?`,
                          isDanger: true,
                          onConfirm: () => {
                            onDeletePlannedExpense(eid);
                            setShowPlannedExpModal(false);
                          }
                        });
                      }}
                      className="px-3.5 py-3 rounded-2xl bg-[#282121] hover:bg-[#3B2525] text-[#E06D6D] text-xs font-semibold flex items-center gap-1.5 active:scale-95"
                    >
                      <Trash2 size={14} /> Xóa
                    </button>
                  )}

                  <button
                    type="submit"
                    className="flex-1 py-3 rounded-2xl bg-[#DEB48A] hover:bg-[#E5BE97] text-[#0E1314] font-bold text-xs shadow active:scale-98"
                  >
                    {editingExpId ? 'Cập nhật khoản chi' : 'Lưu khoản chi'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* ===================================================================== */}
      {/* MODAL 3: CHỈNH SỬA / XÓA 1 HŨ                                         */}
      {/* ===================================================================== */}
      {selectedJarForEdit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">
                  Chỉnh sửa Hũ: {selectedJarForEdit.name}
                </span>
                <span className="text-[11px] text-[#869699]">
                  Tự động đồng bộ sang cả 2 tab Dự kiến & Thực tế
                </span>
              </div>
              <button
                onClick={() => setSelectedJarForEdit(null)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEditJar} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tên hũ
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Hạn mức chi tiêu hàng tháng
                </label>
                <CurrencyInput
                  value={editLimit}
                  onChange={setEditLimit}
                  className="text-base font-bold"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tỷ lệ phần trăm dự kiến (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editPercentStr}
                  onChange={(e) => setEditPercentStr(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Màu đại diện
                </label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setEditColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        editColor === c ? 'scale-110 border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Hũ chi tiêu mặc định khi duyệt nhanh (L-13) */}
              <button
                type="button"
                onClick={() => setEditIsDefault(!editIsDefault)}
                className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
                  editIsDefault
                    ? 'bg-[#2D221B] border-[#DEB48A]/50 text-[#DEB48A]'
                    : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#97A8AB]'
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Star size={14} className={editIsDefault ? 'text-[#DEB48A] fill-[#DEB48A]' : 'text-[#869699]'} />
                  Đặt làm hũ mặc định khi duyệt chi nhanh
                </span>
                <span className="text-[10.5px] font-bold">
                  {editIsDefault ? 'Đang bật' : 'Tắt'}
                </span>
              </button>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const jid = selectedJarForEdit.id;
                    const jname = selectedJarForEdit.name;
                    setConfirmSheet({
                      isOpen: true,
                      title: 'Xóa Hũ chi tiêu',
                      description: `Anh có chắc muốn xóa "${jname}" không? Thao tác này sẽ xóa hũ ở cả 2 tab Dự kiến & Thực tế.`,
                      isDanger: true,
                      onConfirm: async () => {
                        await onDeleteJar(jid);
                        setSelectedJarForEdit(null);
                      }
                    });
                  }}
                  className="px-3.5 py-3 rounded-2xl bg-[#282121] hover:bg-[#3B2525] text-[#E06D6D] text-xs font-semibold flex items-center gap-1.5 active:scale-95"
                >
                  <Trash2 size={14} /> Xóa hũ
                </button>

                <button
                  type="submit"
                  className="flex-1 py-3 rounded-2xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] font-bold text-xs shadow active:scale-98"
                >
                  Lưu thay đổi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: THÊM HŨ MỚI                                                  */}
      {/* ===================================================================== */}
      {showAddJarModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">Thêm Hũ Chi Tiêu Mới</span>
                <span className="text-[11px] text-[#869699]">
                  Tự động xuất hiện ở cả 2 tab Dự kiến & Thực tế
                </span>
              </div>
              <button
                onClick={() => setShowAddJarModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateNewJar} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tên hũ chi tiêu *
                </label>
                <input
                  type="text"
                  value={newJarName}
                  onChange={(e) => setNewJarName(e.target.value)}
                  placeholder="VD: Chi tiêu con cái, Du lịch, Quỹ hưu trí..."
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Tỷ lệ phần trăm dự kiến (%)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={newJarPercentStr}
                  onChange={(e) => setNewJarPercentStr(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Hạn mức hàng tháng (₫)
                </label>
                <CurrencyInput
                  value={newJarLimit}
                  onChange={setNewJarLimit}
                  className="text-base font-bold"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Màu đại diện
                </label>
                <div className="flex items-center gap-2">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewJarColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        newJarColor === c ? 'scale-110 border-white' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Hũ chi tiêu mặc định khi duyệt nhanh (L-13) */}
              <button
                type="button"
                onClick={() => setNewJarIsDefault(!newJarIsDefault)}
                className={`w-full p-3 rounded-xl border flex items-center justify-between text-left transition-all ${
                  newJarIsDefault
                    ? 'bg-[#2D221B] border-[#DEB48A]/50 text-[#DEB48A]'
                    : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#97A8AB]'
                }`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <Star size={14} className={newJarIsDefault ? 'text-[#DEB48A] fill-[#DEB48A]' : 'text-[#869699]'} />
                  Đặt làm hũ mặc định khi duyệt chi nhanh
                </span>
                <span className="text-[10.5px] font-bold">
                  {newJarIsDefault ? 'Đang bật' : 'Tắt'}
                </span>
              </button>

              <button
                type="submit"
                className="w-full py-3 rounded-2xl bg-[#8CC7AE] hover:bg-[#9ED4BC] text-[#0E1314] font-bold text-xs shadow active:scale-98 transition-transform mt-2"
              >
                Tạo hũ mới
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: CÂN BẰNG TỶ LỆ HŨ SAO CHO TỔNG = 100%                        */}
      {/* ===================================================================== */}
      {showBalanceModal && (() => {
        const sum = Object.values(draftPercents).reduce((a, b) => a + b, 0);
        const isValid = sum === 100;

        return (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
            <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-base font-bold text-[#F2F5F5] block">Cân bằng tỷ lệ Hũ</span>
                  <span className="text-[11px] text-[#869699]">
                    Tổng tỷ lệ các hũ phải đúng <b>100%</b>
                  </span>
                </div>
                <button
                  onClick={() => setShowBalanceModal(false)}
                  className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-2.5">
                {jars.map(j => {
                  const val = draftPercents[j.id] || 0;
                  return (
                    <div key={j.id} className="bg-[#20292B] p-3 rounded-xl border border-[#8BA5AA]/15 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: j.color || '#657D81' }}></span>
                        <span className="text-xs font-semibold text-[#F2F5F5]">{j.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="100"
                          value={val}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10) || 0;
                            setDraftPercents(prev => ({ ...prev, [j.id]: n }));
                          }}
                          className="w-16 bg-[#161C1E] border border-[#8BA5AA]/25 rounded-lg px-2 py-1 text-xs text-right text-[#F2F5F5] font-bold num focus:outline-none focus:border-[#8CC7AE]"
                        />
                        <span className="text-xs text-[#869699]">%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`p-3 rounded-xl border flex items-center justify-between text-xs font-bold ${
                isValid ? 'bg-[#1D2926] border-[#8CC7AE]/40 text-[#8CC7AE]' : 'bg-[#2D221B] border-[#D4A373]/40 text-[#DEB48A]'
              }`}>
                <span>Tổng tỷ lệ:</span>
                <span className="num text-sm">{sum}% / 100%</span>
              </div>

              <button
                type="button"
                disabled={!isValid}
                onClick={handleSaveDraftPercents}
                className="w-full py-3 rounded-2xl bg-[#657D81] disabled:opacity-40 text-[#F2F5F5] font-bold text-xs shadow active:scale-98 transition-transform"
              >
                Lưu tỷ lệ & Phân bổ lại hạn mức
              </button>
            </div>
          </div>
        );
      })()}

      {/* Confirm Bottom Sheet */}
      <ConfirmSheet
        isOpen={confirmSheet.isOpen}
        title={confirmSheet.title}
        description={confirmSheet.description}
        isDanger={confirmSheet.isDanger}
        onConfirm={() => {
          confirmSheet.onConfirm();
          setConfirmSheet(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmSheet(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
