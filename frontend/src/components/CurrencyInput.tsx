import React from 'react';

interface CurrencyInputProps {
  value: number;
  onChange: (val: number) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  showQuickChips?: boolean;
}

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  placeholder = '0 ₫',
  className = '',
  autoFocus = false,
  showQuickChips = true
}) => {
  const displayStr = value > 0 ? new Intl.NumberFormat('vi-VN').format(value) : '';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^\d]/g, '');
    const num = raw ? parseInt(raw, 10) : 0;
    onChange(num);
  };

  const handleMultiply = (mult: number) => {
    onChange(value * mult);
  };

  const handleAdd = (addVal: number) => {
    onChange((value || 0) + addVal);
  };

  return (
    <div className="space-y-1.5 w-full">
      <div className="relative flex items-center">
        <input
          type="text"
          inputMode="numeric"
          autoFocus={autoFocus}
          value={displayStr}
          onChange={handleChange}
          placeholder={placeholder}
          className={`w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3.5 py-2.5 text-xs text-[#F2F5F5] font-bold num focus:outline-none focus:border-[#8CC7AE]/50 transition-colors pr-8 ${className}`}
        />
        <span className="absolute right-3 text-xs font-semibold text-[#869699] pointer-events-none">
          ₫
        </span>
      </div>

      {showQuickChips && (
        <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 no-scrollbar">
          {/* Nhân hàng nghìn / triệu nhanh nếu người dùng vừa gõ số nhỏ */}
          {value > 0 && value < 1000 && (
            <>
              <button
                type="button"
                onClick={() => handleMultiply(1000)}
                className="px-2 py-0.5 rounded-lg bg-[#243033] hover:bg-[#2C3B3F] text-[#8CC7AE] text-[10.5px] font-semibold border border-[#8CC7AE]/30 active:scale-95 shrink-0"
              >
                × 1.000 ({new Intl.NumberFormat('vi-VN').format(value * 1000)} ₫)
              </button>
              <button
                type="button"
                onClick={() => handleMultiply(1000000)}
                className="px-2 py-0.5 rounded-lg bg-[#243033] hover:bg-[#2C3B3F] text-[#DEB48A] text-[10.5px] font-semibold border border-[#DEB48A]/30 active:scale-95 shrink-0"
              >
                × 1.000.000
              </button>
            </>
          )}

          {/* Các chip cộng thêm nhanh */}
          <button
            type="button"
            onClick={() => handleAdd(100000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +100k
          </button>
          <button
            type="button"
            onClick={() => handleAdd(500000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +500k
          </button>
          <button
            type="button"
            onClick={() => handleAdd(1000000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +1tr
          </button>
          <button
            type="button"
            onClick={() => handleAdd(5000000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +5tr
          </button>
          <button
            type="button"
            onClick={() => handleAdd(10000000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +10tr
          </button>
          <button
            type="button"
            onClick={() => handleAdd(20000000)}
            className="px-2 py-0.5 rounded-lg bg-[#1C2426] hover:bg-[#232D30] text-[#D5E1E3] text-[10.5px] font-medium border border-[#8BA5AA]/15 active:scale-95 shrink-0"
          >
            +20tr
          </button>
          {value > 0 && (
            <button
              type="button"
              onClick={() => onChange(0)}
              className="px-2 py-0.5 rounded-lg bg-[#282121] text-[#E06D6D] text-[10.5px] font-medium border border-[#E06D6D]/20 active:scale-95 shrink-0 ml-auto"
            >
              Xóa
            </button>
          )}
        </div>
      )}
    </div>
  );
};
