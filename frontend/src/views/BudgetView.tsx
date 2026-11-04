import React, { useState } from 'react';
import { Jar } from '../types';
import { formatVND } from '../mockData';
import { Sparkles, Check, ChevronDown } from 'lucide-react';

interface BudgetViewProps {
  jars: Jar[];
  onUpdateJar: (id: string, limit: number) => void;
}

export const BudgetView: React.FC<BudgetViewProps> = ({ jars }) => {
  const [allocatedSuccess, setAllocatedSuccess] = useState(false);

  const totalLimit = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalSpent = jars.reduce((sum, j) => sum + j.spentThisMonth, 0);
  const remaining = totalLimit - totalSpent;

  const handleSimulateAllocation = () => {
    setAllocatedSuccess(true);
    setTimeout(() => setAllocatedSuccess(false), 3000);
  };

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Title */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[20px] font-bold text-[#F2F5F5]">Ngân sách</span>
          <div className="text-xs text-[#869699] mt-0.5">
            6 hũ chi tiêu · Còn lại <b className="num text-[#F2F5F5]">{formatVND(remaining)}</b>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-[#657D81]/20 text-[#BFD0D3] border border-[#8BA5AA]/25">
          Tháng 11 ▾
        </span>
      </div>

      {/* Income Sources & 1-Click Allocation Card */}
      <div className="bg-gradient-to-br from-[#273336] via-[#182022] to-[#141A1C] border border-[#A7BDC1]/20 rounded-3xl p-5 shadow-[0_16px_36px_rgba(0,0,0,0.35)]">
        <div className="flex items-center justify-between mb-1.5">
          <div>
            <div className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
              Nguồn thu tháng 11 (3 nguồn)
            </div>
            <div className="num text-[23px] font-bold text-[#F2F5F5] mt-0.5">
              45.200.000 <span className="text-base text-[#95B0B4] font-normal">₫</span>
            </div>
          </div>
          <button
            onClick={handleSimulateAllocation}
            className="px-3.5 py-2 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold flex items-center gap-1.5 shadow-md active:scale-95 transition-transform"
          >
            {allocatedSuccess ? <Check size={14} /> : <Sparkles size={14} />}
            {allocatedSuccess ? 'Đã chia hũ!' : 'Chia hũ'}
          </button>
        </div>

        {/* 3 Source breakdown bar */}
        <div className="flex gap-1 h-2 rounded-full overflow-hidden my-3">
          <div className="bg-[#95B0B4] h-full" style={{ width: '55%' }} title="Lương"></div>
          <div className="bg-[#657D81] h-full" style={{ width: '28%' }} title="Freelance"></div>
          <div className="bg-[#445659] h-full" style={{ width: '17%' }} title="Cho thuê"></div>
        </div>

        <div className="flex justify-between text-[11px] text-[#869699]">
          <span>Lương 25tr (55%)</span>
          <span>Freelance 12,7tr (28%)</span>
          <span>Cho thuê 7,5tr (17%)</span>
        </div>
      </div>

      {/* 6 Jars Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {jars.map((jar) => {
          const pct = Math.min(100, Math.round((jar.spentThisMonth / jar.monthlyLimit) * 100));
          const remainingAmount = jar.monthlyLimit - jar.spentThisMonth;
          const isWarn = jar.code === 'PLAY' || pct >= 90;

          return (
            <div
              key={jar.id}
              className={`bg-[#1C2426]/75 border rounded-2xl p-3.5 flex flex-col justify-between ${
                isWarn ? 'border-[#D4A373]/35' : 'border-[#8BA5AA]/12'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-semibold text-[#F2F5F5]">{jar.name}</span>
                <span
                  className={`num text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    isWarn
                      ? 'bg-[#D4A373]/20 text-[#DEB48A]'
                      : 'bg-[#657D81]/20 text-[#BFD0D3]'
                  }`}
                >
                  {isWarn ? `còn ${100 - pct}%` : `${pct}%`}
                </span>
              </div>

              <div className="num text-[16px] font-bold text-[#F2F5F5]">
                {formatVND(remainingAmount > 0 ? remainingAmount : 0)}
              </div>
              <div className="text-[11px] text-[#869699] num mt-0.5">
                {jar.code === 'FFA' ? 'Đã chuyển Đầu tư' : `Hạn mức ${formatVND(jar.monthlyLimit)}`}
              </div>

              <div className="h-1.5 rounded-full bg-[#232D30] overflow-hidden mt-2.5">
                <div
                  className={`h-full rounded-full ${
                    isWarn ? 'bg-[#D4A373]' : jar.code === 'FFA' ? 'bg-[#8CC7AE]' : 'bg-[#657D81]'
                  }`}
                  style={{ width: `${pct}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Upcoming recurring bills */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-2xl p-3.5 flex items-center justify-between text-xs">
        <span className="text-[#869699]">
          Định kỳ sắp tới · <b className="text-[#F2F5F5]">Tiền thuê nhà (05/11)</b>
        </span>
        <span className="num font-semibold text-[#C4D0D2]">−6.000.000 ₫</span>
      </div>
    </div>
  );
};
