import React, { useState, useMemo } from 'react';
import { Jar, Transaction } from '../types';
import { formatVND } from '../utils/financeMath';
import { isTxnInPeriod, getVietnamDate } from '../utils/dateUtils';
import {
  X,
  Edit2,
  Plus,
  ArrowDownRight,
  ArrowUpRight,
  Receipt,
  Calendar,
  AlertTriangle,
  Star,
  CheckCircle2,
  Wallet
} from 'lucide-react';

interface JarDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  jar: Jar | null;
  transactions: Transaction[];
  privacyMode?: boolean;
  onEditJar?: (jar: Jar) => void;
  onQuickAddExpense?: (jarId: string) => void;
}

export const JarDetailModal: React.FC<JarDetailModalProps> = ({
  isOpen,
  onClose,
  jar,
  transactions,
  privacyMode = false,
  onEditJar,
  onQuickAddExpense
}) => {
  const [filterPeriod, setFilterPeriod] = useState<'month' | 'all'>('month');

  const nowVN = useMemo(() => getVietnamDate(), []);

  // Lọc các giao dịch chi tiêu thuộc hũ này
  const jarTransactions = useMemo(() => {
    if (!jar) return [];

    return transactions.filter(t => {
      // 1. Chỉ các khoản chi tiêu (expense) mới thuộc hũ chi tiêu!
      if (t.type !== 'expense') return false;

      // 2. Không hiển thị các chân phụ đã ẩn
      if (t.status === 'paired_hidden') return false;

      // 3. Khớp chính xác theo jarId hoặc theo suggestedJarCode
      const isMatchJar = t.jarId ? t.jarId === jar.id : t.suggestedJarCode === jar.code;
      if (!isMatchJar) return false;

      if (filterPeriod === 'month') {
        return isTxnInPeriod(t.occurredAtIso || t.occurredAt, 'month', {
          year: nowVN.getFullYear(),
          month: nowVN.getMonth() + 1
        });
      }
      return true;
    });
  }, [jar, transactions, filterPeriod, nowVN]);

  if (!isOpen || !jar) return null;

  // Tính tổng chi tiêu của hũ
  const totalExpense = jarTransactions.reduce((s, t) => s + t.amount, 0);

  const remaining = jar.monthlyLimit - totalExpense;
  const pctUsed = jar.monthlyLimit > 0
    ? Math.round((totalExpense / jar.monthlyLimit) * 100)
    : 0;
  const isOverBudget = pctUsed > 100;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[88vh] bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl flex flex-col no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#8BA5AA]/15">
          <div className="flex items-center gap-2.5">
            <span
              className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
              style={{ backgroundColor: jar.color || '#657D81' }}
            />
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-bold text-[#F2F5F5]">{jar.name}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#20292B] text-[#95B0B4] border border-[#8BA5AA]/20 uppercase">
                  {jar.code}
                </span>
                {jar.isDefault && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[#DEB48A]/15 text-[#DEB48A] border border-[#DEB48A]/30 flex items-center gap-0.5">
                    <Star size={9} fill="#DEB48A" /> Mặc định
                  </span>
                )}
              </div>
              <span className="text-[11px] text-[#869699]">
                Tỷ trọng mục tiêu: <b className="text-[#8CC7AE]">{Math.round((jar.targetPercent || 0) * 100)}%</b>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onEditJar && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditJar(jar);
                }}
                className="w-8 h-8 rounded-full bg-[#20292B] text-[#D5E1E3] hover:text-[#8CC7AE] flex items-center justify-center active:scale-90 transition-transform border border-[#8BA5AA]/15"
                title="Chỉnh sửa hũ này"
              >
                <Edit2 size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90 transition-transform"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Hero Card Thống kê hũ */}
        <div className="my-3.5 p-3.5 rounded-2xl bg-gradient-to-br from-[#202A2C] to-[#141A1C] border border-[#8BA5AA]/20 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#869699] font-medium flex items-center gap-1">
              <Receipt size={12} />
              {filterPeriod === 'month' ? `Đã chi Tháng ${nowVN.getMonth() + 1}` : 'Tổng đã chi'}
            </span>
            <span
              className={`num text-[11px] font-bold px-2 py-0.5 rounded-full ${
                isOverBudget
                  ? 'bg-[#E07A5F]/20 text-[#E07A5F] border border-[#E07A5F]/35'
                  : 'bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/25'
              }`}
            >
              Đã tiêu {pctUsed}%
            </span>
          </div>

          <div className="flex items-baseline justify-between">
            <div className="num text-[24px] font-bold text-[#F2F5F5]">
              {privacyMode ? '••••••' : formatVND(totalExpense)}
            </div>
            <div className="text-right">
              <span className="text-[10px] text-[#869699] block">Hạn mức tháng</span>
              <span className="num text-xs font-semibold text-[#D5E1E3]">
                {privacyMode ? '••••••' : formatVND(jar.monthlyLimit)}
              </span>
            </div>
          </div>

          {/* Thanh tiến trình */}
          <div className="h-2 rounded-full bg-[#161C1E] overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, pctUsed)}%`,
                backgroundColor: isOverBudget ? '#E07A5F' : (jar.color || '#8CC7AE')
              }}
            />
          </div>

          {/* Dòng tóm tắt còn lại */}
          <div className="flex items-center justify-between text-[11px] pt-0.5">
            <span className="text-[#869699]">
              {remaining >= 0 ? 'Còn lại trong hạn mức:' : 'Vượt hạn mức:'}
            </span>
            <span className={`num font-bold ${remaining >= 0 ? 'text-[#8CC7AE]' : 'text-[#E07A5F]'}`}>
              {privacyMode ? '••••••' : formatVND(Math.abs(remaining))}
            </span>
          </div>
        </div>

        {/* Thanh công cụ: Bộ lọc kỳ & Nút Thêm chi tiêu */}
        <div className="flex items-center justify-between pb-2">
          {/* Bộ lọc kỳ */}
          <div className="flex items-center gap-1 bg-[#12181A] p-0.5 rounded-xl border border-[#8BA5AA]/15">
            <button
              type="button"
              onClick={() => setFilterPeriod('month')}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold transition-colors ${
                filterPeriod === 'month'
                  ? 'bg-[#657D81] text-[#F2F5F5]'
                  : 'text-[#869699] hover:text-[#D5E1E3]'
              }`}
            >
              Tháng {nowVN.getMonth() + 1}
            </button>
            <button
              type="button"
              onClick={() => setFilterPeriod('all')}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold transition-colors ${
                filterPeriod === 'all'
                  ? 'bg-[#657D81] text-[#F2F5F5]'
                  : 'text-[#869699] hover:text-[#D5E1E3]'
              }`}
            >
              Tất cả ({transactions.filter(t => t.type === 'expense' && t.status !== 'paired_hidden' && (t.jarId ? t.jarId === jar.id : t.suggestedJarCode === jar.code)).length})
            </button>
          </div>

          {/* Nút Ghi nhanh chi tiêu */}
          {onQuickAddExpense && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onQuickAddExpense(jar.id);
              }}
              className="px-2.5 py-1 rounded-xl bg-[#202A2C] hover:bg-[#283538] text-[#DEB48A] border border-[#DEB48A]/30 text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={12} />
              Ghi chi tiêu
            </button>
          )}
        </div>

        {/* Danh sách các khoản chi tiêu đã ghi nhận */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 no-scrollbar min-h-[160px] max-h-[360px]">
          {jarTransactions.length > 0 ? (
            jarTransactions.map((txn) => {
              return (
                <div
                  key={txn.id}
                  className="p-3 rounded-2xl bg-[#1C2426]/75 border border-[#8BA5AA]/12 flex items-center justify-between gap-3 hover:bg-[#20292B] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-[#E07A7A]/15 text-[#E07A7A]">
                      <ArrowDownRight size={16} />
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                        {txn.description || 'Giao dịch không tên'}
                      </div>
                      <div className="text-[10px] text-[#869699] flex items-center gap-1.5 mt-0.5">
                        <span>{txn.occurredAt}</span>
                        <span>·</span>
                        <span className="truncate max-w-[120px] text-[#A7BDC1]">
                          {txn.accountName || txn.bankCode || 'Tài khoản'}
                        </span>
                        {txn.suggestedCategory && (
                          <>
                            <span>·</span>
                            <span className="truncate text-[#869699]">{txn.suggestedCategory}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="num text-xs font-bold text-[#F2F5F5]">
                      {privacyMode ? '••••' : `−${formatVND(txn.amount)}`}
                    </div>
                    {txn.status === 'confirmed' && (
                      <span className="text-[9.5px] text-[#8CC7AE] flex items-center justify-end gap-0.5 mt-0.5">
                        <CheckCircle2 size={9} /> Đã duyệt
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-8 text-center space-y-2">
              <div className="w-10 h-10 rounded-full bg-[#20292B] text-[#869699] flex items-center justify-center mx-auto">
                <Receipt size={18} />
              </div>
              <div className="text-xs text-[#869699]">
                Chưa có khoản thu chi nào được ghi nhận cho hũ <b>{jar.name}</b> {filterPeriod === 'month' ? 'trong tháng này' : ''}.
              </div>
              {onQuickAddExpense && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onQuickAddExpense(jar.id);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 text-xs font-semibold active:scale-95 transition-all mt-1"
                >
                  <Plus size={13} />
                  Ghi chép giao dịch ngay
                </button>
              )}
            </div>
          )}
        </div>

        {/* Nút đóng */}
        <div className="pt-3 border-t border-[#8BA5AA]/15 mt-auto">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-[#232D30] hover:bg-[#2C3B3F] text-[#D5E1E3] font-semibold text-xs transition-colors active:scale-98"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
