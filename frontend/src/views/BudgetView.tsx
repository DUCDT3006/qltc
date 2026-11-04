import React, { useState } from 'react';
import { Jar, IncomeSource } from '../types';
import { formatVND } from '../mockData';
import { Sparkles, Check, Plus, Edit2, X, Settings2 } from 'lucide-react';

interface BudgetViewProps {
  jars: Jar[];
  incomeSources: IncomeSource[];
  onAddIncomeSource: (source: IncomeSource) => void;
  onUpdateJarLimit: (jarId: string, limit: number) => void;
}

export const BudgetView: React.FC<BudgetViewProps> = ({
  jars,
  incomeSources,
  onAddIncomeSource,
  onUpdateJarLimit
}) => {
  const [allocatedSuccess, setAllocatedSuccess] = useState(false);
  const [showIncomeModal, setShowIncomeModal] = useState(false);
  const [selectedJarForEdit, setSelectedJarForEdit] = useState<Jar | null>(null);
  const [editLimitStr, setEditLimitStr] = useState('');

  // Form thêm nguồn thu
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceKind, setNewSourceKind] = useState<'fixed' | 'irregular' | 'passive'>('fixed');
  const [newSourceAmount, setNewSourceAmount] = useState('');
  const [newSourceRecurrence, setNewSourceRecurrence] = useState('Hàng tháng');

  const totalExpectedIncome = incomeSources.reduce((sum, s) => sum + s.expectedAmount, 0);
  const totalLimit = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalSpent = jars.reduce((sum, j) => sum + j.spentThisMonth, 0);
  const remaining = totalLimit - totalSpent;

  const handleSimulateAllocation = () => {
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

  const handleSaveJarLimit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedJarForEdit) return;
    const limit = parseInt(editLimitStr.replace(/[^\d]/g, ''), 10);
    if (!isNaN(limit) && limit >= 0) {
      onUpdateJarLimit(selectedJarForEdit.id, limit);
    }
    setSelectedJarForEdit(null);
  };

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[20px] font-bold text-[#F2F5F5]">Ngân sách</span>
          <div className="text-xs text-[#869699] mt-0.5">
            6 hũ chi tiêu · Còn lại <b className="num text-[#F2F5F5]">{formatVND(remaining)}</b>
          </div>
        </div>
        <button
          onClick={() => setShowIncomeModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#657D81]/25 text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95"
        >
          <Settings2 size={13} /> Nguồn thu ({incomeSources.length})
        </button>
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
            className="px-3.5 py-2 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
          >
            {allocatedSuccess ? <Check size={14} /> : <Sparkles size={14} />}
            {allocatedSuccess ? 'Đã chia hũ!' : 'Chia hũ'}
          </button>
        </div>

        {/* Breakdown bar */}
        <div className="flex gap-1 h-2 rounded-full overflow-hidden my-3">
          {incomeSources.map((s, idx) => {
            const pct = totalExpectedIncome > 0 ? (s.expectedAmount / totalExpectedIncome) * 100 : 0;
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
      </div>

      {/* 6 Jars Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {jars.map((jar) => {
          const pct = Math.min(100, Math.round((jar.spentThisMonth / jar.monthlyLimit) * 100));
          const remainingAmount = jar.monthlyLimit - jar.spentThisMonth;
          const isWarn = jar.code === 'PLAY' || pct >= 90;

          return (
            <div
              key={jar.id}
              onClick={() => {
                setSelectedJarForEdit(jar);
                setEditLimitStr(new Intl.NumberFormat('vi-VN').format(jar.monthlyLimit));
              }}
              className={`bg-[#1C2426]/75 border rounded-2xl p-3.5 flex flex-col justify-between cursor-pointer active:scale-98 transition-transform ${
                isWarn ? 'border-[#D4A373]/35' : 'border-[#8BA5AA]/12'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#F2F5F5]">{jar.name}</span>
                <span
                  className={`num text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    isWarn
                      ? 'bg-[#D4A373]/20 text-[#DEB48A]'
                      : 'bg-[#657D81]/20 text-[#BFD0D3]'
                  }`}
                >
                  {isWarn ? `còn ${100 - pct}%` : `${pct}%`}
                </span>
              </div>

              <div className="num text-[16px] font-bold text-[#F2F5F5]">
                {formatVND(remainingAmount > 0 ? remainingAmount : 0)}
              </div>
              <div className="text-[11px] text-[#869699] num mt-0.5 flex items-center justify-between">
                <span>{jar.code === 'FFA' ? 'Đã chuyển Đầu tư' : `Hạn mức ${formatVND(jar.monthlyLimit)}`}</span>
                <Edit2 size={11} className="text-[#869699] ml-1 opacity-70" />
              </div>

              <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden mt-2.5">
                <div
                  className={`h-full rounded-full ${
                    isWarn ? 'bg-[#D4A373]' : jar.code === 'FFA' ? 'bg-[#8CC7AE]' : 'bg-[#657D81]'
                  }`}
                  style={{ width: `${pct}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Upcoming recurring bills */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-2xl p-3.5 flex items-center justify-between text-xs">
        <span className="text-[#869699]">
          Định kỳ sắp tới · <b className="text-[#F2F5F5]">Tiền thuê nhà (05/11)</b>
        </span>
        <span className="num font-semibold text-[#C4D0D2]">−6.000.000 ₫</span>
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
              {incomeSources.map((s) => (
                <div key={s.id} className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-2xl p-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-[#F2F5F5]">{s.name}</div>
                    <div className="text-[10.5px] text-[#869699]">
                      {s.recurrence} · {s.kind === 'fixed' ? 'Cố định' : s.kind === 'passive' ? 'Thụ động' : 'Không đều'}
                    </div>
                  </div>
                  <div className="num text-xs font-bold text-[#8CC7AE]">
                    {formatVND(s.expectedAmount)}
                  </div>
                </div>
              ))}
            </div>

            {/* Form add new source */}
            <form onSubmit={handleCreateIncomeSource} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5">
              <span className="text-xs font-bold text-[#F2F5F5] block">Thêm nguồn thu mới</span>
              <input
                type="text"
                placeholder="Tên nguồn thu (VD: Cổ tức, Bán hàng Shopee...)"
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
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow"
              >
                + Thêm nguồn thu
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Chỉnh sửa hạn mức Hũ */}
      {selectedJarForEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-[#161C1E] border border-[#8BA5AA]/25 rounded-3xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#F2F5F5]">
                Hạn mức {selectedJarForEdit.name}
              </span>
              <button
                onClick={() => setSelectedJarForEdit(null)}
                className="w-7 h-7 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={handleSaveJarLimit} className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Hạn mức tháng mới (₫)
                </label>
                <input
                  type="text"
                  autoFocus
                  value={editLimitStr}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^\d]/g, '');
                    setEditLimitStr(raw ? new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)) : '');
                  }}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2.5 text-base font-bold num text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow active:scale-98"
              >
                Lưu hạn mức
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
