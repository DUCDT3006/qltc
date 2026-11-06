import React, { useState, useEffect } from 'react';
import { Transaction, Jar, IncomeSource, BankAccount } from '../types';
import { formatVND } from '../mockData';
import { Check, X, ArrowLeft, Trash2, Layers, DollarSign, CheckCircle2, ArrowRightLeft, Scissors, Repeat, ArrowRight } from 'lucide-react';

interface InboxSwipeViewProps {
  pendingTransactions: Transaction[];
  confirmedTransactions: Transaction[];
  onConfirm: (id: string, jarCode?: string, categoryName?: string) => void;
  onReject: (id: string) => void;
  onDeleteConfirmed?: (id: string) => void;
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
  onBack,
  jars,
  incomeSources,
  accounts,
  onUnpair,
  onPairTransfer
}) => {
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const activeTxn = pendingTransactions[0];
  const queue = pendingTransactions.slice(1);

  // Danh sách các hũ chi tiêu
  const expenseJars = jars && jars.length > 0 ? jars : [
    { id: 'jar_nec', code: 'NEC', name: 'Thiết yếu', targetPercent: 0.55, monthlyLimit: 25000000, spentThisMonth: 0, color: '#657D81' },
    { id: 'jar_ffa', code: 'FFA', name: 'Tự do tài chính', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 0, color: '#8CC7AE' },
    { id: 'jar_ltss', code: 'LTSS', name: 'Tiết kiệm dài hạn', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 0, color: '#95B0B4' },
    { id: 'jar_edu', code: 'EDU', name: 'Giáo dục', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 0, color: '#7A9599' },
    { id: 'jar_play', code: 'PLAY', name: 'Hưởng thụ', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 0, color: '#D4A373' },
    { id: 'jar_give', code: 'GIVE', name: 'Cho đi', targetPercent: 0.05, monthlyLimit: 2300000, spentThisMonth: 0, color: '#B0C0C3' },
  ];

  // Danh sách các nguồn thu nhập
  const allIncomeSources = [
    { id: 'inc_salary', name: 'Lương chính', desc: 'Lương cố định công ty nhận hàng tháng', jarCode: 'NEC', color: '#657D81' },
    { id: 'inc_freelance', name: 'Thu nhập ngoài / Freelance', desc: 'Dự án ngoài, hoa hồng, làm thêm', jarCode: 'FFA', color: '#8CC7AE' },
    { id: 'inc_passive', name: 'Thu nhập thụ động & Cho thuê', desc: 'Cho thuê căn hộ, mặt bằng, tài sản', jarCode: 'FFA', color: '#8CC7AE' },
    { id: 'inc_interest', name: 'Lãi & Sinh lời tự động', desc: 'Lãi tiền gửi, cổ tức, sinh lời tài khoản', jarCode: 'FFA', color: '#D4A373' },
    { id: 'inc_other', name: 'Thu nhập khác', desc: 'Quà tặng, hoàn tiền, thu hồi nợ', jarCode: 'NEC', color: '#95B0B4' },
    ...(incomeSources || []).map(s => ({
      id: s.id,
      name: s.name,
      desc: s.recurrence,
      jarCode: 'NEC',
      color: s.color || '#657D81'
    }))
  ];

  // Trạng thái hũ / nguồn thu được chọn cho giao dịch hiện tại
  const [selectedJarCode, setSelectedJarCode] = useState<string>('NEC');
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');

  useEffect(() => {
    if (activeTxn) {
      setSelectedJarCode(activeTxn.suggestedJarCode || 'NEC');
      setSelectedCategoryName(
        activeTxn.suggestedCategory || (activeTxn.type === 'income' ? 'Lương chính' : 'Ăn uống')
      );
    }
  }, [activeTxn?.id]);

  const activeJarObj = expenseJars.find(j => j.code === selectedJarCode);

  const filteredHistory = confirmedTransactions.filter(t =>
    t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.suggestedCategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.bankCode.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Top Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="w-8 h-8 rounded-full bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center justify-center text-[#C4D0D2] active:scale-90"
          >
            <ArrowLeft size={16} strokeWidth={2} />
          </button>
          <span className="text-[18px] font-bold text-[#F2F5F5]">Giao dịch</span>
        </div>

        {/* Subtab Switcher */}
        <div className="flex p-0.5 rounded-full bg-[#161C1E] border border-[#8BA5AA]/15">
          <button
            onClick={() => setSubTab('pending')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              subTab === 'pending'
                ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                : 'text-[#869699]'
            }`}
          >
            Chờ duyệt ({pendingTransactions.length})
          </button>
          <button
            onClick={() => setSubTab('history')}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              subTab === 'history'
                ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                : 'text-[#869699]'
            }`}
          >
            Lịch sử ({confirmedTransactions.length})
          </button>
        </div>
      </div>

      {subTab === 'pending' ? (
        /* PENDING SWIPE TAB */
        <div>
          {!activeTxn ? (
            <div className="flex flex-col items-center justify-center min-h-[50vh] px-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-[#657D81]/20 border border-[#8BA5AA]/25 flex items-center justify-center text-[#8CC7AE]">
                <Check size={32} strokeWidth={2.4} />
              </div>
              <div className="text-lg font-bold text-[#F2F5F5]">Tuyệt vời! Đã duyệt hết</div>
              <div className="text-xs text-[#869699] max-w-xs">
                Toàn bộ thông báo biến động số dư từ các app ngân hàng đã được ghi nhận vào sổ tài chính của anh.
              </div>
              <button
                onClick={() => setSubTab('history')}
                className="px-6 py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold shadow-md active:scale-95 transition-transform"
              >
                Xem lịch sử giao dịch
              </button>
            </div>
          ) : (
            <div>
              <div className="text-[11.5px] text-[#869699] pl-10 mb-2">
                Tự động bóc tách từ thông báo ngân hàng
              </div>

              {/* Swipe Card Stack */}
              <div className="relative mt-2 mb-3">
                <div className="absolute left-3.5 right-3.5 -bottom-2 h-10 bg-[#1C2426]/40 border border-[#8BA5AA]/10 rounded-3xl z-0"></div>

                <div className="relative z-10 bg-gradient-to-br from-[#243033] to-[#182022] border border-[#9AB3B8]/30 rounded-3xl p-5 shadow-[0_18px_36px_rgba(0,0,0,0.45)]">
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
                    <span className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-medium border flex items-center gap-1 ${
                      activeTxn.type === 'income'
                        ? 'bg-[#8CC7AE]/15 text-[#8CC7AE] border-[#8CC7AE]/25'
                        : activeTxn.type === 'transfer'
                        ? 'bg-[#8CC7AE]/20 text-[#8CC7AE] border-[#8CC7AE]/40 font-semibold'
                        : 'bg-[#657D81]/25 text-[#BFD0D3] border-[#8BA5AA]/20'
                    }`}>
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

                  <div className={`num text-[29px] font-bold tracking-tight my-2 flex items-center gap-2 ${
                    activeTxn.type === 'income'
                      ? 'text-[#8CC7AE]'
                      : activeTxn.type === 'transfer'
                      ? 'text-[#8CC7AE]'
                      : 'text-[#F2F5F5]'
                  }`}>
                    {activeTxn.type === 'transfer' ? (
                      <ArrowRightLeft size={24} className="text-[#8CC7AE]" />
                    ) : activeTxn.type === 'income' ? (
                      '+'
                    ) : (
                      '−'
                    )}
                    {formatVND(activeTxn.amount)}
                  </div>
                  <div className="text-[13.5px] font-medium text-[#C4D0D2] mb-3">
                    {activeTxn.description}
                  </div>

                  {/* KHI LÀ GIAO DỊCH CHUYỂN TIỀN NỘI BỘ (TRANSFER) */}
                  {activeTxn.type === 'transfer' ? (
                    <div className="bg-[#12191B] border border-[#8CC7AE]/25 rounded-2xl p-3.5 my-3 space-y-3 animate-fade-in shadow-inner">
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
                              {activeTxn.pairedAccountName || 'Tài khoản nhận'}
                            </div>
                            <div className="text-[10px] text-[#8CC7AE]">Tài khoản cộng tiền</div>
                          </div>
                          <div className="w-8 h-8 rounded-lg bg-[#1B2B28] text-[#8CC7AE] font-bold text-xs flex items-center justify-center border border-[#8CC7AE]/30">
                            {activeTxn.pairedBankCode || 'ĐÍCH'}
                          </div>
                        </div>
                      </div>

                      <div className="text-[11px] text-[#869699] bg-[#0A0E0F]/60 rounded-xl p-2.5 leading-relaxed">
                        ✨ <strong>Tự động ghép cặp thông minh:</strong> Hệ thống nhận diện đây là khoản chuyển tiền giữa các tài khoản của anh để phân bổ quỹ. Giao dịch này <strong>không tính vào thu nhập hay chi tiêu</strong> của tháng và không làm lệch hạn mức các hũ.
                      </div>

                      {/* NÚT TÁCH 2 GIAO DỊCH NẾU AUTO-PAIRING BỊ NHẦM */}
                      {onUnpair && (
                        <div className="pt-1 flex items-center justify-between border-t border-[#8BA5AA]/15">
                          <span className="text-[10.5px] text-[#869699]">Ghép nhầm giao dịch?</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm('Anh có chắc muốn tách giao dịch này ra thành 2 khoản độc lập (1 khoản trừ + 1 khoản cộng) không?')) {
                                onUnpair(activeTxn.id);
                              }
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
                          // Hiển thị hũ chi tiêu
                          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#657D81]/25 text-[#DCE6E8] border border-[#8BA5AA]/30">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: activeJarObj?.color || '#657D81' }}></span>
                            {activeJarObj ? `Hũ ${activeJarObj.name}` : `Hũ ${selectedJarCode}`}
                            {selectedCategoryName && selectedCategoryName !== activeJarObj?.name ? ` · ${selectedCategoryName}` : ''}
                          </span>
                        )}

                        <button
                          onClick={() => setIsPickerOpen(true)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold text-[#D5E1E3] bg-[#232E31] border border-[#8BA5AA]/30 active:scale-95 transition-transform"
                        >
                          {activeTxn.type === 'income' ? 'Đổi nguồn thu ▾' : 'Đổi hũ chi / Chuyển nội bộ ▾'}
                        </button>
                      </div>
                    </>
                  )}

                  {/* Nút Bỏ qua / Xác nhận */}
                  <div className="flex items-center justify-between pt-3 border-t border-[#8BA5AA]/15">
                    <button
                      onClick={() => onReject(activeTxn.id)}
                      className="h-10 px-4 rounded-xl flex items-center gap-1.5 text-xs font-semibold border border-[#8BA5AA]/20 bg-white/[0.03] text-[#97A8AB] active:scale-95 transition-transform"
                    >
                      <X size={15} strokeWidth={2} />
                      Bỏ qua
                    </button>
                    <button
                      onClick={() => onConfirm(activeTxn.id, selectedJarCode, selectedCategoryName)}
                      className="h-10 px-6 rounded-xl flex items-center gap-1.5 text-xs font-semibold bg-[#657D81] text-[#F2F5F5] border border-[#BFD0D3]/35 shadow-[0_6px_16px_rgba(101,125,129,0.35)] active:scale-95 transition-transform"
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
                        <div className={`num text-xs font-semibold text-right shrink-0 ${
                          txn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#C4D0D2]'
                        }`}>
                          {txn.type === 'income' ? '+' : '−'}{formatVND(txn.amount)}
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
          <input
            type="text"
            placeholder="Tìm theo nội dung, hũ, ngân hàng..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none"
          />

          <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/15 rounded-3xl p-4 divide-y divide-[#8BA5AA]/10">
            {filteredHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#869699]">
                Chưa có giao dịch nào trong lịch sử
              </div>
            ) : (
              filteredHistory.map((txn) => (
                <div key={txn.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#232E31] border border-[#8BA5AA]/15 flex items-center justify-center font-bold text-xs text-[#BFD0D3] shrink-0">
                    {txn.bankCode}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                      {txn.description}
                    </div>
                    <div className="text-[11px] text-[#869699] flex items-center gap-1.5">
                      <span>{txn.suggestedCategory}</span>
                      <span>·</span>
                      <span>{txn.occurredAt}</span>
                    </div>
                  </div>
                  <div className="text-right flex items-center gap-2">
                    <div className={`num text-xs font-bold ${
                      txn.type === 'income' || txn.type === 'transfer' ? 'text-[#8CC7AE]' : 'text-[#F2F5F5]'
                    }`}>
                      {txn.type === 'income' ? '+' : txn.type === 'transfer' ? '⇄ ' : '−'}{formatVND(txn.amount)}
                    </div>
                    {onDeleteConfirmed && (
                      <button
                        onClick={() => onDeleteConfirmed(txn.id)}
                        className="w-7 h-7 rounded-lg bg-[#282121] text-[#E06D6D] flex items-center justify-center active:scale-90"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* MODAL / SHEET CHỌN HŨ CHI HOẶC NGUỒN THU */}
      {isPickerOpen && activeTxn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[80vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-base font-bold text-[#F2F5F5] block">
                  {activeTxn.type === 'income' ? 'Chọn nguồn thu nhập' : 'Chọn hũ chi tiêu'}
                </span>
                <span className="text-[11px] text-[#869699]">
                  {activeTxn.type === 'income'
                    ? 'Chỉ hiển thị các nguồn thu nhập của anh'
                    : 'Chỉ hiển thị tất cả các hũ chi tiêu hiện có'}
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
                {expenseJars.map((jar) => {
                  const isSelected = selectedJarCode === jar.code;
                  return (
                    <button
                      key={jar.id || jar.code}
                      onClick={() => {
                        setSelectedJarCode(jar.code);
                        setSelectedCategoryName(jar.name);
                        setIsPickerOpen(false);
                      }}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                        isSelected
                          ? 'bg-[#232E31] border-[#8CC7AE]/40'
                          : 'bg-[#1C2426] border-[#8BA5AA]/15 hover:bg-[#232E31]/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs text-[#0E1314]"
                          style={{ backgroundColor: jar.color || '#657D81' }}
                        >
                          {jar.code}
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[#F2F5F5] flex items-center gap-2">
                            <span>Hũ {jar.name}</span>
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#0E1314] text-[#869699]">
                              {Math.round(jar.targetPercent * 100)}%
                            </span>
                          </div>
                          <div className="text-[10.5px] text-[#869699] mt-0.5">
                            {jar.code === 'NEC' && 'Ăn uống, tiền nhà, hóa đơn, di chuyển...'}
                            {jar.code === 'FFA' && 'Đầu tư cổ phiếu, quỹ, coin, vàng tích lũy...'}
                            {jar.code === 'LTSS' && 'Mua sắm lớn, quỹ dự phòng khẩn cấp...'}
                            {jar.code === 'EDU' && 'Học phí, khóa học, sách vở...'}
                            {jar.code === 'PLAY' && 'Cafe, mua sắm giải trí, du lịch...'}
                            {jar.code === 'GIVE' && 'Hiếu hỉ, quà biếu, thiện nguyện...'}
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
                        .filter(acc => acc.name !== activeTxn.accountName && (acc.accountNumberMask ? !activeTxn.accountName.includes(acc.accountNumberMask) : true))
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
                {allIncomeSources.map((src) => {
                  const isSelected = selectedCategoryName === src.name;
                  return (
                    <button
                      key={src.id}
                      onClick={() => {
                        setSelectedCategoryName(src.name);
                        setSelectedJarCode(src.jarCode || 'NEC');
                        setIsPickerOpen(false);
                      }}
                      className={`w-full p-3 rounded-2xl border flex items-center justify-between text-left transition-all ${
                        isSelected
                          ? 'bg-[#1D2926] border-[#8CC7AE]/40'
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
                            {src.desc}
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
