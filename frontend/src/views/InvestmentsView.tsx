import React, { useState } from 'react';
import { DonutChart } from '../components/DonutChart';
import { Holding } from '../types';
import { formatVND } from '../mockData';
import { Plus, X } from 'lucide-react';

interface InvestmentsViewProps {
  holdings: Holding[];
  onAddHolding: (holding: Holding) => void;
}

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({ holdings, onAddHolding }) => {
  const [filter, setFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  // Form thêm tài sản
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState<'stock' | 'fund' | 'crypto' | 'gold'>('stock');
  const [quantityStr, setQuantityStr] = useState('');
  const [avgCostStr, setAvgCostStr] = useState('');
  const [currentPriceStr, setCurrentPriceStr] = useState('');
  const [unit, setUnit] = useState('CP');

  const totalValue = holdings.reduce((sum, h) => sum + h.quantity * h.currentPrice, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.quantity * h.avgCost, 0);
  const profit = totalValue - totalCost;
  const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  const filteredHoldings = filter === 'all'
    ? holdings
    : holdings.filter(h => h.assetClass === filter);

  const handleCreateHolding = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || !name.trim()) return;

    const quantity = parseFloat(quantityStr) || 0;
    const avgCost = parseFloat(avgCostStr.replace(/[^\d.]/g, '')) || 0;
    const currentPrice = parseFloat(currentPriceStr.replace(/[^\d.]/g, '')) || avgCost;

    onAddHolding({
      symbol: symbol.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      quantity,
      avgCost,
      currentPrice,
      unit: unit.trim() || (assetClass === 'stock' ? 'CP' : assetClass === 'gold' ? 'chỉ' : assetClass === 'fund' ? 'CCQ' : 'Coin')
    });

    setSymbol('');
    setName('');
    setQuantityStr('');
    setAvgCostStr('');
    setCurrentPriceStr('');
    setShowAddModal(false);
  };

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Title */}
      <div className="flex items-center justify-between">
        <span className="text-[20px] font-bold text-[#F2F5F5]">Đầu tư</span>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#657D81]/25 text-[#D5E1E3] border border-[#8BA5AA]/25 active:scale-95"
        >
          <Plus size={13} /> Thêm tài sản
        </button>
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
          const p = h.avgCost > 0 ? (h.currentPrice - h.avgCost) / h.avgCost * 100 : 0;
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

      {/* MODAL: Thêm tài sản đầu tư */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">Thêm tài sản đầu tư</span>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateHolding} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Loại tài sản</label>
                  <select
                    value={assetClass}
                    onChange={(e) => {
                      const cls = e.target.value as any;
                      setAssetClass(cls);
                      setUnit(cls === 'stock' ? 'CP' : cls === 'gold' ? 'chỉ' : cls === 'fund' ? 'CCQ' : 'Coin');
                    }}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2.5 py-2 text-xs text-[#F2F5F5]"
                  >
                    <option value="stock">Cổ phiếu VN</option>
                    <option value="fund">Chứng chỉ quỹ</option>
                    <option value="crypto">Crypto</option>
                    <option value="gold">Vàng 9999 / SJC</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Mã (Symbol)</label>
                  <input
                    type="text"
                    placeholder="VD: HPG, BTC..."
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] uppercase"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Tên tài sản</label>
                <input
                  type="text"
                  placeholder="VD: Tập đoàn Hòa Phát, Bitcoin..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Số lượng ({unit})</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="VD: 1000"
                    value={quantityStr}
                    onChange={(e) => setQuantityStr(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Giá vốn mua (₫)</label>
                  <input
                    type="text"
                    placeholder="VD: 25000"
                    value={avgCostStr}
                    onChange={(e) => setAvgCostStr(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">Giá thị trường hiện tại (₫)</label>
                <input
                  type="text"
                  placeholder="Để trống nếu bằng giá vốn"
                  value={currentPriceStr}
                  onChange={(e) => setCurrentPriceStr(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-bold shadow active:scale-98 mt-2"
              >
                + Lưu vào danh mục
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
