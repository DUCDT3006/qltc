import React, { useState, useMemo } from 'react';
import { IncomeSource, Transaction } from '../types';
import { formatVND, normalizeToMonthlyAmount } from '../utils/financeMath';
import { isTxnInPeriod, getVietnamDate } from '../utils/dateUtils';
import { useManagedOverlay } from '../utils/overlayManager';
import {
  X,
  Edit2,
  Plus,
  ArrowUpRight,
  DollarSign,
  Receipt,
  CheckCircle2,
  Calendar,
  Sparkles
} from 'lucide-react';

interface IncomeSourceDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  incomeSource: IncomeSource | null;
  isUnassigned?: boolean;
  transactions: Transaction[];
  privacyMode?: boolean;
  periodLabel?: string;
  periodMode?: 'month' | 'quarter' | 'year' | 'all';
  periodYear?: number;
  periodMonth?: number;
  periodQuarter?: number;
  onEditSource?: (source: IncomeSource) => void;
  onQuickAddIncome?: (sourceId?: string) => void;
}

export const IncomeSourceDetailModal: React.FC<IncomeSourceDetailModalProps> = ({
  isOpen,
  onClose,
  incomeSource,
  isUnassigned = false,
  transactions,
  privacyMode = false,
  periodLabel = 'Tháng này',
  periodMode = 'month',
  periodYear,
  periodMonth,
  periodQuarter,
  onEditSource,
  onQuickAddIncome
}) => {
  const [filterPeriod, setFilterPeriod] = useState<'period' | 'all'>('period');
  const nowVN = useMemo(() => getVietnamDate(), []);

  const activeYear = periodYear || nowVN.getFullYear();
  const activeMonth = periodMonth || (nowVN.getMonth() + 1);
  const activeQuarter = periodQuarter || (Math.floor((activeMonth - 1) / 3) + 1);

  // V2-12: Tất cả các giao dịch của nguồn thu này (khớp duy nhất theo ID hoặc unassigned, TUYỆT ĐỐI không dò tên)
  const allSourceTransactions = useMemo(() => {
    if (!incomeSource && !isUnassigned) return [];

    return transactions.filter(t => {
      if (t.type !== 'income') return false;
      if (t.status === 'paired_hidden') return false;

      if (isUnassigned) {
        return !t.incomeSourceId;
      }

      return t.incomeSourceId === incomeSource!.id;
    });
  }, [incomeSource, isUnassigned, transactions]);

  // Các giao dịch theo kỳ đang chọn (kỳ hiện tại hoặc tất cả)
  const sourceTransactions = useMemo(() => {
    return allSourceTransactions.filter(t => {
      if (filterPeriod === 'period') {
        return isTxnInPeriod(t.occurredAtIso || t.occurredAt, periodMode, {
          year: activeYear,
          month: activeMonth,
          quarter: activeQuarter
        });
      }
      return true;
    });
  }, [allSourceTransactions, filterPeriod, periodMode, activeYear, activeMonth, activeQuarter]);

  const dialogProps = useManagedOverlay(
    isOpen && (Boolean(incomeSource) || isUnassigned),
    onClose,
    isUnassigned ? 'Chi tiết thu ngoài dự kiến' : `Chi tiết nguồn thu ${incomeSource?.name || ''}`
  );
  if (!isOpen || (!incomeSource && !isUnassigned)) return null;

  const totalActual = sourceTransactions.reduce((sum, t) => sum + t.amount, 0);

  const monthlyExpected = incomeSource && incomeSource.expectedAmount
    ? normalizeToMonthlyAmount(incomeSource.expectedAmount, incomeSource.recurrence)
    : 0;

  // V2-15: Khi xem "Tất cả thời gian", ẩn KPI tháng; với kỳ hữu hạn, tính chuẩn
  const isAllTime = filterPeriod === 'all';
  const hasExpected = !isAllTime && monthlyExpected > 0;
  const pctAchieved = hasExpected ? Math.round((totalActual / monthlyExpected) * 100) : 0;
  const isTargetAchieved = pctAchieved >= 100;

  const displayName = isUnassigned
    ? 'Thu ngoài dự kiến / Khác'
    : incomeSource?.name || 'Nguồn thu';

  const dotColor = isUnassigned
    ? '#8CC7AE'
    : incomeSource?.color || '#8CC7AE';

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full max-w-md max-h-[88vh] bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl flex flex-col no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#8BA5AA]/15">
          <div className="flex items-center gap-2.5 min-w-0">
            {isUnassigned ? (
              <span className="w-8 h-8 rounded-xl bg-[#232E31] text-[#8CC7AE] flex items-center justify-center border border-[#8CC7AE]/30 shrink-0 shadow-sm">
                <Sparkles size={16} />
              </span>
            ) : (
              <span
                className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: dotColor }}
              />
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-base font-bold text-[#F2F5F5] truncate">{displayName}</span>
                {!isUnassigned && incomeSource?.recurrence && (
                  <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-[#20292B] text-[#95B0B4] border border-[#8BA5AA]/20 shrink-0">
                    {incomeSource.recurrence}
                  </span>
                )}
              </div>
              {!isUnassigned && incomeSource?.keywords && (
                <span className="text-[10.5px] text-[#869699] truncate block" title={`Từ khóa: ${incomeSource.keywords}`}>
                  🔑 {incomeSource.keywords}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isUnassigned && onEditSource && incomeSource && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEditSource(incomeSource);
                }}
                className="w-8 h-8 rounded-full bg-[#20292B] text-[#D5E1E3] hover:text-[#8CC7AE] flex items-center justify-center active:scale-90 transition-transform border border-[#8BA5AA]/15"
                title="Chỉnh sửa nguồn thu này"
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

        {/* Hero Card Thống kê nguồn thu */}
        <div className="my-3.5 p-3.5 rounded-2xl bg-gradient-to-br from-[#1C2725] to-[#121919] border border-[#8CC7AE]/30 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#869699] font-medium flex items-center gap-1">
              <DollarSign size={12} className="text-[#8CC7AE]" />
              {filterPeriod === 'period' ? `Đã thực thu (${periodLabel})` : 'Tổng đã thực thu'}
            </span>
            {hasExpected ? (
              <span
                className={`num text-[11px] font-bold px-2 py-0.5 rounded-full ${
                  isTargetAchieved
                    ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/40'
                    : 'bg-[#DEB48A]/20 text-[#DEB48A] border border-[#DEB48A]/35'
                }`}
              >
                Đạt {pctAchieved}%
              </span>
            ) : (
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/25">
                Thực thu linh hoạt
              </span>
            )}
          </div>

          <div className="flex items-baseline justify-between">
            <div className="num text-[24px] font-bold text-[#8CC7AE]">
              {privacyMode ? '••••••' : `+${formatVND(totalActual)}`}
            </div>
            {hasExpected && (
              <div className="text-right">
                <span className="text-[10px] text-[#869699] block">Dự kiến tháng</span>
                <span className="num text-xs font-semibold text-[#D5E1E3]">
                  {privacyMode ? '••••••' : formatVND(monthlyExpected)}
                </span>
              </div>
            )}
          </div>

          {/* Thanh tiến trình đạt kế hoạch (nếu có dự kiến) */}
          {hasExpected && (
            <div className="h-2 rounded-full bg-[#161C1E] overflow-hidden">
              <div
                className="h-full rounded-full bg-[#8CC7AE] transition-all duration-300"
                style={{ width: `${Math.min(100, pctAchieved)}%` }}
              />
            </div>
          )}

          {/* Dòng tóm tắt số giao dịch đã duyệt */}
          <div className="flex items-center justify-between text-[11px] pt-0.5 border-t border-[#8BA5AA]/10">
            <span className="text-[#869699]">Số khoản thu đã duyệt:</span>
            <span className="num font-bold text-[#F2F5F5]">
              {sourceTransactions.length} giao dịch
            </span>
          </div>
        </div>

        {/* Thanh công cụ: Bộ lọc kỳ & Nút Thêm thu tiền */}
        <div className="flex items-center justify-between pb-2">
          {/* Bộ lọc kỳ (V2-15: Kế thừa chuẩn xác từ màn hình cha) */}
          <div className="flex items-center gap-1 bg-[#12181A] p-0.5 rounded-xl border border-[#8BA5AA]/15">
            <button
              type="button"
              onClick={() => setFilterPeriod('period')}
              className={`px-2.5 py-1 rounded-lg text-[10.5px] font-semibold transition-colors ${
                filterPeriod === 'period'
                  ? 'bg-[#657D81] text-[#F2F5F5]'
                  : 'text-[#869699] hover:text-[#D5E1E3]'
              }`}
            >
              {periodLabel}
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
              Tất cả ({allSourceTransactions.length})
            </button>
          </div>

          {/* Nút Ghi nhanh thu tiền cho nguồn này */}
          {onQuickAddIncome && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onQuickAddIncome(incomeSource?.id);
              }}
              className="px-2.5 py-1 rounded-xl bg-[#1C2725] hover:bg-[#23312E] text-[#8CC7AE] border border-[#8CC7AE]/35 text-[11px] font-bold flex items-center gap-1 active:scale-95 transition-all shadow-sm"
            >
              <Plus size={12} />
              Ghi thu tiền
            </button>
          )}
        </div>

        {/* Danh sách các khoản thu đã được duyệt */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5 no-scrollbar min-h-[160px] max-h-[360px]">
          {sourceTransactions.length > 0 ? (
            sourceTransactions.map((txn) => {
              return (
                <div
                  key={txn.id}
                  className="p-3 rounded-2xl bg-[#1C2426]/75 border border-[#8BA5AA]/12 flex items-center justify-between gap-3 hover:bg-[#20292B] transition-colors"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 bg-[#8CC7AE]/15 text-[#8CC7AE]">
                      <ArrowUpRight size={16} />
                    </div>

                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                        {txn.description || 'Khoản thu tiền'}
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
                    <div className="num text-xs font-bold text-[#8CC7AE]">
                      {privacyMode ? '••••' : `+${formatVND(txn.amount)}`}
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
                Chưa có giao dịch thu nào được ghi nhận cho <b>{displayName}</b> {filterPeriod === 'period' ? `trong ${periodLabel}` : ''}.
              </div>
              {onQuickAddIncome && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onQuickAddIncome(incomeSource?.id);
                  }}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 text-xs font-semibold active:scale-95 transition-all mt-1"
                >
                  <Plus size={13} />
                  Ghi chép khoản thu ngay
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
