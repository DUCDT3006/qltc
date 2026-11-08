import React, { useState, useMemo } from 'react';
import { BankAccount } from '../types';
import { findBankByCode, generateVietQrUrl } from '../utils/vietnamBanks';
import { formatVND } from '../utils/financeMath';
import { CurrencyInput } from './CurrencyInput';
import {
  X,
  Copy,
  Check,
  Download,
  Building2,
  User,
  CreditCard,
  MapPin,
  Share2,
  ExternalLink,
  Edit2
} from 'lucide-react';

interface AccountQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  account: BankAccount | null;
  onEditAccount?: (account: BankAccount) => void;
}

export const AccountQrModal: React.FC<AccountQrModalProps> = ({
  isOpen,
  onClose,
  account,
  onEditAccount
}) => {
  const [amount, setAmount] = useState<number>(0);
  const [description, setDescription] = useState<string>('');
  const [copiedType, setCopiedType] = useState<'number' | 'full' | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const bank = useMemo(() => {
    if (!account?.bankCode) return undefined;
    return findBankByCode(account.bankCode);
  }, [account?.bankCode]);

  // Số tài khoản thực tế (ưu tiên accountNumber, fallback accountNumberMask)
  const realAccountNumber = account?.accountNumber || account?.accountNumberMask || '';
  const isMaskOnly = !account?.accountNumber && Boolean(account?.accountNumberMask);

  // Đường link ảnh VietQR
  const qrUrl = useMemo(() => {
    if (!account || !account.bankCode || !realAccountNumber) return '';
    return generateVietQrUrl({
      binOrBankCode: account.bankBin || bank?.bin || account.bankCode,
      accountNumber: realAccountNumber,
      accountHolder: account.accountHolder,
      amount: amount > 0 ? amount : undefined,
      description: description.trim() || undefined,
      template: 'compact2'
    });
  }, [account, bank, realAccountNumber, amount, description]);

  if (!isOpen || !account) return null;

  // Sao chép chỉ số tài khoản
  const handleCopyNumber = () => {
    if (!realAccountNumber) return;
    navigator.clipboard.writeText(realAccountNumber);
    setCopiedType('number');
    setTimeout(() => setCopiedType(null), 2500);
  };

  // Sao chép toàn bộ thông tin tài khoản chuyển khoản
  const handleCopyFullInfo = () => {
    const lines = [
      `🏦 NGÂN HÀNG: ${bank?.shortName || account.bankCode || 'Ngân hàng'} (${bank?.name || ''})`,
      `💳 SỐ TÀI KHOẢN: ${realAccountNumber}`,
      account.accountHolder ? `👤 CHỦ TÀI KHOẢN: ${account.accountHolder.toUpperCase()}` : '',
      account.branch ? `📍 CHI NHÁNH: ${account.branch}` : '',
      amount > 0 ? `💰 SỐ TIỀN: ${formatVND(amount)}` : '',
      description.trim() ? `📝 NỘI DUNG CK: ${description.trim()}` : ''
    ].filter(Boolean);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedType('full');
    setTimeout(() => setCopiedType(null), 2500);
  };

  // Tải ảnh QR về máy
  const handleDownloadQr = async () => {
    if (!qrUrl) return;
    setIsDownloading(true);
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `VietQR_${bank?.shortName || account.bankCode}_${realAccountNumber}.png`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }, 500);
    } catch (err) {
      console.error('Lỗi tải ảnh QR:', err);
      // Fallback mở tab mới nếu CORS bị chặn
      window.open(qrUrl, '_blank');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[90vh] flex flex-col bg-[#161C1E] border-t sm:border border-[#8BA5AA]/25 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#8BA5AA]/15 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-white p-1 flex items-center justify-center overflow-hidden shadow">
              {bank?.logo ? (
                <img src={bank.logo} alt={bank.shortName} className="w-full h-full object-contain" />
              ) : (
                <Building2 size={16} className="text-[#0E1314]" />
              )}
            </div>
            <div>
              <span className="text-base font-bold text-[#F2F5F5] block">Mã QR Chuyển Khoản</span>
              <span className="text-[11px] text-[#869699]">
                {bank?.shortName || account.bankCode || 'Ngân hàng'} · Chuẩn VietQR / Napas 247
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] hover:text-[#F2F5F5] flex items-center justify-center active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thân Modal */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
          {/* Cảnh báo nếu chỉ có 4 số cuối mask */}
          {isMaskOnly && (
            <div className="bg-[#2B2319] border border-[#DEB48A]/30 rounded-2xl p-3 flex items-start justify-between gap-3 text-xs text-[#DEB48A]">
              <div>
                <div className="font-bold">⚠️ Tài khoản chỉ có 4 số cuối (*{account.accountNumberMask})</div>
                <div className="text-[11px] text-[#C4A386] mt-0.5">
                  Anh hãy cập nhật đầy đủ số tài khoản để người khác quét mã chuyển tiền chính xác.
                </div>
              </div>
              {onEditAccount && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onEditAccount(account);
                  }}
                  className="px-2.5 py-1 rounded-xl bg-[#DEB48A] text-[#0E1314] font-bold text-xs shrink-0 active:scale-95"
                >
                  Sửa ngay
                </button>
              )}
            </div>
          )}

          {/* Khung hiển thị ảnh QR VietQR */}
          <div className="bg-gradient-to-b from-[#243135] to-[#182124] border border-[#9AB3B8]/30 rounded-3xl p-4 shadow-xl text-center space-y-3">
            {qrUrl ? (
              <div className="relative mx-auto w-64 max-w-full bg-white rounded-2xl p-2.5 shadow-lg overflow-hidden">
                <img
                  src={qrUrl}
                  alt="VietQR Code"
                  className="w-full h-auto object-contain rounded-xl"
                  loading="eager"
                />
              </div>
            ) : (
              <div className="py-12 text-center text-xs text-[#869699]">
                Chưa đủ thông tin để tạo mã QR
              </div>
            )}

            {/* Thông tin số tài khoản và chủ tài khoản bên dưới QR */}
            <div className="bg-[#12191B]/80 rounded-2xl p-3 border border-[#8BA5AA]/15 space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#869699] flex items-center gap-1">
                  <CreditCard size={12} /> Số tài khoản:
                </span>
                <span className="num text-sm font-bold text-[#8CC7AE] select-all">
                  {realAccountNumber}
                </span>
              </div>

              {account.accountHolder && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#869699] flex items-center gap-1">
                    <User size={12} /> Chủ tài khoản:
                  </span>
                  <span className="text-xs font-bold text-[#F2F5F5] uppercase">
                    {account.accountHolder}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#869699] flex items-center gap-1">
                  <Building2 size={12} /> Ngân hàng:
                </span>
                <span className="text-xs font-semibold text-[#D5E1E3]">
                  {bank?.shortName || account.bankCode} ({bank?.bin})
                </span>
              </div>

              {account.branch && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[#869699] flex items-center gap-1">
                    <MapPin size={12} /> Chi nhánh:
                  </span>
                  <span className="text-xs text-[#869699] truncate max-w-[180px]">
                    {account.branch}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Tùy chọn Số tiền & Nội dung chuyển khoản vào mã QR */}
          <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3.5 space-y-2.5">
            <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block">
              Tùy chỉnh mã QR (Không bắt buộc)
            </span>

            <div>
              <label className="text-[10.5px] text-[#869699] block mb-1">Số tiền cần chuyển (₫)</label>
              <CurrencyInput
                value={amount}
                onChange={setAmount}
                showQuickChips={false}
                placeholder="Nhập số tiền để người chuyển quét đúng số..."
                className="py-1.5 text-xs font-bold"
              />
            </div>

            <div>
              <label className="text-[10.5px] text-[#869699] block mb-1">Nội dung chuyển tiền (Lời nhắn)</label>
              <input
                type="text"
                placeholder="VD: Thanh toan tien mua hang, ung truoc..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]"
              />
            </div>
          </div>

          {/* Cụm nút hành động sao chép & tải ảnh */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={handleCopyNumber}
              className="py-2.5 px-3 rounded-2xl bg-[#232E31] hover:bg-[#2C3B3F] border border-[#8BA5AA]/25 text-xs font-bold text-[#F2F5F5] flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow"
            >
              {copiedType === 'number' ? (
                <>
                  <Check size={14} className="text-[#8CC7AE]" /> Đã chép STK
                </>
              ) : (
                <>
                  <Copy size={14} /> Chép số TK
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleCopyFullInfo}
              className="py-2.5 px-3 rounded-2xl bg-[#232E31] hover:bg-[#2C3B3F] border border-[#8BA5AA]/25 text-xs font-bold text-[#F2F5F5] flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow"
            >
              {copiedType === 'full' ? (
                <>
                  <Check size={14} className="text-[#8CC7AE]" /> Đã chép đầy đủ
                </>
              ) : (
                <>
                  <Share2 size={14} /> Chép thông tin
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleDownloadQr}
            disabled={isDownloading || !qrUrl}
            className="w-full py-2.5 rounded-2xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] text-xs font-bold flex items-center justify-center gap-2 shadow-[0_6px_16px_rgba(101,125,129,0.35)] active:scale-98 transition-transform disabled:opacity-50"
          >
            <Download size={15} /> {isDownloading ? 'Đang tải...' : 'Lưu ảnh QR về máy'}
          </button>
        </div>
      </div>
    </div>
  );
};
