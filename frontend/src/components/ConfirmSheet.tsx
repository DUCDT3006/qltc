import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmSheetProps {
  isOpen: boolean;
  title: string;
  message?: string;
  description?: string;
  confirmLabel?: string;
  confirmText?: string;
  cancelLabel?: string;
  isDangerous?: boolean;
  isDanger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmSheet: React.FC<ConfirmSheetProps> = ({
  isOpen,
  title,
  message,
  description,
  confirmLabel = 'Xác nhận',
  confirmText,
  cancelLabel = 'Hủy',
  isDangerous = false,
  isDanger,
  onConfirm,
  onCancel
}) => {
  if (!isOpen) return null;

  const displayMessage = description || message || '';
  const displayConfirm = confirmText || confirmLabel;
  const isAlert = isDanger !== undefined ? isDanger : isDangerous;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-sm bg-[#161C1E] border border-[#8BA5AA]/25 rounded-3xl p-5 shadow-2xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isAlert ? 'bg-[#2E1E20] text-[#E06D6D] border border-[#E06D6D]/30' : 'bg-[#232F32] text-[#8CC7AE] border border-[#8CC7AE]/30'
            }`}>
              <AlertTriangle size={18} />
            </div>
            <div className="text-sm font-bold text-[#F2F5F5]">{title}</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded-full bg-[#20292B] text-[#869699] flex items-center justify-center active:scale-90"
          >
            <X size={15} />
          </button>
        </div>

        <div className="text-xs text-[#C4D0D2] leading-relaxed">
          {displayMessage}
        </div>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="py-2.5 rounded-xl bg-[#20292B] text-[#D5E1E3] text-xs font-semibold hover:bg-[#283437] active:scale-98 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`py-2.5 rounded-xl text-xs font-bold active:scale-98 transition-all ${
              isAlert
                ? 'bg-[#E06D6D] text-[#140E0E] hover:bg-[#EB8080]'
                : 'bg-[#8CC7AE] text-[#0E1314] hover:bg-[#9ED4BC]'
            }`}
          >
            {displayConfirm}
          </button>
        </div>
      </div>
    </div>
  );
};
