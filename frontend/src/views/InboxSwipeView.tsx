import React, { useState, useEffect, useMemo } from 'react';
import { Transaction, Jar, IncomeSource, BankAccount } from '../types';
import { formatVND } from '../utils/financeMath';
import { ConfirmSheet } from '../components/ConfirmSheet';
import {
  Check,
  X,
  ArrowLeft,
  Trash2,
  DollarSign,
  CheckCircle2,
  ArrowRightLeft,
  Scissors,
  Repeat,
  ArrowRight,
  Search,
  Filter,
  Edit2,
  LayoutList,
  CreditCard,
  CheckCheck,
  ChevronRight,
  Layers
} from 'lucide-react';

interface InboxSwipeViewProps {
  pendingTransactions: Transaction[];
  confirmedTransactions: Transaction[];
  onConfirm: (id: string, jarCode?: string, categoryName?: string, jarId?: string, incomeSourceId?: string) => void;
  onReject: (id: string) => void;
  onDeleteConfirmed?: (id: string) => void;
  onUpdateConfirmed?: (
    id: string,
    updates: { jarId?: string; jarCode?: string; category?: string; description?: string; incomeSourceId?: string | null }
  ) => void;
  onBack: () => void;
  jars?: Jar[];
  incomeSources?: IncomeSource[];
  accounts?: BankAccount[];
  onUnpair?: (id: string) => void;
  onPairTransfer?: (id: string, toAccountId: string) => void;
}

