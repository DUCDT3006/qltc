import React from 'react';
import { Sparkline } from '../components/Sparkline';
import { Jar, Holding } from '../types';
import { formatVND } from '../mockData';

interface DashboardViewProps {
  netWorth: number;
  liquidCash: number;
  totalInvestments: number;
  jars: Jar[];
  holdings: Holding[];
  pendingCount: number;
  privacyMode: boolean;
  onOpenInbox: () => void;
  onOpenBudget: () => void;
  onOpenInvestments: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  netWorth,
  liquidCash,
  totalInvestments,
  jars,
  pendingCount,
  privacyMode,
  onOpenInbox,
  onOpenBudget,
  onOpenInvestments
}) => {
  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Pending Banner if any */}
      {pendingCount > 0 && (
        <div
          onClick={onOpenInbox}
          className="bg-gradient-to-r from-[#273336] to-[#182022] border border-[#8BA5AA]/25 rounded-2xl p-3 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform shadow-md"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#95B0B4] animate-ping"></span>
            <span className="text-xs font-semibold text-[#F2F5F5]">
              {pendingCount} giao dịch ngân hàng mới chờ bạn duyệt
            </span>
          </div>
          <span className="text-xs font-bold text-[#8CC7AE]">Xem ngay ›</span>
        </div>
      )}

      {/* Hero Card: Net Worth */}
      <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-5 shadow-[0_16px_36px_rgba(0,0,0,0.35)] relative overflow-hidden">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
            Tài sản ròng
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#7EB89E]/15 text-[#8CC7AE] border border-[#7EB89E]/25">
            +2,4% tháng này
          </span>
        </div>

        <div className="num text-[30px] font-bold text-[#F2F5F5] tracking-tight my-1">
          {privacyMode ? '••••••••••' : new Intl.NumberFormat('vi-VN').format(netWorth)}{' '}
          <span className="text-[20px] font-normal text-[#95B0B4]">₫</span>
        </div>

        <div className="text-[11.5px] text-[#869699] mb-1">
          {privacyMode
            ? '•••••• tiền mặt · •••••• đầu tư'
            : `${new Intl.NumberFormat('vi-VN').format(Math.round(liquidCash / 1000000))}tr tiền mặt · ${new Intl.NumberFormat('vi-VN').format(Math.round(totalInvestments / 1000000))}tr đầu tư`}
        </div>

        <Sparkline />
      </div>

      {/* Month Cashflow Card */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
            Dòng tiền tháng 11
          </span>
          <span className="text-[11.5px] text-[#869699]">
            Tiết kiệm <b className="text-[#D5E1E3] font-semibold">37,8%</b>
          </span>
        </div>

        <div className="flex items-center justify-between num mb-2.5">
          <div>
            <div className="text-[11px] text-[#869699]">Thu nhập (3 nguồn)</div>
            <div className="text-[16.5px] font-bold text-[#F2F5F5] mt-0.5">
              {privacyMode ? '•••••• ₫' : '+45.200.000 ₫'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[#869699]">Đã chi</div>
            <div className="text-[16.5px] font-semibold text-[#B0C0C3] mt-0.5">
              {privacyMode ? '•••••• ₫' : '−28.100.000 ₫'}
            </div>
          </div>
        </div>

        <div className="h-1.5 flex gap-1 rounded-full bg-transparent overflow-hidden">
          <div className="bg-[#95B0B4] h-full rounded-full" style={{ width: '62%' }}></div>
          <div className="bg-[#263134] h-full flex-1 rounded-full"></div>
        </div>
      </div>

      {/* Budget 4 Jars Mini Summary */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4.5">
        <div className="flex items-center justify-between mb-2.5">
          <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
            Phân bổ ngân sách
          </span>
          <button onClick={onOpenBudget} className="text-[11.5px] text-[#869699] hover:text-[#F2F5F5]">
            6 hũ · còn 16,8tr ›
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {jars.slice(0, 4).map((jar) => {
            const pct = Math.min(100, Math.round((jar.spentThisMonth / jar.monthlyLimit) * 100));
            const isWarn = jar.code === 'PLAY' || pct >= 90;
            return (
              <div
                key={jar.id}
                className={`bg-white/[0.025] border rounded-2xl p-2.5 flex flex-col justify-between ${
                  isWarn ? 'border-[#D4A373]/30' : 'border-[#8BA5AA]/10'
                }`}
              >
                <div className="flex items-center justify-between text-[12px] font-semibold mb-1">
                  <span>{jar.name}</span>
                  <span className={`num text-[11px] ${isWarn ? 'text-[#DEB48A]' : 'text-[#95B0B4]'}`}>
                    {pct}%
                  </span>
                </div>
                <div className="text-[10.5px] text-[#869699] num mb-2">
                  Còn {privacyMode ? '••••••' : formatVND(jar.monthlyLimit - jar.spentThisMonth)}
                </div>
                <div className="h-1 rounded-full bg-[#232D30] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${isWarn ? 'bg-[#D4A373]' : 'bg-[#657D81]'}`}
                    style={{ width: `${pct}%` }}
                  ></div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Investment Summary Card */}
      <div
        onClick={onOpenInvestments}
        className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4.5 flex items-center justify-between cursor-pointer active:scale-[0.99] transition-transform"
      >
        <div>
          <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
            Danh mục đầu tư
          </div>
          <div className="num text-[17px] font-bold text-[#F2F5F5] mt-1 flex items-center gap-1.5">
            {privacyMode ? '•••••••••• ₫' : '356.400.000 ₫'}
            <span className="text-[11.5px] font-semibold text-[#8CC7AE]">+12,3%</span>
          </div>
        </div>
        <div className="text-right text-[10.5px] text-[#869699] leading-relaxed">
          CP 45% · Quỹ 30%<br />
          Coin 15% · Vàng 10%
        </div>
      </div>
    </div>
  );
};
