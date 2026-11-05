import React from 'react';
import { Sparkline } from '../components/Sparkline';
import { Jar, Holding, IncomeSource, Transaction } from '../types';
import { formatVND } from '../mockData';

interface DashboardViewProps {
  netWorth: number;
  liquidCash: number;
  totalInvestments: number;
  jars: Jar[];
  holdings: Holding[];
  incomeSources: IncomeSource[];
  confirmedTransactions: Transaction[];
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
  holdings,
  incomeSources,
  confirmedTransactions,
  pendingCount,
  privacyMode,
  onOpenInbox,
  onOpenBudget,
  onOpenInvestments
}) => {
  // 1. Tính tổng thu nhập tháng này (từ nguồn thu dự kiến hoặc từ giao dịch thu nhập thực tế)
  const totalExpectedIncome = incomeSources.reduce((sum, s) => sum + s.expectedAmount, 0);
  const confirmedIncome = confirmedTransactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const displayIncome = totalExpectedIncome > 0 ? totalExpectedIncome : confirmedIncome;

  // 2. Tính tổng chi tiêu thực tế tháng này từ các hũ
  const totalSpent = jars.reduce((sum, j) => sum + j.spentThisMonth, 0);

  // 3. Tỷ lệ tiết kiệm và thanh tỷ lệ chi tiêu
  const savingsRate = displayIncome > 0
    ? Math.max(0, Math.round(((displayIncome - totalSpent) / displayIncome) * 100))
    : 0;
  const spentPct = displayIncome > 0
    ? Math.min(100, Math.round((totalSpent / displayIncome) * 100))
    : 0;

  // 4. Ngân sách còn lại của 6 hũ
  const totalJarLimits = jars.reduce((sum, j) => sum + j.monthlyLimit, 0);
  const totalJarRemaining = Math.max(0, totalJarLimits - totalSpent);

  // 5. Phân bổ tài sản đầu tư động theo holdings
  const totalCost = holdings.reduce((sum, h) => sum + (h.quantity * h.avgCost), 0);
  const profitRate = totalCost > 0 ? ((totalInvestments - totalCost) / totalCost) * 100 : 0;

  const stockVal = holdings.filter(h => h.assetClass === 'stock').reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const fundVal = holdings.filter(h => h.assetClass === 'fund').reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const cryptoVal = holdings.filter(h => h.assetClass === 'crypto').reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);
  const goldVal = holdings.filter(h => h.assetClass === 'gold').reduce((sum, h) => sum + (h.quantity * h.currentPrice), 0);

  const stockPct = totalInvestments > 0 ? Math.round((stockVal / totalInvestments) * 100) : 0;
  const fundPct = totalInvestments > 0 ? Math.round((fundVal / totalInvestments) * 100) : 0;
  const cryptoPct = totalInvestments > 0 ? Math.round((cryptoVal / totalInvestments) * 100) : 0;
  const goldPct = totalInvestments > 0 ? Math.round((goldVal / totalInvestments) * 100) : 0;

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
            Thực tế
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
            {displayIncome > 0 ? (
              <>
                Tiết kiệm <b className="text-[#D5E1E3] font-semibold">{savingsRate}%</b>
              </>
            ) : (
              <span className="text-[#869699]">Chưa có thu nhập</span>
            )}
          </span>
        </div>

        <div className="flex items-center justify-between num mb-2.5">
          <div>
            <div className="text-[11px] text-[#869699]">
              Thu nhập {incomeSources.length > 0 ? `(${incomeSources.length} nguồn)` : ''}
            </div>
            <div className="text-[16.5px] font-bold text-[#F2F5F5] mt-0.5">
              {privacyMode ? '•••••• ₫' : `+${formatVND(displayIncome)}`}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-[#869699]">Đã chi</div>
            <div className="text-[16.5px] font-semibold text-[#B0C0C3] mt-0.5">
              {privacyMode ? '•••••• ₫' : `−${formatVND(totalSpent)}`}
            </div>
          </div>
        </div>

        <div className="h-1.5 flex gap-1 rounded-full bg-transparent overflow-hidden">
          <div
            className="bg-[#95B0B4] h-full rounded-full transition-all duration-300"
            style={{ width: `${displayIncome > 0 ? spentPct : 0}%` }}
          ></div>
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
            {totalJarLimits > 0 ? `6 hũ · còn ${formatVND(totalJarRemaining)} ›` : '6 hũ · Xem chi tiết ›'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {jars.slice(0, 4).map((jar) => {
            const pct = jar.monthlyLimit > 0
              ? Math.min(100, Math.round((jar.spentThisMonth / jar.monthlyLimit) * 100))
              : 0;
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
                  Còn {privacyMode ? '••••••' : formatVND(Math.max(0, jar.monthlyLimit - jar.spentThisMonth))}
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
            {privacyMode ? '•••••••••• ₫' : formatVND(totalInvestments)}
            {totalInvestments > 0 && profitRate !== 0 && (
              <span className={`text-[11.5px] font-semibold ${profitRate >= 0 ? 'text-[#8CC7AE]' : 'text-[#E07A5F]'}`}>
                {profitRate >= 0 ? `+${profitRate.toFixed(1)}%` : `${profitRate.toFixed(1)}%`}
              </span>
            )}
          </div>
        </div>
        <div className="text-right text-[10.5px] text-[#869699] leading-relaxed">
          {totalInvestments > 0 ? (
            <>
              {stockPct > 0 && `CP ${stockPct}% `}
              {fundPct > 0 && `· Quỹ ${fundPct}%`}
              <br />
              {cryptoPct > 0 && `Coin ${cryptoPct}% `}
              {goldPct > 0 && `· Vàng ${goldPct}%`}
            </>
          ) : (
            <span className="text-[#869699]">Chưa có tài sản ›</span>
          )}
        </div>
      </div>
    </div>
  );
};
