import React, { useState } from 'react';
import { Jar, IncomeSource } from '../types';
import { formatVND } from '../mockData';
import { Sparkles, Check, Edit2, X, Settings2, Trash2, Plus, AlertCircle, Palette } from 'lucide-react';

interface BudgetViewProps {
  jars: Jar[];
  incomeSources: IncomeSource[];
  onAddIncomeSource: (source: IncomeSource) => void;
  onDeleteIncomeSource: (id: string) => void;
  onAddJar: (newJar: { name: string; code?: string; targetPercent: number; monthlyLimit: number; color?: string }) => Promise<void>;
  onUpdateJar: (jarId: string, updates: { name?: string; targetPercent?: number; monthlyLimit?: number; color?: string }) => Promise<void>;
  onDeleteJar: (jarId: string) => Promise<void>;
  onAutoAllocateJars: (totalIncome: number) => Promise<void>;
}

const PRESET_COLORS = [
  '#657D81', '#8CC7AE', '#D4A373', '#95B0B4', '#E07A5F', '#A288E3', '#E29578', '#4EA8DE'
];

export const BudgetView: React.FC<BudgetViewProps> = ({
  jars,
  incomeSources,
  onAddIncomeSource,
  onDeleteIncomeSource,
  onAddJar,
  onUpdateJar,
  onDeleteJar,
  onAutoAllocateJars
}) => {
  const [allocatedSuccess, setAllocatedSuccess] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [showAddJarModal, setShowAddJarModal] = useState(false);

  // State chỉnh sửa hũ
  const [selectedJarForEdit, setSelectedJarForEdit] = useState<Jar | null>(null);
  const [editName, setEditName] = useState('');
  const [editLimitStr, setEditLimitStr] = useState('');
  const [editPercentStr, setEditPercentStr] = useState('10');
  const [editColor, setEditColor] = useState('#657D81');
  const [isDeletingJar, setIsDeletingJar] = useState(false);

  // State thêm hũ mới
  const [newJarName, setNewJarName] = useState('');
  const [newJarPercentStr, setNewJarPercentStr] = useState('10');
  const [newJarLimitStr, setNewJarLimitStr] = useState('');
  const [newJarColor, setNewJarColor] = useState('#8CC7AE');

  // Form thêm nguồn thu
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceKind, setNewSourceKind] = useState<'fixed' | 'irregular' | 'passive'>('fixed');
  const [newSourceAmount, setNewSourceAmount] = useState('');
  const [newSourceRecurrence, setNewSourceRecurrence] = useState('Hàng tháng');

  const totalExpectedIncome = incomeSources.reduce((sum, s) => sum + s.expectedAmount, 0);
  const totalLimit = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalSpent = jars.reduce((sum, j) => sum + j.spentThisMonth, 0);
  const remaining = totalLimit - totalSpent;

  const totalTargetPercent = Math.round(jars.reduce((sum, j) => sum + (j.targetPercent * 100), 0));

  const handleSimulateAllocation = async () => {
    if (totalExpectedIncome <= 0) {
      alert('Vui lòng thêm ít nhất 1 nguồn thu nhập ở mục "Nguồn thu" để chia hũ tự động nhé anh!');
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
    const pct = parseFloat(editPercentStr) / 100 || 0;

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
    const pct = (parseFloat(newJarPercentStr) || 10) / 100;

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
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[20px] font-bold text-[#F2F5F5]">Ngân sách</span>
          <div className="text-xs text-[#869699] mt-0.5">
            {jars.length} hũ chi tiêu · Còn lại <b className="num text-[#F2F5F5]">{formatVND(remaining > 0 ? remaining : 0)}</b>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowIncomeModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#657D81]/25 text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95 transition-transform"
          >
            <Settings2 size={13} /> Nguồn thu ({incomeSources.length})
          </button>
        </div>
      </div>

      {/* Income Sources & 1-Click Allocation Card */}
      <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-5 shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
              Nguồn thu tháng 11 ({incomeSources.length} nguồn)
            </div>
            <div className="num text-[23px] font-bold text-[#F2F5F5] mt-0.5">
              {formatVND(totalExpectedIncome)}
            </div>
          </div>
          <button
            onClick={handleSimulateAllocation}
            className="px-3.5 py-2 rounded-xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
          >
            {allocatedSuccess ? <Check size={14} className="text-[#8CC7AE]" /> : <Sparkles size={14} className="text-[#DEB48A]" />}
            {allocatedSuccess ? 'Đã chia hũ!' : 'Chia hũ theo %'}
          </button>
        </div>

        {/* Breakdown bar */}
        {totalExpectedIncome > 0 ? (
          <>
            <div className="flex gap-1 h-2 rounded-full overflow-hidden my-3">
              {incomeSources.map((s, idx) => {
                const pct = (s.expectedAmount / totalExpectedIncome) * 100;
                const colors = ['#95B0B4', '#657D81', '#445659', '#7A9599', '#B0C0C3'];
                return (
                  <div
                    key={s.id}
                    className="h-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: colors[idx % colors.length] }}
                    title={`${s.name} (${pct.toFixed(0)}%)`}
                  ></div>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#869699]">
              {incomeSources.map((s) => (
                <span key={s.id}>
                  {s.name}: <b className="text-[#D5E1E3] num">{formatVND(s.expectedAmount)}</b>
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-[#869699] my-2.5">
            Chưa thiết lập nguồn thu nào. Anh bấm <strong>"Nguồn thu"</strong> góc trên để thêm thu nhập thực tế nhé.
          </div>
        )}
      </div>

      {/* Jars List Header & Add Button */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#869699] uppercase tracking-wider">
            Các hũ chi tiêu ({jars.length})
          </span>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
            totalTargetPercent === 100
              ? 'bg-[#8CC7AE]/10 text-[#8CC7AE] border-[#8CC7AE]/25'
              : 'bg-[#D4A373]/10 text-[#D4A373] border-[#D4A373]/25'
          }`}>
            Tổng %: {totalTargetPercent}%
          </span>
        </div>
        <button
          onClick={() => setShowAddJarModal(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 active:scale-95 transition-transform"
        >
          <Plus size={13} /> Thêm hũ
        </button>
      </div>

      {/* Jars Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {jars.map((jar) => {
          const pct = jar.monthlyLimit > 0
            ? Math.min(100, Math.round((jar.spentThisMonth / jar.monthlyLimit) * 100))
            : 0;
          const remainingAmount = jar.monthlyLimit - jar.spentThisMonth;
          const isWarn = pct >= 90;
          const targetPct = Math.round((jar.targetPercent || 0) * 100);

          return (
            <div
              key={jar.id}
              onClick={() => handleOpenEditJar(jar)}
              className={`bg-[#1C2426]/75 border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer active:scale-98 transition-transform hover:border-[#8BA5AA]/30 ${
                isWarn ? 'border-[#D4A373]/35' : 'border-[#8BA5AA]/12'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#F2F5F5] truncate max-w-[100px]">{jar.name}</span>
                <span
                  className="num text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#232E31] text-[#BFD0D3] border border-[#8BA5AA]/20"
                >
                  {targetPct}%
                </span>
              </div>

              <div className="num text-[16px] font-bold text-[#F2F5F5]">
                {formatVND(remainingAmount > 0 ? remainingAmount : 0)}
              </div>
              <div className="text-[11px] text-[#869699] num mt-0.5 flex items-center justify-between">
                <span>Hạn mức {formatVND(jar.monthlyLimit)}</span>
                <Edit2 size={11} className="text-[#869699] ml-1 opacity-70 shrink-0" />
              </div>

              <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden mt-2.5">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${pct}%`, backgroundColor: jar.color || '#657D81' }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL 1: Quản lý Nguồn thu */}
      {showIncomeModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">Tùy biến Nguồn thu</span>
              <button
                onClick={() => setShowIncomeModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            {/* List current sources */}
            <div className="space-y-2">
              {incomeSources.length === 0 ? (
                <div className="text-center py-6 text-xs text-[#869699] bg-[#1C2426]/50 rounded-2xl border border-[#8BA5AA]/10">
                  Chưa có nguồn thu nào. Anh nhập nguồn thu thực tế ở bên dưới để thêm nhé!
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
                        title="Xóa nguồn thu này"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Form add new source */}
            <form onSubmit={handleCreateIncomeSource} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">Thêm nguồn thu mới</span>
              <input
                type="text"
                placeholder="Tên nguồn thu (VD: Lương, Cổ tức, Bán hàng...)"
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
                  placeholder="Chu kỳ (VD: Hàng tháng)"
                  value={newSourceRecurrence}
                  onChange={(e) => setNewSourceRecurrence(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <input
                type="text"
                placeholder="Số tiền dự kiến mỗi kỳ (₫)"
                value={newSourceAmount}
                onChange={(e) => setNewSourceAmount(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow active:scale-98 transition-transform"
              >
                + Thêm nguồn thu
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
              {/* Tên hũ */}
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

              {/* Hạn mức & Tỷ lệ % */}
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
                    Tỷ lệ mục tiêu (%)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={editPercentStr}
                    onChange={(e) => setEditPercentStr(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs font-bold num text-[#F2F5F5] focus:outline-none"
                  />
                </div>
              </div>

              {/* Màu sắc hũ */}
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

                {/* Nút xóa hũ */}
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
                    Hạn mức ban đầu (₫)
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
