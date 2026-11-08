import React, { useState, useEffect, useRef } from 'react';
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
  Edit2
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
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  // Modal / Sheet chỉnh sửa giao dịch đã duyệt
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

  const activeTxn = pendingTransactions[0];
  const queue = pendingTransactions.slice(1);

  // Tìm hũ mặc định an toàn
  const defaultJar = jars.find(j => j.isDefault) || jars[0];

  // Trạng thái hũ / nguồn thu được chọn cho giao dịch hiện tại
  const [selectedJarId, setSelectedJarId] = useState<string>('');
  const [selectedIncomeSourceId, setSelectedIncomeSourceId] = useState<string>('');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');

  // Touch Swipe Gesture State
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (activeTxn) {
      setSwipeOffset(0);
      setIsDragging(false);

      if (activeTxn.type === 'income') {
        const matchedSource = incomeSources.find(
          s => s.id === activeTxn.incomeSourceId || s.name.toLowerCase() === (activeTxn.suggestedCategory || '').toLowerCase()
        );
        if (matchedSource) {
          setSelectedIncomeSourceId(matchedSource.id);
          setSelectedCategoryName(matchedSource.name);
        } else if (incomeSources.length > 0) {
          setSelectedIncomeSourceId(incomeSources[0].id);
          setSelectedCategoryName(incomeSources[0].name);
        } else {
          setSelectedIncomeSourceId('');
          setSelectedCategoryName('Thu ngoài dự kiến');
        }
      } else {
        // Expense fallback: tìm theo jarId, sau đó suggestedJarCode, sau đó defaultJar
        const matchedJar =
          jars.find(j => j.id === activeTxn.jarId) ||
          jars.find(j => j.code === activeTxn.suggestedJarCode) ||
          defaultJar;

        setSelectedJarId(matchedJar?.id || '');
        setSelectedCategoryName(matchedJar?.name || activeTxn.suggestedCategory || 'Thiết yếu');
      }
    }
  }, [activeTxn?.id, jars, incomeSources]);

  const activeJarObj = jars.find(j => j.id === selectedJarId) || defaultJar;

  // Swipe handlers
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
      handleConfirmCurrent();
    } else if (swipeOffset < -90) {
      // Kéo sang trái = Bỏ qua
      handleRejectCurrent();
    }
    setSwipeOffset(0);
    setTouchStartX(null);
  };

  const handleConfirmCurrent = () => {
    if (!activeTxn) return;
    if (activeTxn.type === 'income') {
      const src = incomeSources.find(s => s.id === selectedIncomeSourceId);
      onConfirm(
        activeTxn.id,
        undefined,
        src?.name || selectedCategoryName || 'Thu ngoài dự kiến',
        undefined,
        selectedIncomeSourceId || undefined
      );
    } else if (activeTxn.type === 'transfer') {
      onConfirm(activeTxn.id);
    } else {
      onConfirm(activeTxn.id, activeJarObj?.code, activeJarObj?.name, activeJarObj?.id);
    }
  };

  const handleRejectCurrent = () => {
    if (!activeTxn) return;
    onReject(activeTxn.id);
  };

  // Filter lịch sử
  const filteredHistory = confirmedTransactions.filter(t => {
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

  return (
    <div className="space-y-3 pb-24 px-4 select-none">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center justify-center text-[#C4D0D2] active:scale-90"
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
          {!activeTxn ? (
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
            <div className="space-y-4">
              {/* Chỉ dẫn kéo vuốt */}
              <div className="flex items-center justify-between text-[11px] text-[#869699] px-2">
                <span>👈 Vuốt trái để Bỏ qua</span>
                <span>Vuốt phải để Duyệt 👉</span>
              </div>

              {/* Swipe Card Stack */}
              <div className="relative mt-1 mb-3">
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
                          <Repeat size={11} /> Chuyển nội bộ (Auto-paired)
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
                        {/* Tài khoản nguồn */}
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-lg bg-[#232E31] text-[#D5E1E3] font-bold text-xs flex items-center justify-center border border-[#8BA5AA]/20">
                            {activeTxn.bankCode}
                          </div>
                          <div>
                            <div className="font-semibold text-[#F2F5F5] text-xs">{activeTxn.accountName}</div>
                            <div className="text-[10px] text-[#E07A5F]">Tài khoản trừ tiền</div>
                          </div>
                        </div>

                        {/* Mũi tên điều chuyển */}
                        <div className="flex flex-col items-center px-2 text-[#8CC7AE]">
                          <ArrowRight size={16} />
                          <span className="text-[9px] font-mono">Điều chuyển</span>
                        </div>

                        {/* Tài khoản nhận */}
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

                      {/* NÚT TÁCH 2 GIAO DỊCH NẾU AUTO-PAIRING BỊ NHẦM */}
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
                          // Hiển thị nguồn thu
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#8CC7AE]/20 text-[#8CC7AE] border border-[#8CC7AE]/30">
                            <DollarSign size={13} /> {selectedCategoryName || 'Thu nhập'}
                          </span>
                        ) : (
                          // Hiển thị hũ chi tiêu (Chỉ hiển thị tên hũ sạch sẽ, KHÔNG ghép 2 hũ)
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#657D81]/25 text-[#DCE6E8] border border-[#8BA5AA]/30">
                            <span
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ backgroundColor: activeJarObj?.color || '#657D81' }}
                            ></span>
                            <span>Hũ {activeJarObj?.name || 'Chi tiêu'}</span>
                          </span>
                        )}

                        <button
                          onClick={() => setIsPickerOpen(true)}
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
                      onClick={handleRejectCurrent}
                      className="h-10 px-4 rounded-xl flex items-center gap-1.5 text-xs font-semibold border border-[#8BA5AA]/20 bg-white/[0.03] hover:bg-white/[0.08] text-[#97A8AB] active:scale-95 transition-transform"
                    >
                      <X size={15} strokeWidth={2} />
                      Bỏ qua
                    </button>
                    <button
                      onClick={handleConfirmCurrent}
                      className="h-10 px-6 rounded-xl flex items-center gap-1.5 text-xs font-semibold bg-[#657D81] hover:bg-[#789397] text-[#F2F5F5] border border-[#BFD0D3]/35 shadow-[0_6px_16px_rgba(101,125,129,0.35)] active:scale-95 transition-transform"
                    >
                      <Check size={16} strokeWidth={2.4} />
                      {activeTxn.type === 'transfer' ? 'Xác nhận chuyển nội bộ' : 'Xác nhận duyệt'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Queue items */}
              {queue.length > 0 && (
                <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4">
                  <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider mb-2">
                    Tiếp theo trong hàng đợi ({queue.length})
                  </div>
                  <div className="divide-y divide-[#8BA5AA]/10">
                    {queue.map((txn) => (
                      <div key={txn.id} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#232E31] border border-[#8BA5AA]/15 flex items-center justify-center font-bold text-[10.5px] text-[#BFD0D3] shrink-0">
                          {txn.bankCode}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                            {txn.description}
                          </div>
                          <div className="text-[10.5px] text-[#869699] truncate">
                            {txn.suggestedCategory}
                          </div>
                        </div>
                        <div
                          className={`num text-xs font-semibold text-right shrink-0 ${
                            txn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#C4D0D2]'
                          }`}
                        >
                          {txn.type === 'income' ? '+' : '−'}
                          {formatVND(txn.amount)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* HISTORY TAB */
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

      {/* MODAL / SHEET CHỌN HŨ CHI HOẶC NGUỒN THU */}
      {isPickerOpen && activeTxn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
          <div className="w-full max-w-md max-h-[82vh] overflow-y-auto bg-[#161C1E] border-t sm:border border-[#8BA5AA]/20 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">
                  {activeTxn.type === 'income' ? 'Chọn nguồn thu nhập' : 'Chọn hũ chi tiêu'}
                </span>
                <span className="text-[11px] text-[#869699]">
                  {activeTxn.type === 'income'
                    ? 'Chỉ hiển thị các nguồn thu nhập của anh'
                    : 'Chỉ hiển thị danh mục các hũ chi tiêu hiện có'}
                </span>
              </div>
              <button
                onClick={() => setIsPickerOpen(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90"
              >
                <X size={18} />
              </button>
            </div>

            {/* DANH SÁCH HŨ CHO KHOẢN CHI (EXPENSE) */}
            {activeTxn.type !== 'income' ? (
              <div className="space-y-2">
                {jars.map((jar) => {
                  const isSelected = selectedJarId === jar.id;
                  return (
                    <button
                      key={jar.id}
                      onClick={() => {
                        setSelectedJarId(jar.id);
                        setSelectedCategoryName(jar.name);
                        setIsPickerOpen(false);
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

                {/* TÙY CHỌN ĐIỀU CHUYỂN NỘI BỘ (PHƯƠNG ÁN 2) */}
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
                            acc.name !== activeTxn.accountName &&
                            (acc.accountNumberMask ? !activeTxn.accountName.includes(acc.accountNumberMask) : true)
                        )
                        .map((targetAcc) => (
                          <button
                            key={targetAcc.id}
                            type="button"
                            onClick={() => {
                              onPairTransfer(activeTxn.id, targetAcc.id);
                              setIsPickerOpen(false);
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
                  const isSelected = selectedIncomeSourceId === src.id;
                  return (
                    <button
                      key={src.id}
                      onClick={() => {
                        setSelectedIncomeSourceId(src.id);
                        setSelectedCategoryName(src.name);
                        setIsPickerOpen(false);
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

                {/* L-08: Luôn có lựa chọn Thu ngoài dự kiến để không bao giờ bị trống danh sách */}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedIncomeSourceId('');
                    setSelectedCategoryName('Thu ngoài dự kiến');
                    setIsPickerOpen(false);
                  }}
                  className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                    selectedIncomeSourceId === ''
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
                  {selectedIncomeSourceId === '' && (
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

      {/* SHEET CHỈNH SỬA GIAO DỊCH ĐÃ DUYỆT */}
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
