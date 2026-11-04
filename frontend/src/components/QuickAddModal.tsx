import React, { useState } from 'react';
import { X, ArrowDownRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { Jar, BankAccount } from '../types';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  jars: Jar[];
  accounts: BankAccount[];
  onAddTransaction: (txn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    accountId: string;
  }) => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  jars,
  accounts,
  onAddTransaction
}) => {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [amountStr, setAmountStr] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [selectedJarId, setSelectedJarId] = useState<string>(jars[0]?.id || '');
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || '');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseInt(amountStr.replace(/[^\d]/g, ''), 10);
    if (!amount || amount <= 0 || !description.trim()) return;

    onAddTransaction({
      type,
      amount,
      description: description.trim(),
      jarId: type === 'expense' ? selectedJarId : undefined,
      accountId: selectedAccountId
    });

    setAmountStr('');
    setDescription('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-[#F2F5F5]">Ghi chép giao dịch</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Type Selector (Chi tiêu / Thu nhập / Chuyển khoản) */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-[#0E1314] rounded-2xl border border-[#8BA5AA]/10">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'expense'
                ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                : 'text-[#869699]'
            }`}
          >
            <ArrowDownRight size={15} /> Chi tiêu
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'income'
                ? 'bg-[#8CC7AE] text-[#0E1314] font-bold shadow'
                : 'text-[#869699]'
            }`}
          >
            <ArrowUpRight size={15} /> Thu nhập
          </button>
          <button
            type="button"
            onClick={() => setType('transfer')}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'transfer'
                ? 'bg-[#3E4F52] text-[#F2F5F5] shadow'
                : 'text-[#869699]'
            }`}
          >
            <ArrowLeftRight size={15} /> Chuyển tiền
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Amount Input */}
          <div>
            <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
              Số tiền (₫)
            </label>
            <input
              type="text"
              autoFocus
              value={amountStr}
              onChange={(e) => {
                const raw = e.target.value.replace(/[^\d]/g, '');
                if (!raw) {
                  setAmountStr('');
                } else {
                  setAmountStr(new Intl.NumberFormat('vi-VN').format(parseInt(raw, 10)));
                }
              }}
              placeholder="0 ₫"
              className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-3 text-2xl font-bold num text-[#F2F5F5] placeholder-[#556769] focus:outline-none focus:border-[#95B0B4]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
              Nội dung
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="VD: Cafe sáng, Tiền điện thoại, Ăn trưa..."
              className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-2.5 text-sm text-[#F2F5F5] placeholder-[#556769] focus:outline-none focus:border-[#95B0B4]"
            />
          </div>

          {/* Jar Selection if expense */}
          {type === 'expense' && (
            <div>
              <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                Phân bổ vào Hũ
              </label>
              <select
                value={selectedJarId}
                onChange={(e) => setSelectedJarId(e.target.value)}
                className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-2.5 text-sm text-[#F2F5F5] focus:outline-none focus:border-[#95B0B4]"
              >
                {jars.map((j) => (
                  <option key={j.id} value={j.id} className="bg-[#161C1E] text-white">
                    {j.name} (còn {new Intl.NumberFormat('vi-VN').format(j.monthlyLimit - j.spentThisMonth)} ₫)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Account Selection */}
          <div>
            <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
              Tài khoản / Ví
            </label>
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-2.5 text-sm text-[#F2F5F5] focus:outline-none focus:border-[#95B0B4]"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} className="bg-[#161C1E] text-white">
                  {acc.name} ({new Intl.NumberFormat('vi-VN').format(acc.balance)} ₫)
                </option>
              ))}
            </select>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-[#657D81] text-[#F2F5F5] font-bold text-sm shadow-lg active:scale-[0.98] transition-transform mt-2"
          >
            Lưu giao dịch
          </button>
        </form>
      </div>
    </div>
  );
};
