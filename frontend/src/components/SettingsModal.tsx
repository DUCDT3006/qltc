import React, { useState, useEffect } from 'react';
import { X, ShieldCheck, Eye, EyeOff, Download, Plus, Smartphone, RefreshCw, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { BankAccount } from '../types';
import { formatVND } from '../mockData';

interface RawLog {
  id: string;
  package_name: string;
  title: string;
  raw_body: string;
  bank_code: string | null;
  is_parsed: number;
  parse_error: string | null;
  received_at: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  onAddAccount: (acc: BankAccount) => void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  onSimulateNotification: () => void;
  onReprocessSuccess?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onAddAccount,
  privacyMode,
  onTogglePrivacy,
  onSimulateNotification,
  onReprocessSuccess
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [bankCode, setBankCode] = useState('VCB');
  const [mask, setMask] = useState('');
  const [balanceStr, setBalanceStr] = useState('');

  // Logs state
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessMsg, setReprocessMsg] = useState('');

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('https://qltc-backend.dtd-store.workers.dev/api/notifications/recent?limit=25');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.notifications || []);
      }
    } catch (e) {
      console.error('Lỗi tải logs:', e);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isOpen && showLogs) {
      fetchLogs();
    }
  }, [isOpen, showLogs]);

  const handleReprocess = async () => {
    setIsReprocessing(true);
    setReprocessMsg('');
    try {
      const res = await fetch('https://qltc-backend.dtd-store.workers.dev/api/notifications/reprocess', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setReprocessMsg(`Đã xử lý xong: ${data.parsedCount} giao dịch mới được bóc tách thành công!`);
        await fetchLogs();
        if (onReprocessSuccess) onReprocessSuccess();
      } else {
        setReprocessMsg('Không có thông báo mới cần xử lý.');
      }
    } catch {
      setReprocessMsg('Lỗi kết nối tới máy chủ.');
    } finally {
      setIsReprocessing(false);
    }
  };

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
      <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-[#F2F5F5]">Tài khoản & Cài đặt</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
        </div>

        {/* Android Notification Listener Service Status Card */}
        <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-[#8CC7AE]" />
              <span className="text-xs font-semibold text-[#F2F5F5]">Tự động đọc thông báo Android</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#7EB89E]/20 text-[#8CC7AE] border border-[#7EB89E]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8CC7AE] animate-ping"></span>
              Đang hoạt động
            </span>
          </div>

          <div className="text-[11.5px] text-[#869699] leading-relaxed">
            Hỗ trợ Vietcombank, Techcombank, HDBank, MB, ACB, TPBank, VPBank, BIDV, Cake, SMS... và tự động lọc bỏ OTP an toàn tuyệt đối.
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) fetchLogs();
              }}
              className="py-2 px-3 rounded-xl bg-[#232E31] border border-[#8BA5AA]/20 text-[11px] font-semibold text-[#BFD0D3] flex items-center justify-center gap-1 active:scale-95 transition-transform"
            >
              {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showLogs ? 'Đóng nhật ký' : 'Xem nhật ký app'}
            </button>

            <button
              onClick={handleReprocess}
              disabled={isReprocessing}
              className="py-2 px-3 rounded-xl bg-[#657D81]/30 hover:bg-[#657D81]/40 border border-[#8BA5AA]/30 text-[11px] font-semibold text-[#8CC7AE] flex items-center justify-center gap-1 active:scale-95 transition-transform"
            >
              <RefreshCw size={13} className={isReprocessing ? 'animate-spin' : ''} />
              {isReprocessing ? 'Đang bóc tách...' : 'Bóc tách lại'}
            </button>
          </div>

          {reprocessMsg && (
            <div className="text-[11px] text-[#8CC7AE] bg-[#8CC7AE]/10 border border-[#8CC7AE]/20 rounded-lg p-2 text-center animate-fade-in">
              {reprocessMsg}
            </div>
          )}

          {/* Collapsible Real-time Notification Logs */}
          {showLogs && (
            <div className="mt-2 pt-2 border-t border-[#8BA5AA]/15 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span>Các thông báo ngân hàng gửi tới máy chủ:</span>
                <button onClick={fetchLogs} className="text-[#8CC7AE] flex items-center gap-1">
                  <RefreshCw size={11} className={isLoadingLogs ? 'animate-spin' : ''} /> Tải lại
                </button>
              </div>

              {isLoadingLogs ? (
                <div className="text-center py-4 text-xs text-[#869699]">Đang tải dữ liệu...</div>
              ) : logs.length === 0 ? (
                <div className="text-center py-3 text-xs text-[#869699]">Chưa có thông báo nào được gửi lên.</div>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2.5 rounded-xl border ${
                        log.is_parsed
                          ? 'bg-[#182322] border-[#8CC7AE]/25'
                          : 'bg-[#231F20] border-[#D4A373]/25'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="text-[#F2F5F5] truncate max-w-[200px]">
                          {log.bank_code ? `${log.bank_code} · ` : ''}{log.title || log.package_name}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-[10px] ${log.is_parsed ? 'text-[#8CC7AE]' : 'text-[#D4A373]'}`}>
                          {log.is_parsed ? (
                            <>
                              <CheckCircle2 size={12} /> Đã nhận diện
                            </>
                          ) : (
                            <>
                              <AlertCircle size={12} /> Bỏ qua
                            </>
                          )}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#869699] line-clamp-2 mt-0.5 whitespace-pre-line">
                        {log.raw_body}
                      </div>
                      <div className="text-[9.5px] text-[#5A686B] mt-1">
                        {log.received_at} · {log.package_name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                placeholder="Tên tài khoản (VD: Techcombank, HDBank...)"
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
                  <option value="TCB">Techcombank</option>
                  <option value="HDBank">HDBank</option>
                  <option value="MB">MB Bank</option>
                  <option value="ACB">ACB</option>
                  <option value="TPB">TPBank</option>
                  <option value="VPB">VPBank</option>
                  <option value="BIDV">BIDV</option>
                  <option value="CASH">Tiền mặt</option>
                </select>
                <input
                  type="text"
                  placeholder="4 số cuối (VD: 9737)"
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
          Dữ liệu mã hóa · 100% riêng tư & An toàn tuyệt đối
        </div>
      </div>
    </div>
  );
};
