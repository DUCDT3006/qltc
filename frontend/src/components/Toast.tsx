import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, Info, X, RotateCcw } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  description?: string;
  duration?: number;
  undoAction?: () => void;
  undoLabel?: string;
}

interface ToastContextType {
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  undoToast: (title: string, onUndo: () => void, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastMessage = { ...toast, id };
    setToasts(prev => [...prev, newToast]);

    const dur = toast.duration || (toast.undoAction ? 6000 : 3500);
    setTimeout(() => {
      removeToast(id);
    }, dur);
  }, [removeToast]);

  const success = useCallback((title: string, description?: string) => {
    showToast({ type: 'success', title, description });
  }, [showToast]);

  const error = useCallback((title: string, description?: string) => {
    showToast({ type: 'error', title, description });
  }, [showToast]);

  const info = useCallback((title: string, description?: string) => {
    showToast({ type: 'info', title, description });
  }, [showToast]);

  const undoToast = useCallback((title: string, onUndo: () => void, duration = 6000) => {
    showToast({
      type: 'info',
      title,
      undoAction: onUndo,
      undoLabel: 'Hoàn tác',
      duration
    });
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ showToast, success, error, info, undoToast }}>
      {children}
      {/* Container hiển thị Toast nổi trên Bottom Navigation */}
      <div className="fixed bottom-20 left-4 right-4 z-50 pointer-events-none flex flex-col items-center gap-2 max-w-md mx-auto">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto w-full bg-[#1A2326]/95 backdrop-blur-md border border-[#8BA5AA]/25 rounded-2xl p-3.5 shadow-[0_12px_28px_rgba(0,0,0,0.55)] flex items-center justify-between gap-3 animate-slide-up"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {t.type === 'success' && <CheckCircle2 size={18} className="text-[#8CC7AE] shrink-0" />}
              {t.type === 'error' && <AlertCircle size={18} className="text-[#E06D6D] shrink-0" />}
              {t.type === 'warning' && <AlertCircle size={18} className="text-[#DEB48A] shrink-0" />}
              {t.type === 'info' && <Info size={18} className="text-[#95B0B4] shrink-0" />}

              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#F2F5F5] truncate">{t.title}</div>
                {t.description && (
                  <div className="text-[11px] text-[#869699] truncate">{t.description}</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {t.undoAction && (
                <button
                  type="button"
                  onClick={() => {
                    t.undoAction?.();
                    removeToast(t.id);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-[#8CC7AE]/20 hover:bg-[#8CC7AE]/30 text-[#8CC7AE] text-[11px] font-bold border border-[#8CC7AE]/35 flex items-center gap-1 active:scale-95 transition-all"
                >
                  <RotateCcw size={11} /> {t.undoLabel || 'Hoàn tác'}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="w-6 h-6 rounded-lg text-[#869699] hover:text-[#F2F5F5] flex items-center justify-center active:scale-90"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
