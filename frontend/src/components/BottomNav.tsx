import React from 'react';
import { LayoutDashboard, ArrowLeftRight, Plus, Wallet, TrendingUp } from 'lucide-react';
import { TabType } from '../types';

interface BottomNavProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  onOpenQuickAdd: () => void;
  pendingCount: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentTab,
  onChangeTab,
  onOpenQuickAdd,
  pendingCount
}) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto min-h-[74px] bg-[#101517]/95 backdrop-blur-xl border-t border-[#8BA5AA]/10 flex justify-around items-center px-2 pb-2 pb-safe z-40">
      <button
        onClick={() => onChangeTab('dashboard')}
        className={`flex flex-col items-center gap-1 w-14 transition-colors ${
          currentTab === 'dashboard' ? 'text-[#D5E1E3] font-semibold' : 'text-[#6E7F82]'
        }`}
      >
        <LayoutDashboard size={20} strokeWidth={currentTab === 'dashboard' ? 2.2 : 1.8} className={currentTab === 'dashboard' ? 'stroke-[#8BA5AA]' : ''} />
        <span className="text-[10px]">Tổng quan</span>
      </button>

      <button
        onClick={() => onChangeTab('transactions')}
        className={`relative flex flex-col items-center gap-1 w-14 transition-colors ${
          currentTab === 'transactions' ? 'text-[#D5E1E3] font-semibold' : 'text-[#6E7F82]'
        }`}
      >
        <ArrowLeftRight size={20} strokeWidth={currentTab === 'transactions' ? 2.2 : 1.8} className={currentTab === 'transactions' ? 'stroke-[#8BA5AA]' : ''} />
        <span className="text-[10px]">Giao dịch</span>
        {pendingCount > 0 && (
          <span className="absolute -top-1 right-2 w-4 h-4 rounded-full bg-[#657D81] text-white text-[9px] font-bold flex items-center justify-center border border-[#101517]">
            {pendingCount}
          </span>
        )}
      </button>

      {/* Floating Center Add Button */}
      <button
        onClick={onOpenQuickAdd}
        className="w-12 h-12 rounded-[18px] bg-gradient-to-br from-[#7A9599] to-[#556B6F] text-[#F2F5F5] flex items-center justify-center -mt-5 shadow-[0_10px_24px_rgba(101,125,129,0.45)] border-t border-white/25 active:scale-90 transition-transform"
      >
        <Plus size={22} strokeWidth={2.4} />
      </button>

      <button
        onClick={() => onChangeTab('budget')}
        className={`flex flex-col items-center gap-1 w-14 transition-colors ${
          currentTab === 'budget' ? 'text-[#D5E1E3] font-semibold' : 'text-[#6E7F82]'
        }`}
      >
        <Wallet size={20} strokeWidth={currentTab === 'budget' ? 2.2 : 1.8} className={currentTab === 'budget' ? 'stroke-[#8BA5AA]' : ''} />
        <span className="text-[10px]">Ngân sách</span>
      </button>

      <button
        onClick={() => onChangeTab('investments')}
        className={`flex flex-col items-center gap-1 w-14 transition-colors ${
          currentTab === 'investments' ? 'text-[#D5E1E3] font-semibold' : 'text-[#6E7F82]'
        }`}
      >
        <TrendingUp size={20} strokeWidth={currentTab === 'investments' ? 2.2 : 1.8} className={currentTab === 'investments' ? 'stroke-[#8BA5AA]' : ''} />
        <span className="text-[10px]">Đầu tư</span>
      </button>
    </nav>
  );
};
