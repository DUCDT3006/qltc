import React, { useState } from 'react';
import { X, RotateCcw, AlertTriangle, CheckCircle2, DollarSign, Wallet, TrendingUp, Trash2, Edit3, Save } from 'lucide-react';
import { BankAccount, Holding } from '../types';
import { formatVND } from '../mockData';

const API_BASE = 'https://qltc-backend.dtd-store.workers.dev/api';

interface ResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  holdings: Holding[];
  onRefreshAll: () => Promise<void>;
}

export const ResetModal: React.FC<ResetModalProps> = ({
  isOpen,
  onClose,
  accounts,
  holdings,
  onRefreshAll
}) => {
  const [activeTab, setActiveTab] = useState<'reset' | 'accounts' | 'holdings'>('reset');
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // State chỉnh sửa số dư tài khoản
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [editBalanceStr, setEditBalanceStr] = useState('');

  // State thêm tài sản đầu tư
  const [newSymbol, setNewSymbol] = useState('');
  const [newName, setNewName] = useState('');
  const [newClass, setNewClass] = useState<'stock' | 'fund' | 'crypto' | 'gold'>('stock');
  const [newQty, setNewQty] = useState('');
  const [newAvgCost, setNewAvgCost] = useState('');
  const [newPrice, setNewPrice] = useState('');

  if (!isOpen) return null;

  // Xử lý Reset dữ liệu
  const handleReset = async (scope: 'transactions' | 'balances' | 'holdings' | 'all') => {
    const confirmText =
      scope === 'transactions'
        ? 'Anh có chắc muốn XÓA SẠCH toàn bộ giao dịch (cả chờ duyệt và lịch sử)?'
        : scope === 'all'
        ? 'Anh có chắc muốn ĐẶT LẠI TOÀN BỘ về 0 (Xóa giao dịch, số dư về 0, xóa tài sản đầu tư mẫu)?'
        : 'Anh có chắc muốn thực hiện thao tác này?';

    if (!window.confirm(confirmText)) return;

    setIsProcessing(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_BASE}/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, clearNotifications: scope === 'all' })
      });

      const data = await res.json();
      if (data.success) {
        setMessage({ text: 'Đã thiết lập lại dữ liệu thành công!', type: 'success' });
        await onRefreshAll();
      } else {
        setMessage({ text: 'Không thể reset: ' + data.message, type: 'error' });
      }
    } catch {
      setMessage({ text: 'Lỗi kết nối tới máy chủ.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Cập nhật số dư tài khoản
  const handleSaveAccountBalance = async (accId: string) => {
    const rawVal = editBalanceStr.replace(/[^\d]/g, '');
    const num = parseInt(rawVal, 10);
    if (isNaN(num)) return;

    setIsProcessing(true);
    try {
      const res = await fetch(`${API_BASE}/accounts/${accId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ balance: num })
      });
      if (res.ok) {
        setEditingAccId(null);
        await onRefreshAll();
        setMessage({ text: 'Đã cập nhật số dư tài khoản thành công!', type: 'success' });
      }
    } catch {
      setMessage({ text: 'Lỗi kết nối khi cập nhật số dư.', type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  };

  // Xóa tài khoản
  const handleDeleteAccount = async (accId: string, accName: string) => {
    if (!window.confirm(`Anh có chắc muốn xóa tài khoản "${accName}" không?`)) return;
    try {
      await fetch(`${API_BASE}/accounts/${accId}`, { method: 'DELETE' });
      await onRefreshAll();
      setMessage({ text: `Đã xóa tài khoản "${accName}".`, type: 'success' });
    } catch {
      setMessage({ text: 'Lỗi khi xóa tài khoản.', type: 'error' });
    }
  };

  // Thêm tài sản đầu tư mới
  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSymbol.trim()) return;

    const qty = parseFloat(newQty) || 0;
    const cost = parseFloat(newAvgCost.replace(/[^\d]/g, '')) || 0;
    const price = parseFloat(newPrice.replace(/[^\d]/g, '')) || cost;

    try {
      await fetch(`${API_BASE}/holdings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: newSymbol.trim().toUpperCase(),
          name: newName.trim() || newSymbol.trim().toUpperCase(),
          assetClass: newClass,
          quantity: qty,
          avgCost: cost,
          currentPrice: price
        })
      });

      setNewSymbol('');
      setNewName('');
      setNewQty('');
      setNewAvgCost('');
      setNewPrice('');
      await onRefreshAll();
      setMessage({ text: 'Đã thêm tài sản đầu tư thành công!', type: 'success' });
    } catch {
      setMessage({ text: 'Lỗi khi lưu tài sản đầu tư.', type: 'error' });
    }
  };

  // Xóa tài sản đầu tư
  const handleDeleteHolding = async (holdingId: string, symbol: string) => {
    if (!window.confirm(`Xóa tài sản ${symbol} khỏi danh mục?`)) return;
    try {
      await fetch(`${API_BASE}/holdings/${holdingId}`, { method: 'DELETE' });
      await onRefreshAll();
      setMessage({ text: `Đã xóa tài sản ${symbol}.`, type: 'success' });
    } catch {
      setMessage({ text: 'Lỗi khi xóa tài sản.', type: 'error' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#657D81]/25 flex items-center justify-center text-[#8CC7AE]">
              <RotateCcw size={16} />
            </div>
            <div>
              <span className="text-base font-bold text-[#F2F5F5] block">Thiết lập lại tài chính</span>
              <span className="text-[11px] text-[#869699]">Đặt lại tài sản và thu chi theo thực tế của anh</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-1 rounded-xl bg-[#0E1314] border border-[#8BA5AA]/15 gap-1">
          <button
            onClick={() => setActiveTab('reset')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'reset' ? 'bg-[#657D81] text-[#F2F5F5]' : 'text-[#869699]'
            }`}
          >
            Đặt lại (Reset)
          </button>
          <button
            onClick={() => setActiveTab('accounts')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'accounts' ? 'bg-[#657D81] text-[#F2F5F5]' : 'text-[#869699]'
            }`}
          >
            Số dư tài khoản
          </button>
          <button
            onClick={() => setActiveTab('holdings')}
            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'holdings' ? 'bg-[#657D81] text-[#F2F5F5]' : 'text-[#869699]'
            }`}
          >
            Tài sản đầu tư
          </button>
        </div>

        {/* Notification message */}
        {message && (
          <div
            className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/25'
                : 'bg-[#D4A373]/15 text-[#D4A373] border border-[#D4A373]/25'
            }`}
          >
            {message.type === 'success' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
            <span>{message.text}</span>
          </div>
        )}

        {/* TAB 1: RESET DỮ LIỆU */}
        {activeTab === 'reset' && (
          <div className="space-y-3">
            <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#657D81]/20 text-[#D5E1E3] mt-0.5">
                  <DollarSign size={18} />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-[#F2F5F5]">1. Xóa sạch lịch sử giao dịch</div>
                  <div className="text-[11px] text-[#869699] mt-0.5 leading-relaxed">
                    Xóa toàn bộ các giao dịch mẫu & giao dịch thử nghiệm. Đưa số tiền đã tiêu trong tháng của 6 hũ về 0đ để bắt đầu theo dõi thu chi mới.
                  </div>
                </div>
              </div>
              <button
                disabled={isProcessing}
                onClick={() => handleReset('transactions')}
                className="w-full py-2.5 rounded-xl bg-[#283538] hover:bg-[#344448] text-xs font-semibold text-[#F2F5F5] border border-[#8BA5AA]/25 active:scale-98 transition-transform"
              >
                {isProcessing ? 'Đang xử lý...' : 'Xóa sạch tất cả giao dịch'}
              </button>
            </div>

            <div className="bg-[#241C1C] border border-[#E06D6D]/20 rounded-2xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-[#E06D6D]/20 text-[#E06D6D] mt-0.5">
                  <AlertTriangle size={18} />
                </div>
                <div className="flex-1">
                  <div className="text-xs font-bold text-[#F2F5F5]">2. Đặt lại toàn bộ về 0 (Khởi tạo từ đầu)</div>
                  <div className="text-[11px] text-[#A88C8C] mt-0.5 leading-relaxed">
                    Xóa toàn bộ giao dịch, đặt số dư các tài khoản về 0đ và xóa toàn bộ tài sản đầu tư mẫu để anh tự nhập tình hình tài chính thực tế từ đầu.
                  </div>
                </div>
              </div>
              <button
                disabled={isProcessing}
                onClick={() => handleReset('all')}
                className="w-full py-2.5 rounded-xl bg-[#522525] hover:bg-[#682E2E] text-xs font-semibold text-[#FFBEBE] border border-[#E06D6D]/30 active:scale-98 transition-transform"
              >
                {isProcessing ? 'Đang xử lý...' : 'Đặt lại toàn bộ sổ tài chính về 0'}
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: ĐẶT SỐ DƯ TÀI KHOẢN THỰC TẾ */}
        {activeTab === 'accounts' && (
          <div className="space-y-2.5">
            <div className="text-[11px] text-[#869699] px-1">
              Nhập số dư hiện có thực tế của từng tài khoản/thẻ để ứng dụng tính toán chuẩn xác tài sản ròng:
            </div>

            <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3 flex flex-col gap-2"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-[#232E31] border border-[#8BA5AA]/20 flex items-center justify-center font-bold text-[10px] text-[#BFD0D3]">
                        {acc.bankCode || 'CASH'}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-[#F2F5F5]">{acc.name}</div>
                        <div className="text-[10px] text-[#869699]">
                          {acc.accountNumberMask ? `*${acc.accountNumberMask}` : 'Ví tiền mặt'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {editingAccId !== acc.id && (
                        <div className="text-right">
                          <div className="text-xs font-bold text-[#8CC7AE] num">{formatVND(acc.balance)}</div>
                          <button
                            onClick={() => {
                              setEditingAccId(acc.id);
                              setEditBalanceStr(acc.balance.toString());
                            }}
                            className="text-[10px] text-[#869699] hover:text-[#D5E1E3] flex items-center gap-1 justify-end ml-auto"
                          >
                            <Edit3 size={11} /> Sửa số dư
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => handleDeleteAccount(acc.id, acc.name)}
                        className="w-7 h-7 rounded-lg bg-[#282121] text-[#E06D6D] flex items-center justify-center active:scale-90 transition-transform ml-1"
                        title="Xóa tài khoản"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {editingAccId === acc.id && (
                    <div className="flex items-center gap-2 pt-2 border-t border-[#8BA5AA]/10 animate-fade-in">
                      <input
                        type="text"
                        placeholder="Nhập số dư thực tế (₫)"
                        value={editBalanceStr}
                        onChange={(e) => setEditBalanceStr(e.target.value)}
                        className="flex-1 bg-[#121617] border border-[#8BA5AA]/25 rounded-xl px-3 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                      />
                      <button
                        onClick={() => handleSaveAccountBalance(acc.id)}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold flex items-center gap-1 active:scale-95 transition-transform"
                      >
                        <Save size={13} /> Lưu
                      </button>
                      <button
                        onClick={() => setEditingAccId(null)}
                        className="px-2 py-1.5 rounded-xl bg-[#232D30] text-[#869699] text-xs"
                      >
                        Hủy
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: TÀI SẢN ĐẦU TƯ THỰC TẾ */}
        {activeTab === 'holdings' && (
          <div className="space-y-3">
            {/* Form thêm tài sản */}
            <form onSubmit={handleAddHolding} className="bg-[#1C2426] border border-[#8BA5AA]/20 rounded-2xl p-3 space-y-2">
              <span className="text-[11px] font-bold text-[#F2F5F5] block">Thêm tài sản đầu tư thực tế</span>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Mã (VD: HPG, BTC, SJC...)"
                  value={newSymbol}
                  onChange={(e) => setNewSymbol(e.target.value)}
                  className="bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-3 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                />
                <select
                  value={newClass}
                  onChange={(e) => setNewClass(e.target.value as any)}
                  className="bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-2 py-1.5 text-xs text-[#F2F5F5]"
                >
                  <option value="stock">Cổ phiếu</option>
                  <option value="fund">Chứng chỉ quỹ</option>
                  <option value="crypto">Tiền mã hóa (Crypto)</option>
                  <option value="gold">Vàng</option>
                </select>
              </div>

              <input
                type="text"
                placeholder="Tên tài sản (VD: Tập đoàn Hòa Phát)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-3 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
              />

              <div className="grid grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Số lượng"
                  value={newQty}
                  onChange={(e) => setNewQty(e.target.value)}
                  className="bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-2 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Giá vốn (₫)"
                  value={newAvgCost}
                  onChange={(e) => setNewAvgCost(e.target.value)}
                  className="bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-2 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="Giá hiện tại (₫)"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  className="bg-[#121617] border border-[#8BA5AA]/20 rounded-xl px-2 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold active:scale-98 transition-transform"
              >
                + Thêm vào danh mục đầu tư
              </button>
            </form>

            {/* Danh sách tài sản hiện có */}
            <div className="space-y-1.5 max-h-[35vh] overflow-y-auto pr-1">
              <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block">
                Danh mục hiện tại ({holdings.length})
              </span>
              {holdings.map((h) => (
                <div
                  key={h.symbol}
                  className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-xl p-2.5 flex items-center justify-between text-xs"
                >
                  <div>
                    <div className="font-bold text-[#F2F5F5] flex items-center gap-1.5">
                      <span>{h.symbol}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#232E31] text-[#869699] font-normal">
                        {h.assetClass}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#869699]">
                      {h.quantity} x {formatVND(h.currentPrice)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[#8CC7AE] num">
                      {formatVND(h.quantity * h.currentPrice)}
                    </span>
                    <button
                      onClick={() => handleDeleteHolding(h.symbol, h.symbol)}
                      className="w-6 h-6 rounded bg-[#282121] text-[#E06D6D] flex items-center justify-center active:scale-90"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