export const InboxSwipeView: React.FC<InboxSwipeViewProps> = ({
  pendingTransactions,
  confirmedTransactions,
  onConfirm,
  onReject,
  onDeleteConfirmed,
  onUpdateConfirmed,
  onBack,
  jars = [],
  incomeSources = [],
  accounts = [],
  onUnpair,
  onPairTransfer
}) => {
  // Main subTab: Chờ duyệt vs Lịch sử
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');

  // Chế độ xem trong phần Chờ duyệt: Thẻ vuốt (card) vs Danh sách tất cả (list)
  const [pendingViewMode, setPendingViewMode] = useState<'card' | 'list'>('card');
  const [pendingFilter, setPendingFilter] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [pendingSearch, setPendingSearch] = useState('');

  // Lịch sử filter & search
  const [searchQuery, setSearchQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');

  // Quản lý giao dịch đang được chọn để duyệt trên thẻ (activeTxn)
  const [selectedPendingId, setSelectedPendingId] = useState<string | null>(
    pendingTransactions[0]?.id || null
  );

  // Lưu đè cấu hình hũ / nguồn thu cho từng giao dịch (nếu người dùng đã chủ động chọn lại)
  const [assignedOverrides, setAssignedOverrides] = useState<
    Record<string, { jarId?: string; jarCode?: string; categoryName?: string; incomeSourceId?: string }>
  >({});

  // Giao dịch đang mở modal chọn hũ / nguồn thu
  const [pickerTxn, setPickerTxn] = useState<Transaction | null>(null);

  // Modal / Sheet chỉnh sửa giao dịch đã duyệt (trong tab Lịch sử)
  const [editingConfirmedTxn, setEditingConfirmedTxn] = useState<Transaction | null>(null);
  const [editConfirmedDesc, setEditConfirmedDesc] = useState('');
  const [editConfirmedJarId, setEditConfirmedJarId] = useState('');
  const [editConfirmedIncomeSourceId, setEditConfirmedIncomeSourceId] = useState('');

  // Confirm sheet state
  const [confirmSheet, setConfirmSheet] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    isDanger?: boolean;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => {}
  });

  // Hũ mặc định an toàn
  const defaultJar = useMemo(() => jars.find(j => j.isDefault) || jars[0], [jars]);

  // Đảm bảo selectedPendingId luôn trỏ vào một giao dịch hợp lệ
  useEffect(() => {
    if (pendingTransactions.length > 0) {
      if (!selectedPendingId || !pendingTransactions.some(t => t.id === selectedPendingId)) {
        setSelectedPendingId(pendingTransactions[0].id);
      }
    } else {
      setSelectedPendingId(null);
    }
  }, [pendingTransactions, selectedPendingId]);

  // Giao dịch đang hiển thị ở thẻ chính
  const activeTxn = useMemo(() => {
    if (!selectedPendingId) return pendingTransactions[0] || null;
    return pendingTransactions.find(t => t.id === selectedPendingId) || pendingTransactions[0] || null;
  }, [pendingTransactions, selectedPendingId]);

  // Các giao dịch còn lại trong hàng đợi
  const queue = useMemo(() => {
    if (!activeTxn) return [];
    return pendingTransactions.filter(t => t.id !== activeTxn.id);
  }, [pendingTransactions, activeTxn]);

  // Helper tính hũ / nguồn thu phân bổ cho một giao dịch bất kỳ
  const getTxnAssignment = (txn: Transaction) => {
    if (assignedOverrides[txn.id]) {
      return assignedOverrides[txn.id];
    }

    if (txn.type === 'income') {
      const matchedSource = incomeSources.find(
        s => s.id === txn.incomeSourceId || s.name.toLowerCase() === (txn.suggestedCategory || '').toLowerCase()
      );
      if (matchedSource) {
        return {
          incomeSourceId: matchedSource.id,
          categoryName: matchedSource.name
        };
      }
      return {
        incomeSourceId: '',
        categoryName: txn.suggestedCategory || 'Thu ngoài dự kiến'
      };
    }

    if (txn.type === 'transfer') {
      return {
        categoryName: 'Chuyển nội bộ'
      };
    }

    // Expense
    const matchedJar =
      jars.find(j => j.id === txn.jarId) ||
      jars.find(j => j.code === txn.suggestedJarCode) ||
      defaultJar;

    return {
      jarId: matchedJar?.id,
      jarCode: matchedJar?.code,
      categoryName: matchedJar?.name || txn.suggestedCategory || 'Thiết yếu'
    };
  };

  // Thông tin phân bổ của activeTxn
  const activeAssignment = activeTxn ? getTxnAssignment(activeTxn) : null;
  const activeJarObj = activeAssignment?.jarId ? jars.find(j => j.id === activeAssignment.jarId) || defaultJar : defaultJar;

  // Touch Swipe Gesture State cho Active Card
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setSwipeOffset(0);
    setIsDragging(false);
  }, [activeTxn?.id]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStartX(e.touches[0].clientX);
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStartX;
    setSwipeOffset(diff);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    if (touchStartX === null) return;

    if (swipeOffset > 90) {
      // Kéo sang phải = Xác nhận duyệt
      if (activeTxn) handleConfirmSingle(activeTxn);
    } else if (swipeOffset < -90) {
      // Kéo sang trái = Bỏ qua
      if (activeTxn) handleRejectSingle(activeTxn.id);
    }
    setSwipeOffset(0);
    setTouchStartX(null);
  };

  // Duyệt một giao dịch bất kỳ
  const handleConfirmSingle = (txn: Transaction) => {
    const assignment = getTxnAssignment(txn);
    if (txn.type === 'income') {
      onConfirm(
        txn.id,
        undefined,
        assignment.categoryName || 'Thu ngoài dự kiến',
        undefined,
        assignment.incomeSourceId || undefined
      );
    } else if (txn.type === 'transfer') {
      onConfirm(txn.id);
    } else {
      onConfirm(txn.id, assignment.jarCode, assignment.categoryName, assignment.jarId);
    }
  };

  // Bỏ qua một giao dịch bất kỳ
  const handleRejectSingle = (id: string) => {
    onReject(id);
  };

  // Duyệt tất cả giao dịch trong danh sách chờ
  const handleConfirmAll = () => {
    if (pendingTransactions.length === 0) return;
    setConfirmSheet({
      isOpen: true,
      title: `Duyệt tất cả ${pendingTransactions.length} giao dịch`,
      description: `Anh có chắc muốn duyệt đồng loạt ${pendingTransactions.length} giao dịch theo các hũ và nguồn thu đã được đề xuất tự động không?`,
      confirmText: 'Duyệt tất cả ngay',
      isDanger: false,
      onConfirm: () => {
        // Duyệt từng khoản
        pendingTransactions.forEach(t => handleConfirmSingle(t));
      }
    });
  };

  // Filter danh sách chờ duyệt
  const filteredPending = useMemo(() => {
    return pendingTransactions.filter(t => {
      if (pendingFilter === 'expense' && t.type !== 'expense') return false;
      if (pendingFilter === 'income' && t.type !== 'income') return false;
      if (pendingFilter === 'transfer' && t.type !== 'transfer') return false;

      if (!pendingSearch.trim()) return true;
      const q = pendingSearch.toLowerCase();
      return (
        t.description.toLowerCase().includes(q) ||
        (t.suggestedCategory || '').toLowerCase().includes(q) ||
        t.bankCode.toLowerCase().includes(q) ||
        t.accountName.toLowerCase().includes(q)
      );
    });
  }, [pendingTransactions, pendingFilter, pendingSearch]);

  // Filter lịch sử
  const filteredHistory = useMemo(() => {
    return confirmedTransactions.filter(t => {
      if (historyFilter === 'expense' && t.type !== 'expense') return false;
      if (historyFilter === 'income' && t.type !== 'income') return false;
      if (historyFilter === 'transfer' && t.type !== 'transfer') return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        t.description.toLowerCase().includes(q) ||
        (t.suggestedCategory || '').toLowerCase().includes(q) ||
        t.bankCode.toLowerCase().includes(q)
      );
    });
  }, [confirmedTransactions, historyFilter, searchQuery]);

  return (
    <div className="space-y-3 pb-24 px-4 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center justify-center text-[#C4D0D2] active:scale-90"
            title="Quay lại"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="text-[18px] font-bold text-[#F2F5F5]">Hộp thư Giao dịch</span>
        </div>

        {/* Tab Switcher: Chờ duyệt vs Lịch sử */}
        <div className="flex items-center gap-1 bg-[#161C1E] p-1 rounded-2xl border border-[#8BA5AA]/15">
          <button
            onClick={() => setSubTab('pending')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              subTab === 'pending'
                ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                : 'text-[#869699] hover:text-[#D5E1E3]'
            }`}
          >
            Chờ duyệt ({pendingTransactions.length})
          </button>
          <button
            onClick={() => setSubTab('history')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
              subTab === 'history'
                ? 'bg-[#8CC7AE] text-[#0E1314] shadow'
                : 'text-[#869699] hover:text-[#D5E1E3]'
            }`}
          >
            Lịch sử ({confirmedTransactions.length})
          </button>
        </div>
      </div>

      {subTab === 'pending' ? (
        <div>
          {pendingTransactions.length === 0 ? (
            <div className="bg-[#1C2426]/70 border border-[#8BA5AA]/15 rounded-3xl p-8 text-center space-y-3 mt-4">
              <div className="w-14 h-14 rounded-2xl bg-[#232E31] text-[#8CC7AE] flex items-center justify-center mx-auto border border-[#8CC7AE]/30">
                <CheckCircle2 size={28} />
              </div>
              <div className="text-base font-bold text-[#F2F5F5]">Tất cả giao dịch đã được duyệt!</div>
              <div className="text-xs text-[#869699] max-w-xs mx-auto">
                Khi có thông báo biến động số dư từ app ngân hàng, giao dịch mới sẽ tự động xuất hiện tại đây để anh duyệt.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {/* THANH ĐIỀU HƯỚNG CHỌN CHẾ ĐỘ XEM & DUYỆT TẤT CẢ */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {/* Chuyển đổi View Mode: Thẻ vuốt vs Danh sách */}
                <div className="flex items-center bg-[#161C1E] p-1 rounded-2xl border border-[#8BA5AA]/20">
                  <button
                    onClick={() => setPendingViewMode('card')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      pendingViewMode === 'card'
                        ? 'bg-[#28383B] text-[#8CC7AE] shadow'
                        : 'text-[#869699] hover:text-[#D5E1E3]'
                    }`}
                  >
                    <CreditCard size={13} /> Thẻ vuốt
                  </button>
                  <button
                    onClick={() => setPendingViewMode('list')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      pendingViewMode === 'list'
                        ? 'bg-[#28383B] text-[#8CC7AE] shadow'
                        : 'text-[#869699] hover:text-[#D5E1E3]'
                    }`}
                  >
                    <LayoutList size={13} /> Danh sách ({pendingTransactions.length})
                  </button>
                </div>

                {/* Nút Duyệt tất cả nhanh */}
                {pendingTransactions.length > 1 && (
                  <button
                    onClick={handleConfirmAll}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold bg-[#8CC7AE]/15 hover:bg-[#8CC7AE]/25 text-[#8CC7AE] border border-[#8CC7AE]/30 active:scale-95 transition-transform"
                    title="Duyệt tất cả các giao dịch này theo đề xuất"
                  >
                    <CheckCheck size={14} /> Duyệt tất cả
                  </button>
                )}
              </div>

              {/* BỘ CHỌN NHANH CÁC GIAO DỊCH CHỜ DUYỆT (CHIPS CAROUSEL) */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[#869699] px-1">
                  <span>Chọn nhanh khoản cần duyệt ({pendingTransactions.length}):</span>
                  {pendingViewMode === 'card' && (
                    <span className="text-[10px] text-[#8CC7AE]">👈 Vuốt trái: Bỏ qua | Vuốt phải: Duyệt 👉</span>
                  )}
                </div>

                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1">
                  {pendingTransactions.map((txn, idx) => {
                    const isSelected = activeTxn?.id === txn.id;
                    return (
                      <button
                        key={txn.id}
                        onClick={() => {
                          setSelectedPendingId(txn.id);
                          if (pendingViewMode === 'list') {
                            // Người dùng bấm vào chip trong list view có thể chuyển sang card hoặc cuộn tới
                          }
                        }}
                        className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-2xl border text-xs transition-all active:scale-95 ${
                          isSelected
                            ? 'bg-[#243538] border-[#8CC7AE] text-[#F2F5F5] shadow-[0_0_12px_rgba(140,199,174,0.25)]'
                            : 'bg-[#161C1E] border-[#8BA5AA]/20 text-[#97A8AB] hover:bg-[#20292B]'
                        }`}
                      >
                        <span className="w-4 h-4 rounded-full bg-[#0E1314] text-[9.5px] font-mono flex items-center justify-center text-[#869699]">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-[11px] text-[#D5E1E3]">{txn.bankCode}</span>
                        <span
                          className={`num font-bold text-[11px] ${
                            txn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#F2F5F5]'
                          }`}
                        >
                          {txn.type === 'income' ? '+' : '−'}
                          {formatVND(txn.amount)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ======================= CHẾ ĐỘ 1: THẺ VUỐT (CARD VIEW) ======================= */}
              {pendingViewMode === 'card' && activeTxn && (
                <div className="space-y-3">
                  {/* Swipe Card Stack */}
                  <div className="relative mt-1 mb-2">
                    <div className="absolute left-3.5 right-3.5 -bottom-2 h-10 bg-[#1C2426]/40 border border-[#8BA5AA]/10 rounded-3xl z-0"></div>

                    <div
                      onTouchStart={handleTouchStart}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      style={{
                        transform: `translateX(${swipeOffset}px) rotate(${swipeOffset * 0.04}deg)`,
                        transition: isDragging ? 'none' : 'transform 0.25s ease-out'
                      }}
                      className="relative z-10 bg-gradient-to-br from-[#243033] to-[#182022] border border-[#9AB3B8]/30 rounded-3xl p-5 shadow-[0_18px_36px_rgba(0,0,0,0.45)] touch-pan-y"
                    >
                      {/* Swipe hints visual indicator */}
                      {swipeOffset > 40 && (
                        <div className="absolute top-4 right-4 bg-[#8CC7AE] text-[#0E1314] px-3 py-1 rounded-xl font-bold text-xs shadow-lg animate-pulse flex items-center gap-1">
                          <Check size={14} /> DUYỆT
                        </div>
                      )}
                      {swipeOffset < -40 && (
                        <div className="absolute top-4 left-4 bg-[#E06D6D] text-white px-3 py-1 rounded-xl font-bold text-xs shadow-lg animate-pulse flex items-center gap-1">
                          <X size={14} /> BỎ QUA
                        </div>
                      )}

                      {/* Header giao dịch */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-9 h-9 rounded-xl bg-[#2C3A3E] border border-[#9AB3B8]/20 flex items-center justify-center font-bold text-xs text-[#D5E1E3]">
                            {activeTxn.bankCode}
                          </div>
                          <div>
                            <div className="text-[13.5px] font-semibold text-[#F2F5F5]">
                              {activeTxn.accountName}
                            </div>
                            <div className="text-[11px] text-[#869699]">{activeTxn.occurredAt}</div>
                          </div>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-medium border flex items-center gap-1 ${
                            activeTxn.type === 'income'
                              ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/25'
                              : activeTxn.type === 'transfer'
                              ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border-[#8CC7AE]/40 font-semibold'
                              : 'bg-[#657D81]/25 text-[#BFD0D3] border-[#8BA5AA]/20'
                          }`}
                        >
                          {activeTxn.type === 'income' ? (
                            'Tiền vào'
                          ) : activeTxn.type === 'transfer' ? (
                            <>
                              <Repeat size={11} /> Chuyển nội bộ
                            </>
                          ) : (
                            'Khoản chi'
                          )}
                        </span>
                      </div>

                      {/* Số tiền */}
                      <div
                        className={`num text-[29px] font-bold tracking-tight my-2 flex items-center gap-2 ${
                          activeTxn.type === 'income'
                            ? 'text-[#8CC7AE]'
                            : activeTxn.type === 'transfer'
                            ? 'text-[#8CC7AE]'
                            : 'text-[#F2F5F5]'
                        }`}
                      >
                        {activeTxn.type === 'transfer' ? (
                          <ArrowRightLeft size={24} className="text-[#8CC7AE]" />
                        ) : activeTxn.type === 'income' ? (
                          '+'
                        ) : (
                          '−'
                        )}
                        {formatVND(activeTxn.amount)}
                      </div>
                      <div className="text-[13.5px] font-medium text-[#C4D0D2] mb-3 leading-snug">
                        {activeTxn.description}
                      </div>

                      {/* KHI LÀ GIAO DỊCH CHUYỂN TIỀN NỘI BỘ (TRANSFER) */}
                      {activeTxn.type === 'transfer' ? (
                        <div className="bg-[#12191B] border border-[#8CC7AE]/25 rounded-2xl p-3.5 my-3 space-y-3 shadow-inner">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-lg bg-[#232E31] text-[#D5E1E3] font-bold text-xs flex items-center justify-center border border-[#8BA5AA]/20">
                                {activeTxn.bankCode}
                              </div>
                              <div>
                                <div className="font-semibold text-[#F2F5F5] text-xs">{activeTxn.accountName}</div>
                                <div className="text-[10px] text-[#E07A5F]">Tài khoản trừ tiền</div>
                              </div>
                            </div>

                            <div className="flex flex-col items-center px-2 text-[#8CC7AE]">
                              <ArrowRight size={16} />
                              <span className="text-[9px] font-mono">Điều chuyển</span>
                            </div>

                            <div className="flex items-center gap-2 text-right">
                              <div>
                                <div className="font-semibold text-[#F2F5F5] text-xs">
                                  {activeTxn.toAccountName || activeTxn.pairedAccountName || 'Tài khoản nhận'}
                                </div>
                                <div className="text-[10px] text-[#8CC7AE]">Tài khoản cộng tiền</div>
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-[#1B2B28] text-[#8CC7AE] font-bold text-xs flex items-center justify-center border border-[#8CC7AE]/30">
                                {activeTxn.pairedBankCode || 'ĐÍCH'}
                              </div>
                            </div>
                          </div>

                          <div className="text-[11px] text-[#869699] bg-[#0A0E0F]/60 rounded-xl p-2.5 leading-relaxed">
                            ✨ <strong>Tự động ghép cặp thông minh:</strong> Nhận diện chuyển tiền giữa các tài khoản của anh để phân bổ quỹ. Giao dịch này <strong>không tính vào thu nhập hay chi tiêu</strong> và không làm lệch hạn mức các hũ.
                          </div>

                          {onUnpair && (
                            <div className="pt-1 flex items-center justify-between border-t border-[#8BA5AA]/15">
                              <span className="text-[10.5px] text-[#869699]">Ghép nhầm giao dịch?</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setConfirmSheet({
                                    isOpen: true,
                                    title: 'Tách 2 giao dịch',
                                    description: 'Anh có chắc muốn tách giao dịch này ra thành 2 khoản độc lập (1 khoản trừ + 1 khoản cộng) không?',
                                    confirmText: 'Tách giao dịch',
                                    isDanger: false,
                                    onConfirm: () => onUnpair(activeTxn.id)
                                  });
                                }}
                                className="px-3 py-1.5 rounded-xl bg-[#291B1D] hover:bg-[#382124] border border-[#E07A5F]/35 text-[#E07A5F] text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-transform shadow-sm"
                              >
                                <Scissors size={13} /> Tách 2 giao dịch
                              </button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <>
                          {activeTxn.rawQuote && (
                            <div className="bg-[#0C1011]/60 border border-[#8BA5AA]/15 rounded-xl p-2.5 text-[11px] font-mono text-[#97A8AB] leading-relaxed mb-3">
                              "{activeTxn.rawQuote}"
                            </div>
                          )}

                          {/* PHÂN BỔ HŨ CHI HOẶC NGUỒN THU */}
                          <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider mb-2">
                            {activeTxn.type === 'income' ? 'Phân bổ nguồn thu nhập' : 'Phân bổ hũ chi tiêu'}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 mb-4">
                            {activeTxn.type === 'income' ? (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/30">
                                <DollarSign size={13} /> {activeAssignment?.categoryName || 'Thu nhập'}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#657D81]/25 text-[#DCE6E8] border border-[#8BA5AA]/30">
                                <span
                                  className="w-2.5 h-2.5 rounded-full"
                                  style={{ backgroundColor: activeJarObj?.color || '#657D81' }}
                                ></span>
                                <span>Hũ {activeJarObj?.name || 'Chi tiêu'}</span>
                              </span>
                            )}

                            <button
                              onClick={() => setPickerTxn(activeTxn)}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#D5E1E3] bg-[#232E31] hover:bg-[#2C3B3F] border border-[#8BA5AA]/30 active:scale-95 transition-transform"
                            >
                              {activeTxn.type === 'income' ? 'Đổi nguồn thu ▾' : 'Đổi hũ chi / Chuyển nội bộ ▾'}
                            </button>
                          </div>
                        </>
                      )}

                      {/* Nút Bỏ qua / Xác nhận */}
                      <div className="flex items-center justify-between pt-3 border-t border-[#8BA5AA]/15">
                        <button
                          onClick={() => handleRejectSingle(activeTxn.id)}
                          className="h-10 px-4 rounded-xl flex items-center gap-1.5 text-xs font-semibold border border-[#8BA5AA]/20 bg-white/[0.03] hover:bg-white/[0.08] text-[#97A8AB] active:scale-95 transition-transform"
                        >
                          <X size={15} strokeWidth={2} />
                          Bỏ qua
                        </button>
                        <button
                          onClick={() => handleConfirmSingle(activeTxn)}
                          className="h-10 px-6 rounded-xl flex items-center gap-1.5 text-xs font-semibold bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] border border-[#BFD0D3]/35 shadow-[0_6px_16px_rgba(101,125,129,0.35)] active:scale-95 transition-transform"
                        >
                          <Check size={16} strokeWidth={2.4} />
                          {activeTxn.type === 'transfer' ? 'Xác nhận chuyển nội bộ' : 'Xác nhận duyệt'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* DANH SÁCH CÁC KHOẢN KHÁC TRONG HÀNG ĐỢI (CHẠM VÀO ĐỂ DUYỆT NGAY HOẶC CHUYỂN THẺ) */}
                  {queue.length > 0 && (
                    <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
                          Các khoản khác đang chờ duyệt ({queue.length})
                        </div>
                        <span className="text-[10px] text-[#869699]">Chạm để chọn hoặc duyệt nhanh</span>
                      </div>

                      <div className="divide-y divide-[#8BA5AA]/10">
                        {queue.map((txn) => {
                          const assignment = getTxnAssignment(txn);
                          return (
                            <div
                              key={txn.id}
                              className="py-2.5 flex items-center justify-between gap-2.5 hover:bg-[#232E31]/40 rounded-xl px-1.5 transition-colors"
                            >
                              {/* Khu vực bấm để đổi thành active card */}
                              <div
                                onClick={() => setSelectedPendingId(txn.id)}
                                className="flex items-center gap-2.5 flex-1 min-w-0 cursor-pointer"
                              >
                                <div className="w-8 h-8 rounded-lg bg-[#232E31] border border-[#8BA5AA]/15 flex items-center justify-center font-bold text-[10.5px] text-[#BFD0D3] shrink-0">
                                  {txn.bankCode}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                                    {txn.description}
                                  </div>
                                  <div className="text-[10.5px] text-[#869699] truncate flex items-center gap-1.5">
                                    <span>{assignment.categoryName || txn.suggestedCategory}</span>
                                    <span>·</span>
                                    <span
                                      className={`num font-bold ${
                                        txn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#C4D0D2]'
                                      }`}
                                    >
                                      {txn.type === 'income' ? '+' : '−'}
                                      {formatVND(txn.amount)}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Cụm nút hành động nhanh trên từng khoản trong queue */}
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => handleRejectSingle(txn.id)}
                                  className="w-7 h-7 rounded-lg bg-[#232A2C] hover:bg-[#342426] text-[#97A8AB] hover:text-[#E06D6D] border border-[#8BA5AA]/15 flex items-center justify-center active:scale-90 transition-transform"
                                  title="Bỏ qua giao dịch này"
                                >
                                  <X size={13} />
                                </button>
                                <button
                                  onClick={() => handleConfirmSingle(txn)}
                                  className="h-7 px-2.5 rounded-lg bg-[#657D81]/30 hover:bg-[#657D81] text-[#8CC7AE] hover:text-[#F2F5F5] border border-[#8CC7AE]/30 text-xs font-semibold flex items-center gap-1 active:scale-90 transition-all"
                                  title="Duyệt nhanh theo đề xuất"
                                >
                                  <Check size={12} strokeWidth={2.4} /> Duyệt
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ======================= CHẾ ĐỘ 2: DANH SÁCH TẤT CẢ (LIST VIEW) ======================= */}
              {pendingViewMode === 'list' && (
                <div className="space-y-3">
                  {/* Search bar */}
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-3 text-[#869699]" />
                    <input
                      type="text"
                      placeholder="Tìm khoản chờ duyệt theo nội dung, ngân hàng..."
                      value={pendingSearch}
                      onChange={(e) => setPendingSearch(e.target.value)}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]/50"
                    />
                  </div>

                  {/* Filter Chips cho Pending */}
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                    <button
                      onClick={() => setPendingFilter('all')}
                      className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        pendingFilter === 'all'
                          ? 'bg-[#657D81] text-[#F2F5F5]'
                          : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
                      }`}
                    >
                      Tất cả ({pendingTransactions.length})
                    </button>
                    <button
                      onClick={() => setPendingFilter('expense')}
                      className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        pendingFilter === 'expense'
                          ? 'bg-[#E07A7A]/20 text-[#E07A7A] border border-[#E07A7A]/30 font-bold'
                          : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
                      }`}
                    >
                      Khoản chi
                    </button>
                    <button
                      onClick={() => setPendingFilter('income')}
                      className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        pendingFilter === 'income'
                          ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/30 font-bold'
                          : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
                      }`}
                    >
                      Khoản thu
                    </button>
                    <button
                      onClick={() => setPendingFilter('transfer')}
                      className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                        pendingFilter === 'transfer'
                          ? 'bg-[#DEB48A]/20 text-[#DEB48A] border border-[#DEB48A]/30 font-bold'
                          : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
                      }`}
                    >
                      Chuyển nội bộ
                    </button>
                  </div>

                  {/* Danh sách từng giao dịch dạng Card độc lập */}
                  <div className="space-y-2.5">
                    {filteredPending.length === 0 ? (
                      <div className="bg-[#1C2426]/60 border border-[#8BA5AA]/15 rounded-3xl p-6 text-center text-xs text-[#869699]">
                        Không có giao dịch nào khớp với bộ lọc
                      </div>
                    ) : (
                      filteredPending.map((txn, idx) => {
                        const assignment = getTxnAssignment(txn);
                        const jar = assignment.jarId ? jars.find(j => j.id === assignment.jarId) || defaultJar : defaultJar;

                        return (
                          <div
                            key={txn.id}
                            className="bg-gradient-to-br from-[#202B2E] to-[#161E20] border border-[#8BA5AA]/20 rounded-2xl p-4 shadow-md space-y-3"
                          >
                            {/* Dòng 1: Ngân hàng & Loại giao dịch & Giờ */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-lg bg-[#2A383C] text-[#D5E1E3] font-bold text-[11px] flex items-center justify-center border border-[#8BA5AA]/20">
                                  {txn.bankCode}
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-[#F2F5F5]">{txn.accountName}</div>
                                  <div className="text-[10px] text-[#869699]">{txn.occurredAt}</div>
                                </div>
                              </div>

                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                                  txn.type === 'income'
                                    ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/25'
                                    : txn.type === 'transfer'
                                    ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border-[#8CC7AE]/40 font-semibold'
                                    : 'bg-[#657D81]/25 text-[#BFD0D3] border-[#8BA5AA]/20'
                                }`}
                              >
                                {txn.type === 'income' ? 'Tiền vào' : txn.type === 'transfer' ? 'Chuyển khoản' : 'Khoản chi'}
                              </span>
                            </div>

                            {/* Dòng 2: Nội dung & Số tiền */}
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium text-[#E4ECEE] leading-snug">
                                  {txn.description}
                                </div>
                                {txn.rawQuote && (
                                  <div className="text-[10.5px] font-mono text-[#869699] mt-1 truncate">
                                    "{txn.rawQuote}"
                                  </div>
                                )}
                              </div>
                              <div
                                className={`num text-base font-bold shrink-0 ${
                                  txn.type === 'income' || txn.type === 'transfer'
                                    ? 'text-[#8CC7AE]'
                                    : 'text-[#F2F5F5]'
                                }`}
                              >
                                {txn.type === 'income' ? '+' : txn.type === 'transfer' ? '⇄ ' : '−'}
                                {formatVND(txn.amount)}
                              </div>
                            </div>

                            {/* Dòng 3: Phân bổ Hũ / Nguồn thu (Có thể bấm để đổi) */}
                            <div className="flex items-center justify-between bg-[#12191B]/80 rounded-xl p-2 border border-[#8BA5AA]/10 text-xs">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[10.5px] text-[#869699]">Phân bổ:</span>
                                {txn.type === 'income' ? (
                                  <span className="font-semibold text-[#8CC7AE] truncate">
                                    💰 {assignment.categoryName || 'Thu ngoài dự kiến'}
                                  </span>
                                ) : txn.type === 'transfer' ? (
                                  <span className="font-semibold text-[#8CC7AE] truncate flex items-center gap-1">
                                    <Repeat size={12} /> {txn.accountName} → {txn.toAccountName || txn.pairedAccountName || 'Tài khoản nhận'}
                                  </span>
                                ) : (
                                  <span className="font-semibold text-[#D5E1E3] truncate flex items-center gap-1.5">
                                    <span
                                      className="w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: jar?.color || '#657D81' }}
                                    ></span>
                                    <span>Hũ {jar?.name || 'Chi tiêu'}</span>
                                    {jar?.monthlyLimit && (
                                      <span className="text-[10px] text-[#869699]">
                                        (còn {formatVND(Math.max(0, jar.monthlyLimit - jar.spentThisMonth))})
                                      </span>
                                    )}
                                  </span>
                                )}
                              </div>

                              {txn.type !== 'transfer' && (
                                <button
                                  type="button"
                                  onClick={() => setPickerTxn(txn)}
                                  className="text-[10.5px] font-semibold text-[#8CC7AE] hover:text-[#A7DBCA] px-2 py-0.5 rounded-lg bg-[#232E31] border border-[#8BA5AA]/20 active:scale-95"
                                >
                                  Đổi ▾
                                </button>
                              )}
                            </div>

                            {/* Dòng 4: Cụm nút hành động trên mỗi giao dịch */}
                            <div className="flex items-center justify-between pt-1 gap-2 border-t border-[#8BA5AA]/10">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPendingId(txn.id);
                                  setPendingViewMode('card');
                                }}
                                className="px-2.5 py-1.5 rounded-xl bg-[#232E31]/70 hover:bg-[#2C3B3F] text-[#C4D0D2] text-[11px] font-medium flex items-center gap-1 active:scale-95 transition-all"
                              >
                                <CreditCard size={12} /> Vuốt thẻ
                              </button>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleRejectSingle(txn.id)}
                                  className="px-3 py-1.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-[#97A8AB] hover:text-[#E06D6D] border border-[#8BA5AA]/20 text-xs font-semibold flex items-center gap-1 active:scale-95 transition-all"
                                >
                                  <X size={13} /> Bỏ qua
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleConfirmSingle(txn)}
                                  className="px-4 py-1.5 rounded-xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] border border-[#BFD0D3]/35 text-xs font-bold flex items-center gap-1.5 shadow-[0_4px_12px_rgba(101,125,129,0.35)] active:scale-95 transition-all"
                                >
                                  <Check size={14} strokeWidth={2.4} /> Duyệt ngay
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* ======================= TAB LỊCH SỬ GIAO DỊCH ĐÃ DUYỆT ======================= */
        <div className="space-y-3">
          {/* Search bar */}
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-3 text-[#869699]" />
            <input
              type="text"
              placeholder="Tìm theo nội dung, hũ, ngân hàng..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-2xl pl-9 pr-3.5 py-2.5 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]/50"
            />
          </div>

          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <button
              onClick={() => setHistoryFilter('all')}
              className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                historyFilter === 'all'
                  ? 'bg-[#657D81] text-[#F2F5F5]'
                  : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
              }`}
            >
              Tất cả ({confirmedTransactions.length})
            </button>
            <button
              onClick={() => setHistoryFilter('expense')}
              className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                historyFilter === 'expense'
                  ? 'bg-[#E07A7A]/20 text-[#E07A7A] border border-[#E07A7A]/30 font-bold'
                  : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
              }`}
            >
              Khoản chi
            </button>
            <button
              onClick={() => setHistoryFilter('income')}
              className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                historyFilter === 'income'
                  ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/30 font-bold'
                  : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
              }`}
            >
              Khoản thu
            </button>
            <button
              onClick={() => setHistoryFilter('transfer')}
              className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                historyFilter === 'transfer'
                  ? 'bg-[#DEB48A]/20 text-[#DEB48A] border border-[#DEB48A]/30 font-bold'
                  : 'bg-[#1C2426] text-[#869699] border border-[#8BA5AA]/15'
              }`}
            >
              Chuyển nội bộ
            </button>
          </div>

          {/* Transaction list */}
          <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/15 rounded-3xl p-3 divide-y divide-[#8BA5AA]/10">
            {filteredHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#869699]">
                Không tìm thấy giao dịch nào phù hợp
              </div>
            ) : (
              filteredHistory.map((txn) => {
                const jarObj = txn.jarId
                  ? jars.find(j => j.id === txn.jarId)
                  : jars.find(j => j.code === txn.suggestedJarCode);
                return (
                  <div
                    key={txn.id}
                    onClick={() => {
                      setEditingConfirmedTxn(txn);
                      setEditConfirmedDesc(txn.description);
                      setEditConfirmedJarId(txn.jarId || jarObj?.id || '');
                      setEditConfirmedIncomeSourceId(txn.incomeSourceId || '');
                    }}
                    className="py-3 px-2 flex items-center justify-between gap-3 hover:bg-[#232E31]/40 rounded-xl cursor-pointer transition-colors"
                  >
                    <div className="w-9 h-9 rounded-xl bg-[#232E31] border border-[#8BA5AA]/15 flex items-center justify-center font-bold text-xs text-[#BFD0D3] shrink-0">
                      {txn.bankCode}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                        {txn.description}
                      </div>
                      <div className="text-[11px] text-[#869699] flex items-center gap-1.5 mt-0.5">
                        {txn.type === 'expense' && jarObj && (
                          <span className="text-[#D5E1E3] font-medium">Hũ {jarObj.name}</span>
                        )}
                        {txn.type === 'income' && (
                          <span className="text-[#8CC7AE] font-medium">{txn.suggestedCategory || 'Thu nhập'}</span>
                        )}
                        {txn.type === 'transfer' && (
                          <span className="text-[#DEB48A] font-medium">Chuyển nội bộ</span>
                        )}
                        <span>·</span>
                        <span>{txn.occurredAt}</span>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <div
                        className={`num text-xs font-bold ${
                          txn.type === 'income' || txn.type === 'transfer'
                            ? 'text-[#8CC7AE]'
                            : 'text-[#F2F5F5]'
                        }`}
                      >
                        {txn.type === 'income' ? '+' : txn.type === 'transfer' ? '⇄ ' : '−'}
                        {formatVND(txn.amount)}
                      </div>
                      <Edit2 size={13} className="text-[#869699] opacity-60 shrink-0" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ======================= MODAL / SHEET CHỌN HŨ CHI HOẶC NGUỒN THU ======================= */}
      {pickerTxn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[82vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">
                  {pickerTxn.type === 'income' ? 'Chọn nguồn thu nhập' : 'Chọn hũ chi tiêu'}
                </span>
                <span className="text-[11px] text-[#869699] truncate block max-w-xs">
                  {pickerTxn.description} ({formatVND(pickerTxn.amount)})
                </span>
              </div>
              <button
                onClick={() => setPickerTxn(null)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            {/* DANH SÁCH HŨ CHO KHOẢN CHI (EXPENSE) */}
            {pickerTxn.type !== 'income' ? (
              <div className="space-y-2">
                {jars.map((jar) => {
                  const currentAssignment = getTxnAssignment(pickerTxn);
                  const isSelected = currentAssignment.jarId === jar.id;
                  return (
                    <button
                      key={jar.id}
                      onClick={() => {
                        setAssignedOverrides(prev => ({
                          ...prev,
                          [pickerTxn.id]: {
                            jarId: jar.id,
                            jarCode: jar.code,
                            categoryName: jar.name
                          }
                        }));
                        setPickerTxn(null);
                      }}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                        isSelected
                          ? 'bg-[#232E31] border-[#8CC7AE]/50 shadow-md'
                          : 'bg-[#1C2426] border-[#8BA5AA]/15 hover:bg-[#232E31]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-[#0E1314] shadow"
                          style={{ backgroundColor: jar.color || '#657D81' }}
                        >
                          {jar.code.substring(0, 3)}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#F2F5F5] flex items-center gap-2">
                            <span>Hũ {jar.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0E1314] text-[#869699]">
                              {Math.round(jar.targetPercent * 100)}%
                            </span>
                          </div>
                          <div className="text-[10.5px] text-[#869699] mt-0.5">
                            Còn lại {formatVND(Math.max(0, jar.monthlyLimit - jar.spentThisMonth))}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="text-[#8CC7AE]">
                          <CheckCircle2 size={18} />
                        </div>
                      )}
                    </button>
                  );
                })}

                {/* TÙY CHỌN ĐIỀU CHUYỂN NỘI BỘ */}
                {onPairTransfer && accounts && accounts.length > 1 && (
                  <div className="pt-3 border-t border-[#8BA5AA]/20 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#8CC7AE] uppercase tracking-wider flex items-center gap-1">
                        <ArrowRightLeft size={13} /> Hoặc chuyển khoản nội bộ sang:
                      </span>
                      <span className="text-[10px] text-[#869699]">Không trừ hũ</span>
                    </div>

                    <div className="space-y-1.5">
                      {accounts
                        .filter(
                          acc =>
                            acc.name !== pickerTxn.accountName &&
                            (acc.accountNumberMask ? !pickerTxn.accountName.includes(acc.accountNumberMask) : true)
                        )
                        .map((targetAcc) => (
                          <button
                            key={targetAcc.id}
                            type="button"
                            onClick={() => {
                              onPairTransfer(pickerTxn.id, targetAcc.id);
                              setPickerTxn(null);
                            }}
                            className="w-full p-2.5 rounded-xl bg-[#1C2527] hover:bg-[#233134] border border-[#8CC7AE]/30 flex items-center justify-between text-left active:scale-98 transition-all"
                          >
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-[#232E31] text-[#8CC7AE] font-bold text-[11px] flex items-center justify-center border border-[#8CC7AE]/20">
                                {targetAcc.bankCode || 'VÍ'}
                              </div>
                              <div>
                                <div className="text-xs font-semibold text-[#F2F5F5]">{targetAcc.name}</div>
                                <div className="text-[10px] text-[#869699]">
                                  {targetAcc.accountNumberMask ? `*${targetAcc.accountNumberMask}` : 'Tài khoản'}
                                </div>
                              </div>
                            </div>
                            <span className="text-[11px] font-medium text-[#8CC7AE] px-2.5 py-1 rounded-lg bg-[#8CC7AE]/10 border border-[#8CC7AE]/20">
                              Chọn làm ví nhận ›
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* DANH SÁCH NGUỒN THU CHO KHOẢN THU (INCOME) */
              <div className="space-y-2">
                {incomeSources.map((src) => {
                  const currentAssignment = getTxnAssignment(pickerTxn);
                  const isSelected = currentAssignment.incomeSourceId === src.id;
                  return (
                    <button
                      key={src.id}
                      onClick={() => {
                        setAssignedOverrides(prev => ({
                          ...prev,
                          [pickerTxn.id]: {
                            incomeSourceId: src.id,
                            categoryName: src.name
                          }
                        }));
                        setPickerTxn(null);
                      }}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                        isSelected
                          ? 'bg-[#1D2926] border-[#8CC7AE]/50 shadow-md'
                          : 'bg-[#1C2426] border-[#8BA5AA]/15 hover:bg-[#232E31]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-[#0E1314]"
                          style={{ backgroundColor: src.color || '#8CC7AE' }}
                        >
                          <DollarSign size={16} />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#F2F5F5]">
                            {src.name}
                          </div>
                          <div className="text-[10.5px] text-[#869699] mt-0.5">
                            {formatVND(src.expectedAmount)} · {src.recurrence}
                          </div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="text-[#8CC7AE]">
                          <CheckCircle2 size={18} />
                        </div>
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => {
                    setAssignedOverrides(prev => ({
                      ...prev,
                      [pickerTxn.id]: {
                        incomeSourceId: '',
                        categoryName: 'Thu ngoài dự kiến'
                      }
                    }));
                    setPickerTxn(null);
                  }}
                  className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                    getTxnAssignment(pickerTxn).incomeSourceId === ''
                      ? 'bg-[#1D2926] border-[#8CC7AE]/50 shadow-md'
                      : 'bg-[#1C2426] border-[#8BA5AA]/15 hover:bg-[#232E31]/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[#232E31] border border-[#8CC7AE]/30 flex items-center justify-center font-bold text-xs text-[#8CC7AE]">
                      ✨
                    </div>
                    <div>
                      <div className="text-xs font-bold text-[#F2F5F5]">
                        Thu ngoài dự kiến / Thu nhập khác
                      </div>
                      <div className="text-[10.5px] text-[#869699] mt-0.5">
                        Khoản thưởng đột xuất, hoàn tiền, bán đồ...
                      </div>
                    </div>
                  </div>
                  {getTxnAssignment(pickerTxn).incomeSourceId === '' && (
                    <div className="text-[#8CC7AE]">
                      <CheckCircle2 size={18} />
                    </div>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= SHEET CHỈNH SỬA GIAO DỊCH ĐÃ DUYỆT ======================= */}
      {editingConfirmedTxn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">Chi tiết giao dịch</span>
                <span className="text-[11px] text-[#869699]">{editingConfirmedTxn.occurredAt}</span>
              </div>
              <button
                onClick={() => setEditingConfirmedTxn(null)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-[#0E1314] p-3.5 rounded-2xl border border-[#8BA5AA]/15 space-y-1">
              <div className="text-xs text-[#869699]">Số tiền</div>
              <div
                className={`num text-2xl font-bold ${
                  editingConfirmedTxn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#F2F5F5]'
                }`}
              >
                {editingConfirmedTxn.type === 'income' ? '+' : editingConfirmedTxn.type === 'transfer' ? '⇄ ' : '−'}
                {formatVND(editingConfirmedTxn.amount)}
              </div>
              <div className="text-xs text-[#869699] pt-1">
                Tài khoản: <b className="text-[#D5E1E3]">{editingConfirmedTxn.accountName}</b>
              </div>
            </div>

            {/* Sửa nội dung ghi chú */}
            <div>
              <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                Ghi chú nội dung
              </label>
              <input
                type="text"
                value={editConfirmedDesc}
                onChange={(e) => setEditConfirmedDesc(e.target.value)}
                className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
              />
            </div>

            {/* Đổi hũ chi tiêu (nếu là expense) */}
            {editingConfirmedTxn.type === 'expense' && (
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Chuyển sang Hũ khác
                </label>
                <select
                  value={editConfirmedJarId}
                  onChange={(e) => setEditConfirmedJarId(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                >
                  {jars.map((j) => (
                    <option key={j.id} value={j.id} className="bg-[#161C1E] text-white">
                      Hũ {j.name} ({formatVND(Math.max(0, j.monthlyLimit - j.spentThisMonth))})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Đổi nguồn thu (nếu là income) */}
            {editingConfirmedTxn.type === 'income' && (
              <div>
                <label className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                  Nguồn thu nhập
                </label>
                <select
                  value={editConfirmedIncomeSourceId}
                  onChange={(e) => setEditConfirmedIncomeSourceId(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]/50"
                >
                  <option value="" className="bg-[#161C1E] text-white">
                    ✨ Thu ngoài dự kiến / Thu nhập khác
                  </option>
                  {incomeSources.map((src) => (
                    <option key={src.id} value={src.id} className="bg-[#161C1E] text-white">
                      {src.name} ({formatVND(src.expectedAmount)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Hành động */}
            <div className="flex items-center gap-2 pt-2">
              {onDeleteConfirmed && (
                <button
                  type="button"
                  onClick={() => {
                    const txnToDelete = editingConfirmedTxn;
                    setConfirmSheet({
                      isOpen: true,
                      title: 'Xóa giao dịch',
                      description: `Anh có chắc muốn xóa giao dịch "${txnToDelete.description}" (${formatVND(txnToDelete.amount)})? Số dư tài khoản sẽ được hoàn lại tương ứng.`,
                      confirmText: 'Xóa giao dịch',
                      isDanger: true,
                      onConfirm: () => {
                        onDeleteConfirmed(txnToDelete.id);
                        setEditingConfirmedTxn(null);
                      }
                    });
                  }}
                  className="px-3.5 py-2.5 rounded-xl bg-[#282121] hover:bg-[#3B2525] text-[#E06D6D] text-xs font-semibold flex items-center gap-1.5 active:scale-95"
                >
                  <Trash2 size={13} /> Xóa
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (onUpdateConfirmed && editingConfirmedTxn) {
                    if (editingConfirmedTxn.type === 'expense') {
                      const targetJar = jars.find(j => j.id === editConfirmedJarId);
                      onUpdateConfirmed(editingConfirmedTxn.id, {
                        description: editConfirmedDesc.trim() || editingConfirmedTxn.description,
                        jarId: targetJar?.id,
                        jarCode: targetJar?.code,
                        category: targetJar?.name
                      });
                    } else if (editingConfirmedTxn.type === 'income') {
                      const targetSrc = incomeSources.find(s => s.id === editConfirmedIncomeSourceId);
                      onUpdateConfirmed(editingConfirmedTxn.id, {
                        description: editConfirmedDesc.trim() || editingConfirmedTxn.description,
                        incomeSourceId: editConfirmedIncomeSourceId || null,
                        category: targetSrc ? targetSrc.name : 'Thu ngoài dự kiến'
                      });
                    } else {
                      onUpdateConfirmed(editingConfirmedTxn.id, {
                        description: editConfirmedDesc.trim() || editingConfirmedTxn.description
                      });
                    }
                  }
                  setEditingConfirmedTxn(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] font-bold text-xs shadow active:scale-95 transition-transform"
              >
                Lưu thay đổi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Bottom Sheet */}
      <ConfirmSheet
        isOpen={confirmSheet.isOpen}
        title={confirmSheet.title}
        description={confirmSheet.description}
        confirmText={confirmSheet.confirmText}
        isDanger={confirmSheet.isDanger}
        onConfirm={() => {
          confirmSheet.onConfirm();
          setConfirmSheet(prev => ({ ...prev, isOpen: false }));
        }}
        onCancel={() => setConfirmSheet(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
