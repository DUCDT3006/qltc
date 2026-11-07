import React from 'react';
import { Bell, RefreshCw } from 'lucide-react';
import { UserProfile } from '../types';

interface NavbarProps {
  pendingCount: number;
  onOpenInbox: () => void;
  onOpenSettings: () => void;
  onRefresh?: () => void;
  isSyncing?: boolean;
  userProfile?: UserProfile;
}

export const Navbar: React.FC<NavbarProps> = ({
  pendingCount,
  onOpenInbox,
  onOpenSettings,
  onRefresh,
  isSyncing = false,
  userProfile
}) => {
  const initial = (userProfile?.name?.trim() || 'A')[0].toUpperCase();
  const displayName = userProfile?.name?.trim();
  const greeting = displayName
    ? (displayName.toLowerCase().startsWith('chào') ? displayName : `Chào ${displayName}`)
    : 'Chào anh';

  return (
    <header className="flex items-center justify-between px-5 pt-4 pb-3">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSettings}
          title="Tài khoản & Cài đặt"
          className="w-10 h-10 rounded-full bg-gradient-to-br from-[#657D81] to-[#3E4F52] flex items-center justify-center font-bold text-sm text-[#F2F5F5] border border-white/15 shadow-sm active:scale-95 transition-transform overflow-hidden relative"
        >
          {userProfile?.avatar ? (
            <img
              src={userProfile.avatar}
              alt={displayName || 'Avatar'}
              className="w-full h-full object-cover"
            />
          ) : (
            <span>{initial}</span>
          )}
        </button>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[#869699] font-medium">Hôm nay</span>
            <span className="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-[#232E31] text-[#8CC7AE] border border-[#8CC7AE]/20">v1.1.0</span>
          </div>
          <div className="text-[16px] font-semibold text-[#F2F5F5] leading-tight truncate max-w-[150px]">
            {greeting}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Nút Làm mới / Đồng bộ từ Cloudflare */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isSyncing}
            title="Đồng bộ thông báo từ ngân hàng"
            className="w-9 h-9 rounded-full bg-[#1C2426]/80 border border-[#8BA5AA]/15 flex items-center justify-center text-[#C4D0D2] active:scale-95 transition-transform"
          >
            <RefreshCw size={15} className={isSyncing ? 'animate-spin text-[#8CC7AE]' : ''} />
          </button>
        )}

        {pendingCount > 0 && (
          <button
            onClick={onOpenInbox}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold bg-[#657D81]/20 text-[#BFD0D3] border border-[#8BA5AA]/25 active:scale-95 transition-transform"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#95B0B4] animate-pulse"></span>
            {pendingCount} chờ duyệt
          </button>
        )}
        <button
          onClick={onOpenInbox}
          className="relative w-9 h-9 rounded-full bg-[#1C2426]/80 border border-[#8BA5AA]/15 flex items-center justify-center text-[#C4D0D2] active:scale-95 transition-transform"
        >
          <Bell size={18} strokeWidth={1.8} />
          {pendingCount > 0 && (
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[#D4A373]"></span>
          )}
        </button>
      </div>
    </header>
  );
};
