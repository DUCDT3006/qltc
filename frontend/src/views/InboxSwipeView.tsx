import React, { useState } from 'react';
import { Transaction } from '../types';
import { formatVND } from '../mockData';
import { Check, X, ArrowLeft, Trash2 } from 'lucide-react';

interface InboxSwipeViewProps {
  pendingTransactions: Transaction[];
  confirmedTransactions: Transaction[];
  onConfirm: (id: string) => void;
  onReject: (id: string) => void;
  onDeleteConfirmed?: (id: string) => void;
  onBack: () => void;
}

export const InboxSwipeView: React.FC<InboxSwipeViewProps> = ({
  pendingTransactions,
  confirmedTransactions,
  onConfirm,
  onReject,
  onDeleteConfirmed,
  onBack
}) => {
  const [subTab, setSubTab] = useState<'pending' | 'history'>('pending');
  const [selectedJar, setSelectedJar] = useState<string>('Hũ Thiết yếu');
  const [searchQuery, setSearchQuery] = useState('');

  const activeTxn = pendingTransactions[0];
  const queue = pendingTransactions.slice(1);

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
                Toàn bộ thông báo biến động số dư từ các app ngân hàng đã được ghi nhận vào sổ tài chính của bạn.
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
                    <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-medium bg-[#657D81]/25 text-[#BFD0D3] border border-[#8BA5AA]/20">
                      {activeTxn.type === 'income' ? 'Tiền vào' : activeTxn.type === 'transfer' ? 'Chuyển khoản' : 'Chi tiêu'}
                    </span>
                  </div>

                  <div className={`num text-[29px] font-bold tracking-tight my-2 ${
                    activeTxn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#F2F5F5]'
                  }`}>
                    {activeTxn.type === 'income' ? '+' : '−'}{formatVND(activeTxn.amount)}
                  </div>
                  <div className="text-[13.5px] font-medium text-[#C4D0D2] mb-3">
                    {activeTxn.description}
                  </div>

                  {activeTxn.rawQuote && (
                    <div className="bg-[#0C1011]/60 border border-[#8BA5AA]/15 rounded-xl p-2.5 text-[11px] font-mono text-[#97A8AB] leading-relaxed mb-3">
                      "{activeTxn.rawQuote}"
                    </div>
                  )}

                  <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider mb-2">
                    Gợi ý phân bổ (96% khớp)
                  </div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium bg-[#657D81]/25 text-[#DCE6E8] border border-[#8BA5AA]/30">
                      {selectedJar} · {activeTxn.suggestedCategory}
                    </span>
                    <button
                      onClick={() => setSelectedJar(selectedJar === 'Hũ Thiết yếu' ? 'Hũ Hưởng thụ' : 'Hũ Thiết yếu')}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs text-[#869699] border border-dashed border-[#8BA5AA]/25 active:bg-white/5"
                    >
                      Đổi hũ ▾
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-[#8BA5AA]/15">
                    <button
                      onClick={() => onReject(activeTxn.id)}
                      className="h-9 px-4 rounded-xl flex items-center gap-1.5 text-xs font-semibold border border-[#8BA5AA]/20 bg-white/[0.03] text-[#97A8AB] active:scale-95 transition-transform"
                    >
                      <X size={15} strokeWidth={2} />
                      Bỏ qua
                    </button>
                    <button
                      onClick={() => onConfirm(activeTxn.id)}
                      className="h-9 px-5 rounded-xl flex items-center gap-1.5 text-xs font-semibold bg-[#657D81] text-[#F2F5F5] border border-[#BFD0D3]/35 shadow-[0_6px_16px_rgba(101,125,129,0.35)] active:scale-95 transition-transform"
                    >
                      <Check size={16} strokeWidth={2.4} />
                      Xác nhận
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
            placeholder="Tìm theo nội dung, danh mục, ngân hàng..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl px-4 py-2.5 text-xs text-[#F2F5F5] placeholder-[#6E7F82] focus:outline-none focus:border-[#95B0B4]"
          />

          <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4 divide-y divide-[#8BA5AA]/10">
            {filteredHistory.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#869699]">
                Không tìm thấy giao dịch nào.
              </div>
            ) : (
              filteredHistory.map((txn) => (
                <div key={txn.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#232E31] border border-[#8BA5AA]/18 flex items-center justify-center font-bold text-xs text-[#BFD0D3] shrink-0">
                    {txn.bankCode}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-semibold text-[#F2F5F5] truncate">
                      {txn.description}
                    </div>
                    <div className="text-[10.5px] text-[#869699] flex items-center gap-2">
                      <span>{txn.occurredAt}</span>
                      <span>•</span>
                      <span>{txn.suggestedCategory}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`num text-xs font-semibold ${
                      txn.type === 'income' ? 'text-[#8CC7AE]' : 'text-[#F2F5F5]'
                    }`}>
                      {txn.type === 'income' ? '+' : '−'}{formatVND(txn.amount)}
                    </span>
                    {onDeleteConfirmed && (
                      <button
                        onClick={() => onDeleteConfirmed(txn.id)}
                        className="text-[#6E7F82] hover:text-[#D98A8A]"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
