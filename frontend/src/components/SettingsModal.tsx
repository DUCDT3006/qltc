import React, { useState } from 'react';
import { X, ShieldCheck, Eye, EyeOff, Download, Plus, Landmark, Smartphone, RefreshCw } from 'lucide-react';
import { BankAccount } from '../types';
import { formatVND } from '../mockData';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  onAddAccount: (acc: BankAccount) => void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  onSimulateNotification: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onAddAccount,
  privacyMode,
  onTogglePrivacy,
  onSimulateNotification
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [bankCode, setBankCode] = useState('VCB');
  const [mask, setMask] = useState('');
  const [balanceStr, setBalanceStr] = useState('');

  if (!isOpen) return null;

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const balance = parseInt(balanceStr.replace(/[^\d]/g, ''), 10) || 0;

    onAddAccount({
      id: `acc_${Date.now()}`,
      name: name.trim(),
      bankCode,
      accountNumberMask: mask.slice(-4) || '9999',
      balance,
      type: 'bank'
    });

    setName('');
    setMask('');
    setBalanceStr('');
    setShowAddForm(false);
  };

  const handleExportData = () => {
    const data = {
      accounts,
      exportedAt: new Date().toISOString(),
      app: 'QLTC'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qltc_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-[#F2F5F5]">Tài khoản & Cài đặt</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        {/* Android Notification Listener Service Status */}
        <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-[#8CC7AE]" />
              <span className="text-xs font-semibold text-[#F2F5F5]">Đọc thông báo Android</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#7EB89E]/20 text-[#8CC7AE] border border-[#7EB89E]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8CC7AE] animate-ping"></span>
              Đang hoạt động
            </span>
          </div>
          <div className="text-[11px] text-[#869699]">
            Lắng nghe thông báo biến động số dư từ Vietcombank, MB, Techcombank, ACB, TPBank, VPBank... và tự lọc mã OTP.
          </div>
          <button
            onClick={() => {
              onSimulateNotification();
              onClose();
            }}
            className="w-full py-2 rounded-xl bg-[#657D81]/25 hover:bg-[#657D81]/40 border border-[#8BA5AA]/25 text-xs font-semibold text-[#D5E1E3] flex items-center justify-center gap-1.5 active:scale-98 transition-transform mt-1"
          >
            <RefreshCw size={13} /> Thử bắn 1 thông báo ngân hàng giả lập
          </button>
        </div>

        {/* Quick Options */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onTogglePrivacy}
            className="p-3 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center gap-2 text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
          >
            {privacyMode ? <EyeOff size={16} className="text-[#DEB48A]" /> : <Eye size={16} />}
            {privacyMode ? 'Đang ẩn số dư' : 'Hiện số dư'}
          </button>
          <button
            onClick={handleExportData}
            className="p-3 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center gap-2 text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
          >
            <Download size={16} /> Sao lưu dữ liệu
          </button>
        </div>

        {/* Bank Accounts Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
              Tài khoản & Ví ngân hàng ({accounts.length})
            </span>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="text-xs font-semibold text-[#8CC7AE] flex items-center gap-1"
            >
              <Plus size={14} /> Thêm tài khoản
            </button>
          </div>

          {showAddForm && (
            <form onSubmit={handleCreateAccount} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3 mb-2 space-y-2">
              <input
                type="text"
                placeholder="Tên tài khoản (VD: VCB Lương, TPBank chi tiêu...)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]"
                >
                  <option value="VCB">Vietcombank</option>
                  <option value="MB">MB Bank</option>
                  <option value="TCB">Techcombank</option>
                  <option value="ACB">ACB</option>
                  <option value="TPB">TPBank</option>
                  <option value="VPB">VPBank</option>
                  <option value="CASH">Tiền mặt</option>
                </select>
                <input
                  type="text"
                  placeholder="4 số cuối (VD: 0071)"
                  maxLength={4}
                  value={mask}
                  onChange={(e) => setMask(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <input
                type="text"
                placeholder="Số dư ban đầu (₫)"
                value={balanceStr}
                onChange={(e) => setBalanceStr(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold"
              >
                Lưu tài khoản
              </button>
            </form>
          )}

          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-2xl p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#232E31] border border-[#8BA5AA]/18 flex items-center justify-center font-bold text-xs text-[#BFD0D3]">
                    {acc.bankCode || 'CASH'}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#F2F5F5]">{acc.name}</div>
                    <div className="text-[10px] text-[#869699]">
                      {acc.accountNumberMask ? `*${acc.accountNumberMask}` : 'Ví tiền mặt'}
                    </div>
                  </div>
                </div>
                <div className="text-right num text-xs font-semibold text-[#D5E1E3]">
                  {privacyMode ? '•••••• ₫' : formatVND(acc.balance)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#869699] pt-2">
          <ShieldCheck size={14} className="text-[#8CC7AE]" />
          Dữ liệu mã hóa cục bộ · 100% riêng tư
        </div>
      </div>
    </div>
  );
};
