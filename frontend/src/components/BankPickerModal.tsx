import React, { useState, useMemo, useRef, useEffect } from 'react';
import { VIETNAM_BANKS, POPULAR_BANK_CODES, VietnamBank } from '../utils/vietnamBanks';
import { Search, X, Check, Building2 } from 'lucide-react';
import { useManagedOverlay } from '../utils/overlayManager';

interface BankPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCode?: string;
  onSelect: (bank: VietnamBank) => void;
}

export const BankPickerModal: React.FC<BankPickerModalProps> = ({
  isOpen,
  onClose,
  selectedCode,
  onSelect
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogProps = useManagedOverlay(isOpen, onClose, 'Chọn ngân hàng', inputRef);

  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Lọc ngân hàng theo từ khóa tìm kiếm nhanh
  const filteredBanks = useMemo(() => {
    if (!searchTerm.trim()) return VIETNAM_BANKS;
    const query = searchTerm.toLowerCase().trim();

    return VIETNAM_BANKS.filter(bank => {
      const codeMatch = bank.code.toLowerCase().includes(query);
      const shortNameMatch = bank.shortName.toLowerCase().includes(query);
      const nameMatch = bank.name.toLowerCase().includes(query);
      const binMatch = bank.bin.includes(query);

      // Tìm kiếm theo các chữ cái đầu (VD: vcb, tcb, hdb, vtb, bidv...)
      const initials = bank.name
        .split(' ')
        .filter(Boolean)
        .map(w => w[0]?.toLowerCase())
        .join('');
      const initialsMatch = initials.includes(query);

      return codeMatch || shortNameMatch || nameMatch || binMatch || initialsMatch;
    });
  }, [searchTerm]);

  // Danh sách ngân hàng phổ biến
  const popularBanks = useMemo(() => {
    return POPULAR_BANK_CODES.map(code => VIETNAM_BANKS.find(b => b.code === code)).filter(Boolean) as VietnamBank[];
  }, []);

  if (!isOpen) return null;

  return (
    <div {...dialogProps} className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[88vh] flex flex-col bg-[#161C1E] border-t sm:border border-[#8BA5AA]/25 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-[#8BA5AA]/15 flex items-center justify-between shrink-0">
          <div>
            <span className="text-base font-bold text-[#F2F5F5] block">Chọn Ngân hàng Việt Nam</span>
            <span className="text-[11px] text-[#869699]">
              Hệ thống {VIETNAM_BANKS.length} ngân hàng & ví điện tử chuẩn VietQR / Napas
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] hover:text-[#F2F5F5] flex items-center justify-center active:scale-90"
          >
            <X size={18} />
          </button>
        </div>

        {/* Thanh tìm kiếm nhanh */}
        <div className="p-3.5 border-b border-[#8BA5AA]/10 bg-[#12181A] shrink-0">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-3 text-[#869699]" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Nhập tên viết tắt, mã code, chữ cái đầu (VD: vcb, tcb, mb, hd, bidv...)"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#1C2426] border border-[#8BA5AA]/25 rounded-2xl pl-10 pr-9 py-2.5 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-3 top-2.5 text-[#869699] hover:text-[#F2F5F5]"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Thân danh sách */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar">
          {/* Nhóm ngân hàng phổ biến (khi không tìm kiếm) */}
          {!searchTerm && (
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider px-1">
                Ngân hàng phổ biến ({popularBanks.length})
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {popularBanks.map((bank) => {
                  const isSelected = selectedCode?.toUpperCase() === bank.code.toUpperCase();
                  return (
                    <button
                      key={bank.code}
                      type="button"
                      onClick={() => {
                        onSelect(bank);
                        onClose();
                      }}
                      className={`p-2.5 rounded-2xl border flex items-center gap-2.5 text-left transition-all active:scale-95 ${
                        isSelected
                          ? 'bg-[#233336] border-[#8CC7AE] shadow-md'
                          : 'bg-[#1C2426] border-[#8BA5AA]/15 hover:bg-[#222E31]'
                      }`}
                    >
                      <div className="w-8 h-8 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                        {bank.logo ? (
                          <img
                            src={bank.logo}
                            alt={bank.shortName}
                            className="w-full h-full object-contain"
                            loading="lazy"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          <Building2 size={16} className="text-[#0E1314]" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-[#F2F5F5] truncate">{bank.shortName}</div>
                        <div className="text-[10px] text-[#869699] font-mono">{bank.code}</div>
                      </div>
                      {isSelected && <Check size={14} className="text-[#8CC7AE] shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Danh sách tất cả các ngân hàng */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider px-1">
              {searchTerm ? `Kết quả tìm kiếm (${filteredBanks.length})` : `Tất cả ngân hàng (${filteredBanks.length})`}
            </div>

            {filteredBanks.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#869699] bg-[#1C2426]/40 rounded-2xl border border-dashed border-[#8BA5AA]/15">
                Không tìm thấy ngân hàng nào khớp với "{searchTerm}".
              </div>
            ) : (
              <div className="divide-y divide-[#8BA5AA]/10 bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl overflow-hidden">
                {filteredBanks.map((bank) => {
                  const isSelected = selectedCode?.toUpperCase() === bank.code.toUpperCase();
                  return (
                    <button
                      key={bank.code}
                      type="button"
                      onClick={() => {
                        onSelect(bank);
                        onClose();
                      }}
                      className={`w-full p-3 flex items-center justify-between gap-3 text-left transition-colors active:bg-[#28383B] ${
                        isSelected ? 'bg-[#223235]' : 'hover:bg-[#20292B]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-9 h-9 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                          {bank.logo ? (
                            <img
                              src={bank.logo}
                              alt={bank.shortName}
                              className="w-full h-full object-contain"
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                          ) : (
                            <span className="text-[11px] font-bold text-[#0E1314]">{bank.code}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[#F2F5F5]">{bank.shortName}</span>
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#0E1314] text-[#869699] border border-[#8BA5AA]/15">
                              {bank.code}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#869699] truncate mt-0.5">{bank.name}</div>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="text-[#8CC7AE] shrink-0">
                          <Check size={16} strokeWidth={2.4} />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
