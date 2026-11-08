import React, { useState, useEffect } from 'react';
import { X, ArrowDownRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { Jar, BankAccount, IncomeSource } from '../types';
import { CurrencyInput } from './CurrencyInput';

interface QuickAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  jars: Jar[];
  incomeSources?: IncomeSource[];
  accounts: BankAccount[];
  initialType?: 'expense' | 'income' | 'transfer';
  onAddTransaction: (txn: {
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    incomeSourceId?: string;
    accountId: string;
    toAccountId?: string;
  }) => void;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
  isOpen,
  onClose,
  jars,
  incomeSources = [],
  accounts,
  initialType = 'expense',
  onAddTransaction
}) => {
  const [type, setType] = useState<'expense' | 'income' | 'transfer'>(initialType);
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState<string>('');
  const [selectedJarId, setSelectedJarId] = useState<string>('');
  const [selectedIncomeSourceId, setSelectedIncomeSourceId] = useState<string>('');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Đồng bộ type, hũ mặc định (isDefault) và tài khoản khi mở modal hoặc khi dữ liệu từ D1 tải xong
  useEffect(() => {
    if (isOpen) {
      setType(initialType);
      setErrorMsg('');
    }
  }, [isOpen, initialType]);

  useEffect(() => {
    if (!selectedJarId || !jars.some(j => j.id === selectedJarId)) {
      const defJar = jars.find(j => j.isDefault) || jars[0];
      if (defJar) setSelectedJarId(defJar.id);
    }
  }, [jars, selectedJarId, isOpen]);

  useEffect(() => {
    if (!selectedAccountId || !accounts.some(a => a.id === selectedAccountId)) {
      if (accounts[0]) setSelectedAccountId(accounts[0].id);
    }
    if (!toAccountId || toAccountId === selectedAccountId || !accounts.some(a => a.id === toAccountId)) {
      const alt = accounts.find(a => a.id !== (selectedAccountId || accounts[0]?.id));
      if (alt) setToAccountId(alt.id);
    }
  }, [accounts, selectedAccountId, toAccountId, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || amount <= 0) {
      setErrorMsg('Vui lòng nhập số tiền lớn hơn 0 ₫');
      return;
    }
    if (!description.trim()) {
      setErrorMsg('Vui lòng nhập nội dung giao dịch');
      return;
    }
    if (type === 'transfer') {
      if (!toAccountId || toAccountId === selectedAccountId) {
        setErrorMsg('Vui lòng chọn tài khoản đích khác với tài khoản nguồn');
        return;
      }
    }

    onAddTransaction({
      type,
      amount,
      description: description.trim(),
      jarId: type === 'expense' ? selectedJarId : undefined,
      incomeSourceId: type === 'income' && selectedIncomeSourceId ? selectedIncomeSourceId : undefined,
      accountId: selectedAccountId || accounts[0]?.id || 'acc_cash',
      toAccountId: type === 'transfer' ? toAccountId : undefined
    });

    setAmount(0);
    setDescription('');
    setErrorMsg('');
    onClose();
  };

  const expenseChips = ['Ăn uống', 'Tiền chợ', 'Cafe', 'Xăng xe', 'Tiền điện nước', 'Mua sắm'];
  const incomeChips = ['Lương tháng', 'Thưởng', 'Freelance', 'Tiền tip/hoa hồng', 'Bán hàng'];
  const transferChips = ['Chuyển sang tiết kiệm', 'Chuyển ví chi tiêu', 'Nạp tiền thẻ'];

  const activeChips =
    type === 'expense' ? expenseChips : type === 'income' ? incomeChips : transferChips;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full max-w-md bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-[#F2F5F5]">Ghi chép giao dịch</span>
          <button
            onClick={onClose}
            type="button"
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center hover:bg-[#2C3B3F] transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Type Selector (Chi tiêu / Thu nhập / Chuyển khoản) */}
        <div className="grid grid-cols-3 gap-2 p-1 bg-[#0E1314] rounded-2xl border border-[#8BA5AA]/10">
          <button
            type="button"
            onClick={() => {
              setType('expense');
              setErrorMsg('');
            }}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'expense'
                ? 'bg-[#E07A7A]/20 text-[#E07A7A] border border-[#E07A7A]/30 shadow'
                : 'text-[#869699] hover:text-[#D5E1E3]'
            }`}
          >
            <ArrowDownRight size={15} /> Chi tiêu
          </button>
          <button
            type="button"
            onClick={() => {
              setType('income');
              setErrorMsg('');
            }}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'income'
                ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/30 shadow font-bold'
                : 'text-[#869699] hover:text-[#D5E1E3]'
            }`}
          >
            <ArrowUpRight size={15} /> Thu nhập
          </button>
          <button
            type="button"
            onClick={() => {
              setType('transfer');
              setErrorMsg('');
            }}
            className={`py-2 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
              type === 'transfer'
                ? 'bg-[#DEB48A]/20 text-[#DEB48A] border border-[#DEB48A]/30 shadow font-bold'
                : 'text-[#869699] hover:text-[#D5E1E3]'
            }`}
          >
            <ArrowLeftRight size={15} /> Chuyển tiền
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Amount Input */}
          <div>
            <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
              Số tiền (₫) *
            </label>
            <CurrencyInput
              value={amount}
              onChange={(val) => {
                setAmount(val);
                if (errorMsg) setErrorMsg('');
              }}
              autoFocus
              className="text-xl font-bold py-3"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
              Nội dung *
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (errorMsg) setErrorMsg('');
              }}
              placeholder="VD: Cafe sáng, Tiền điện, Ăn trưa..."
              className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-2.5 text-sm text-[#F2F5F5] placeholder-[#556769] focus:outline-none focus:border-[#95B0B4]"
            />
            {/* Quick Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pt-2 no-scrollbar">
              {activeChips.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setDescription(chip)}
                  className="px-2.5 py-1 rounded-lg bg-[#243033] hover:bg-[#2C3B3F] text-[11px] text-[#C5D5D8] shrink-0 border border-[#8BA5AA]/15 active:scale-95 transition-all"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Jar Selection (Only if Expense) */}
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
                    {j.name} (còn {new Intl.NumberFormat('vi-VN').format(Math.max(0, j.monthlyLimit - j.spentThisMonth))} ₫)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Income Source Selection (Only if Income) */}
          {type === 'income' && (
            <div>
              <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                Thuộc nguồn thu nhập
              </label>
              <select
                value={selectedIncomeSourceId}
                onChange={(e) => setSelectedIncomeSourceId(e.target.value)}
                className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl px-4 py-2.5 text-sm text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]"
              >
                <option value="" className="bg-[#161C1E] text-white">
                  ✨ Thu ngoài dự kiến / Thu nhập khác
                </option>
                {incomeSources.map((src) => (
                  <option key={src.id} value={src.id} className="bg-[#161C1E] text-white">
                    {src.name} ({new Intl.NumberFormat('vi-VN').format(src.expectedAmount)} ₫ · {src.recurrence})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Account Selection */}
          {type !== 'transfer' ? (
            <div>
              <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                {type === 'income' ? 'Vào tài khoản' : 'Từ tài khoản'}
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
          ) : (
            <div className="space-y-2.5 bg-[#0E1314] p-3 rounded-2xl border border-[#8BA5AA]/15">
              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Từ tài khoản nguồn
                </label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#95B0B4]"
                >
                  {accounts.map((acc) => (
                    <option key={acc.id} value={acc.id} className="bg-[#161C1E] text-white">
                      {acc.name} ({new Intl.NumberFormat('vi-VN').format(acc.balance)} ₫)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-center text-[#869699]">
                <ArrowDownRight size={16} />
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Sang tài khoản đích
                </label>
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#95B0B4]"
                >
                  <option value="" disabled>-- Chọn tài khoản đích --</option>
                  {accounts.map((acc) => (
                    <option
                      key={acc.id}
                      value={acc.id}
                      disabled={acc.id === selectedAccountId}
                      className="bg-[#161C1E] text-white disabled:opacity-40"
                    >
                      {acc.name} ({new Intl.NumberFormat('vi-VN').format(acc.balance)} ₫)
                      {acc.id === selectedAccountId ? ' (Trùng nguồn)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {errorMsg && (
            <p className="text-xs text-[#E07A7A] font-semibold text-center py-1">
              {errorMsg}
            </p>
          )}

          {/* Submit button */}
          <button
            type="submit"
            className="w-full py-3 rounded-2xl bg-[#657D81] hover:bg-[#748F94] text-[#F2F5F5] font-bold text-sm shadow-lg active:scale-[0.98] transition-transform mt-2"
          >
            Lưu giao dịch
          </button>
        </form>
      </div>
    </div>
  );
};
