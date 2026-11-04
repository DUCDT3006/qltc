import React, { useState } from 'react';
import { DonutChart } from '../components/DonutChart';
import { Holding } from '../types';
import { formatVND } from '../mockData';

interface InvestmentsViewProps {
  holdings: Holding[];
}

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({ holdings }) => {
  const [filter, setFilter] = useState<string>('all');

  const totalValue = holdings.reduce((sum, h) => sum + h.quantity * h.currentPrice, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.quantity * h.avgCost, 0);
  const profit = totalValue - totalCost;
  const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  const filteredHoldings = filter === 'all'
    ? holdings
    : holdings.filter(h => h.assetClass === filter);

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Title */}
      <div className="flex items-center justify-between">
        <span className="text-[20px] font-bold text-[#F2F5F5]">Đầu tư</span>
        <span className="text-xs text-[#869699]">Đồng bộ giá 15:00</span>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto py-1 no-scrollbar">
        {[
          { id: 'all', label: 'Tất cả' },
          { id: 'stock', label: 'Cổ phiếu' },
          { id: 'fund', label: 'CCQ' },
          { id: 'crypto', label: 'Crypto' },
          { id: 'gold', label: 'Vàng' }
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
              filter === t.id
                ? 'bg-[#657D81] text-[#F2F5F5] border-[#BFD0D3]/35 font-semibold'
                : 'bg-[#1C2426]/70 text-[#869699] border-[#8BA5AA]/12'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Portfolio Total Hero Card */}
      <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-5 shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
            Giá trị danh mục
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#7EB89E]/15 text-[#8CC7AE] border border-[#7EB89E]/25">
            XIRR 14,8%/năm
          </span>
        </div>

        <div className="num text-[28px] font-bold text-[#F2F5F5] tracking-tight my-1">
          {new Intl.NumberFormat('vi-VN').format(Math.round(totalValue))}{' '}
          <span className="text-lg text-[#95B0B4] font-normal">₫</span>
        </div>

        <div className="flex items-center justify-between text-xs mt-2">
          <span className="num font-semibold text-[#8CC7AE]">
            ▲ +{formatVND(profit)} (+{profitPct.toFixed(1)}%)
          </span>
          <span className="text-[#869699] num">
            Hôm nay <span className="text-[#8CC7AE]">+1,2tr</span>
          </span>
        </div>
      </div>

      {/* Monochromatic Donut Allocation Card */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-4.5 flex items-center gap-4">
        <DonutChart />
        <div className="flex-1 text-xs space-y-1.5">
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-[#C4D0D2]">
              <span className="w-2 h-2 rounded-sm bg-[#B8CDD0]"></span>
              Cổ phiếu VN
            </span>
            <b className="num text-[#F2F5F5]">45%</b>
          </div>
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-[#C4D0D2]">
              <span className="w-2 h-2 rounded-sm bg-[#859FA4]"></span>
              Chứng chỉ quỹ
            </span>
            <b className="num text-[#F2F5F5]">30%</b>
          </div>
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-[#C4D0D2]">
              <span className="w-2 h-2 rounded-sm bg-[#657D81]"></span>
              Crypto
            </span>
            <b className="num text-[#F2F5F5]">15%</b>
          </div>
          <div className="flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-[#C4D0D2]">
              <span className="w-2 h-2 rounded-sm bg-[#3F5154]"></span>
              Vàng SJC
            </span>
            <b className="num text-[#F2F5F5]">10%</b>
          </div>
        </div>
      </div>

      {/* Holdings List */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-3.5 divide-y divide-[#8BA5AA]/10">
        {filteredHoldings.map((h) => {
          const val = h.quantity * h.currentPrice;
          const p = (h.currentPrice - h.avgCost) / h.avgCost * 100;
          const isUp = p >= 0;

          return (
            <div key={h.symbol} className="py-2.5 flex items-center justify-between gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#232E31] border border-[#8BA5AA]/18 flex items-center justify-center font-bold text-xs text-[#BFD0D3] shrink-0">
                {h.symbol}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[#F2F5F5] truncate">
                  {h.name}
                </div>
                <div className="text-[11px] text-[#869699] num">
                  {h.quantity} {h.unit} · Vốn {new Intl.NumberFormat('vi-VN').format(Math.round(h.avgCost))}
                </div>
              </div>

              <div className="text-right num shrink-0">
                <div className="text-[13px] font-semibold text-[#F2F5F5]">
                  {formatVND(val)}
                </div>
                <div className={`text-[11px] font-medium ${isUp ? 'text-[#8CC7AE]' : 'text-[#D98A8A]'}`}>
                  {isUp ? '+' : ''}{p.toFixed(1)}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
