import React, { useEffect, useState } from 'react';
import { Holding, AssetClass, FmarketFund, InvestmentCashflowsResponse } from '../types';
import { formatPrivacyVND } from '../utils/financeMath';
import { FmarketFeedStatus } from '../utils/fmarketFunds';
import { CurrencyInput } from '../components/CurrencyInput';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { useManagedOverlay } from '../utils/overlayManager';
import { addInvestmentCashflow, deleteInvestmentCashflow, getInvestmentCashflows, setInvestmentHistoryCompleteFrom } from '../utils/investmentCashflows';
import { Plus, X, RefreshCw, Search, Trash2, Edit2, TrendingUp, Zap } from 'lucide-react';

interface InvestmentsViewProps {
  holdings: Holding[];
  privacyMode?: boolean;
  fmarketFunds: FmarketFund[];
  fmarketFeedStatus: FmarketFeedStatus;
  isSyncingPrices?: boolean;
  onAddHolding: (holding: Holding) => Promise<void> | void;
  onDeleteHolding: (symbol: string) => Promise<void> | void;
  onSyncMarketPrices: () => Promise<boolean>;
}

const ASSET_LABELS: Record<AssetClass, string> = {
  fund: 'Quỹ Fmarket',
  stock: 'Cổ phiếu',
  gold: 'Vàng',
  silver: 'Bạc',
  land: 'Đất / BĐS',
  crypto: 'Crypto'
};

const ASSET_COLORS: Record<AssetClass, string> = {
  fund: '#8CC7AE',
  stock: '#95B0B4',
  gold: '#DEB48A',
  silver: '#C4D0D2',
  land: '#E07A5F',
  crypto: '#A288E3'
};

export const InvestmentsView: React.FC<InvestmentsViewProps> = ({
  holdings,
  privacyMode = false,
  fmarketFunds,
  fmarketFeedStatus,
  isSyncingPrices = false,
  onAddHolding,
  onDeleteHolding,
  onSyncMarketPrices
}) => {
  const formatVND = (amount: number) => formatPrivacyVND(amount, privacyMode);
  const [filter, setFilter] = useState<string>('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const addHoldingDialogProps = useManagedOverlay(showAddModal, () => setShowAddModal(false), 'Thêm hoặc cập nhật tài sản');

  // Form thêm / sửa tài sản
  const [editingHoldingId, setEditingHoldingId] = useState<string | undefined>(undefined);
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [assetClass, setAssetClass] = useState<AssetClass>('fund');
  const [symbol, setSymbol] = useState('');
  const [name, setName] = useState('');
  const [quantityStr, setQuantityStr] = useState('');
  const [avgCost, setAvgCost] = useState<number>(0);
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [unit, setUnit] = useState('CCQ');
  const [autoSync, setAutoSync] = useState<boolean>(true);
  const [fundSearch, setFundSearch] = useState('');
  const [confirmDeleteSymbol, setConfirmDeleteSymbol] = useState<string | null>(null);
  const [cashflowData, setCashflowData] = useState<InvestmentCashflowsResponse | null>(null);
  const [cashflowLoading, setCashflowLoading] = useState(true);
  const [cashflowError, setCashflowError] = useState('');
  const [cashflowNotice, setCashflowNotice] = useState('');
  const [cashflowType, setCashflowType] = useState<'contribution' | 'withdrawal'>('contribution');
  const [cashflowAmount, setCashflowAmount] = useState('');
  const [cashflowDate, setCashflowDate] = useState('');
  const [cashflowNote, setCashflowNote] = useState('');
  const [completeFromInput, setCompleteFromInput] = useState('');
  const [cashflowAction, setCashflowAction] = useState<
    | { type: 'add'; value: { type: 'contribution' | 'withdrawal'; amountVnd: number; occurredAt: string; note?: string } }
    | { type: 'delete'; id: string }
    | { type: 'completeness'; date: string }
    | null
  >(null);
  const [cashflowBusy, setCashflowBusy] = useState(false);

  const refreshCashflows = async (showLoading = true) => {
    if (showLoading) setCashflowLoading(true);
    try {
      const response = await getInvestmentCashflows();
      setCashflowData(response);
      setCashflowError('');
    } catch (error) {
      setCashflowError(error instanceof Error ? error.message : 'Không tải được lịch sử góp/rút.');
    } finally {
      setCashflowLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    getInvestmentCashflows().then((response) => {
      if (active) { setCashflowData(response); setCashflowError(''); }
    }).catch((error) => {
      if (active) setCashflowError(error instanceof Error ? error.message : 'Không tải được lịch sử góp/rút.');
    }).finally(() => { if (active) setCashflowLoading(false); });
    return () => { active = false; };
  }, []);

  const confirmCashflowAction = async () => {
    if (!cashflowAction) return;
    setCashflowBusy(true);
    setCashflowError('');
    setCashflowNotice('');
    try {
      if (cashflowAction.type === 'add') await addInvestmentCashflow(cashflowAction.value);
      else if (cashflowAction.type === 'delete') await deleteInvestmentCashflow(cashflowAction.id);
      else await setInvestmentHistoryCompleteFrom(cashflowAction.date);
      const response = await getInvestmentCashflows();
      setCashflowData(response);
      setCashflowNotice('Đã cập nhật lịch sử XIRR. Thao tác này chỉ ghi lịch sử, không làm thay đổi số dư.');
      if (cashflowAction.type === 'add') { setCashflowAmount(''); setCashflowDate(''); setCashflowNote(''); }
      if (cashflowAction.type === 'completeness') setCompleteFromInput('');
      setCashflowAction(null);
    } catch (error) {
      setCashflowError(error instanceof Error ? error.message : 'Không cập nhật được lịch sử XIRR.');
    } finally {
      setCashflowBusy(false);
    }
  };

  const totalValue = holdings.reduce((sum, h) => sum + Math.round(h.quantity * h.currentPrice), 0);
  const totalCost = holdings.reduce((sum, h) => sum + Math.round(h.quantity * h.avgCost), 0);
  const profit = totalValue - totalCost;
  const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : null;

  const filteredHoldings = filter === 'all'
    ? holdings
    : holdings.filter(h => h.assetClass === filter);

  // Lọc danh sách quỹ Fmarket theo từ khóa
  const matchingFunds = fmarketFunds.filter(f =>
    f.shortName.toLowerCase().includes(fundSearch.toLowerCase()) ||
    f.name.toLowerCase().includes(fundSearch.toLowerCase())
  ).slice(0, 12);

  const getDefaultAutoSync = (cls: AssetClass) => {
    if (cls === 'fund' || cls === 'crypto') return true;
    if (cls === 'land') return false;
    return false; // Vàng SJC / Bạc / Cổ phiếu mặc định giữ giá tay để tránh bị PAXG quốc tế ghi đè trừ khi bật
  };

  const handleOpenAddModal = (defaultClass: AssetClass = 'fund') => {
    setEditingHoldingId(undefined);
    setEditingSymbol(null);
    setAssetClass(defaultClass);
    setSymbol('');
    setName('');
    setQuantityStr('');
    setAvgCost(0);
    setCurrentPrice(0);
    setFundSearch('');
    setAutoSync(getDefaultAutoSync(defaultClass));
    setUnit(
      defaultClass === 'fund' ? 'CCQ' :
      defaultClass === 'stock' ? 'CP' :
      defaultClass === 'gold' ? 'chỉ' :
      defaultClass === 'silver' ? 'lượng' :
      defaultClass === 'land' ? 'Lô/m²' : 'Coin'
    );
    setShowAddModal(true);
  };

  const handleOpenEditHolding = (h: Holding) => {
    setEditingHoldingId(h.id);
    setEditingSymbol(h.symbol);
    setAssetClass(h.assetClass);
    setSymbol(h.symbol);
    setName(h.name);
    setQuantityStr(String(h.quantity));
    // V2-18: Keep exact decimal NAV/price precision (do not Math.round before multiplying by quantity!)
    setAvgCost(Number(h.avgCost));
    setCurrentPrice(Number(h.currentPrice));
    setUnit(h.unit || 'CCQ');
    setAutoSync(h.autoSync !== undefined ? h.autoSync : getDefaultAutoSync(h.assetClass));
    setShowAddModal(true);
  };

  const handleSelectFmarketFund = (fund: FmarketFund) => {
    if (!fund.navAvailable || fund.stale || !fund.nav) return;
    setSymbol(fund.shortName);
    setName(fund.name);
    setUnit('CCQ');
    setAutoSync(true);
    // Seed the field only when blank; keep any price the user has already entered.
    if (currentPrice <= 0) setCurrentPrice(fund.nav);
    if (!avgCost) {
      setAvgCost(fund.nav);
    }
  };

  const handleSaveHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol.trim() || !name.trim()) return;

    const quantity = parseFloat(quantityStr.replace(/,/g, '.')) || 0;
    if (quantity <= 0) return;
    const finalCurrentPrice = currentPrice > 0 ? currentPrice : avgCost;

    await onAddHolding({
      id: editingHoldingId,
      symbol: symbol.trim().toUpperCase(),
      name: name.trim(),
      assetClass,
      quantity,
      avgCost,
      currentPrice: finalCurrentPrice,
      autoSync,
      unit: unit.trim() || (
        assetClass === 'fund' ? 'CCQ' :
        assetClass === 'stock' ? 'CP' :
        assetClass === 'gold' ? 'chỉ' :
        assetClass === 'silver' ? 'lượng' :
        assetClass === 'land' ? 'Lô/m²' : 'Coin'
      )
    });

    setShowAddModal(false);
  };

  const handleTriggerSync = async () => {
    await onSyncMarketPrices();
  };

  // Thống kê tỷ trọng từng nhóm tài sản
  const classSummary = (['fund', 'stock', 'gold', 'silver', 'land', 'crypto'] as AssetClass[]).map(cls => {
    const val = holdings
      .filter(h => h.assetClass === cls)
      .reduce((s, h) => s + h.quantity * h.currentPrice, 0);
    const pct = totalValue > 0 ? Math.round((val / totalValue) * 100) : 0;
    return { cls, label: ASSET_LABELS[cls], val, pct, color: ASSET_COLORS[cls] };
  }).filter(item => item.val > 0);

  return (
    <div className="space-y-3 pb-24 px-4">
      {/* Title & Action Buttons */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[20px] font-bold text-[#F2F5F5]">Tài sản & Đầu tư</span>
          <div className="text-[11px] text-[#869699]">
            Tự động đồng bộ NAV Fmarket, Vàng, Bạc, Crypto theo ngày
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleTriggerSync}
            disabled={isSyncingPrices}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-semibold bg-[#20292B] text-[#8CC7AE] border border-[#8CC7AE]/30 active:scale-95"
            title="Cập nhật giá Fmarket & thị trường ngay"
          >
            <RefreshCw size={12} className={isSyncingPrices ? 'animate-spin' : ''} />
            {isSyncingPrices ? 'Đang lấy giá...' : 'Giá Fmarket'}
          </button>
          <button
            onClick={() => handleOpenAddModal('fund')}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#657D81] text-[#F2F5F5] active:scale-95"
          >
            <Plus size={13} /> Thêm
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1.5 overflow-x-auto py-1 no-scrollbar">
        {[
          { id: 'all', label: 'Tất cả' },
          { id: 'fund', label: 'Quỹ Fmarket' },
          { id: 'gold', label: 'Vàng' },
          { id: 'silver', label: 'Bạc' },
          { id: 'land', label: 'Đất / BĐS' },
          { id: 'stock', label: 'Cổ phiếu' },
          { id: 'crypto', label: 'Crypto' }
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
            Tổng giá trị tài sản đầu tư & tích lũy
          </span>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold bg-[#7EB89E]/15 text-[#8CC7AE] border border-[#7EB89E]/25">
            <TrendingUp size={11} /> Giá theo dữ liệu đã lưu
          </span>
        </div>

        <div className="num text-[27px] font-bold text-[#F2F5F5] tracking-tight my-1">
          {new Intl.NumberFormat('vi-VN').format(Math.round(totalValue))}{' '}
          <span className="text-lg text-[#95B0B4] font-normal">₫</span>
        </div>

        <div className="flex flex-col gap-1 text-xs mt-2.5 pt-2.5 border-t border-[#8BA5AA]/15">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#869699]">
              Lãi/lỗ chưa thực hiện theo giá vốn:
            </span>
            <span className={`num font-semibold ${totalCost <= 0 || profitPct === null ? 'text-[#869699]' : profit >= 0 ? 'text-[#8CC7AE]' : 'text-[#E07A5F]'}`}>
              {totalCost <= 0 || profitPct === null ? (
                'Chưa đủ dữ liệu giá vốn'
              ) : (
                <>
                  {profit >= 0 ? '▲ +' : '▼ −'}{formatVND(Math.abs(profit))} ({profit >= 0 ? '+' : ''}{profitPct.toFixed(2)}%)
                </>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#869699]">
            <span>Tổng giá vốn ban đầu:</span>
            <span className="num text-[#D5E1E3] font-medium">{totalCost > 0 ? formatVND(totalCost) : 'Chưa nhập'}</span>
          </div>
        </div>

        {/* Thanh phân bổ tài sản thực tế (V2-24: Không ép min 3% làm sai lệch tỷ trọng thật!) */}
        {classSummary.length > 0 && (
          <div className="mt-3.5 pt-3 border-t border-[#8BA5AA]/15 space-y-2">
            <div className="flex h-2 rounded-full overflow-hidden gap-0.5 bg-[#141A1C]">
              {classSummary.map(item => (
                <div
                  key={item.cls}
                  style={{ width: `${item.pct}%`, backgroundColor: item.color }}
                  className="h-full"
                />
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
              {classSummary.map(item => (
                <div key={item.cls} className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[#C4D0D2]">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                    {item.label}
                  </span>
                  <span className="num font-semibold text-[#F2F5F5]">
                    {formatVND(item.val)} ({item.pct}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <section className="bg-[#1C2426]/85 border border-[#8BA5AA]/15 rounded-3xl p-4 space-y-3" aria-labelledby="xirr-heading">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="xirr-heading" className="text-sm font-bold text-[#F2F5F5]">Tỷ suất XIRR</h2>
            <p className="text-[10px] text-[#869699] mt-1">Tính theo giá tài sản đang lưu và các lần góp/rút anh ghi.</p>
          </div>
          <button type="button" onClick={() => void refreshCashflows()} disabled={cashflowLoading} className="text-[10px] text-[#8CC7AE] disabled:opacity-50">{cashflowLoading ? 'Đang tải…' : 'Làm mới'}</button>
        </div>
        {cashflowLoading && !cashflowData ? <p className="text-xs text-[#869699]">Đang tải dữ liệu XIRR…</p> : cashflowError && !cashflowData ? <p role="alert" className="text-xs text-[#E0B782]">{cashflowError}</p> : (
          <>
            {cashflowData?.xirr?.annualizedPct !== null && cashflowData?.xirr?.annualizedPct !== undefined ? (
              <div className="text-2xl font-bold text-[#8CC7AE]">{privacyMode ? '••••' : `${cashflowData.xirr.annualizedPct.toFixed(2)}%`}<span className="ml-2 text-[10px] font-normal text-[#869699]">/ năm · XIRR</span></div>
            ) : <div className="text-xs text-[#D5E1E3]">{cashflowData?.xirr?.message || 'Chưa đủ dữ liệu để tính XIRR. Ghi đầy đủ các lần góp/rút và xác nhận mốc lịch sử.'}</div>}
            {cashflowData?.xirr?.terminalValueVnd != null && <p className="text-[10px] text-[#869699]">Giá trị cuối kỳ: {formatVND(cashflowData.xirr.terminalValueVnd)}{cashflowData.xirr.valuationDate ? ` · ${cashflowData.xirr.valuationDate}` : ''}</p>}
            {cashflowData?.xirr?.priceAsOfOldest && Number.isFinite(Date.parse(cashflowData.xirr.priceAsOfOldest)) && <p className="text-[10px] text-[#869699]">Giá tài sản cũ nhất: {new Date(cashflowData.xirr.priceAsOfOldest).toLocaleDateString('vi-VN')}</p>}
            <p className="text-[10px] text-[#869699]">Thời điểm giá theo dữ liệu đang lưu; không phải giá realtime.</p>
            {cashflowData?.historyCompleteFrom && <p className="text-[10px] text-[#869699]">Lịch sử được xác nhận đầy đủ từ {cashflowData.historyCompleteFrom}.</p>}
          </>
        )}
        {cashflowError && cashflowData && <p role="alert" className="text-xs text-[#E0B782]">{cashflowError}</p>}
        {cashflowNotice && <p role="status" className="text-[10px] text-[#8CC7AE]">{cashflowNotice}</p>}
        <p className="text-[10px] leading-relaxed text-[#D4B27C]">Chỉ ghi lịch sử, không làm thay đổi số dư. Chỉ xác nhận mốc đầy đủ nếu anh chắc chắn đã ghi đủ mọi dòng góp/rút trong toàn bộ khoảng thời gian từ ngày đó.</p>

        <form className="grid grid-cols-2 gap-2" onSubmit={(event) => {
          event.preventDefault();
          const amount = Number(cashflowAmount.replace(/,/g, ''));
          if (!cashflowDate || !Number.isSafeInteger(amount) || amount <= 0) { setCashflowError('Nhập ngày và số tiền nguyên VND hợp lệ.'); return; }
          setCashflowAction({ type: 'add', value: { type: cashflowType, amountVnd: amount, occurredAt: cashflowDate, ...(cashflowNote.trim() ? { note: cashflowNote.trim() } : {}) } });
        }}>
          <select aria-label="Loại dòng tiền" value={cashflowType} onChange={(event) => setCashflowType(event.target.value as 'contribution' | 'withdrawal')} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]">
            <option value="contribution">Góp vốn</option><option value="withdrawal">Rút vốn</option>
          </select>
          <input aria-label="Số tiền dòng tiền" inputMode="numeric" placeholder="Số tiền (₫)" value={cashflowAmount} onChange={(event) => setCashflowAmount(event.target.value)} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]" />
          <input aria-label="Ngày dòng tiền" type="date" value={cashflowDate} onChange={(event) => setCashflowDate(event.target.value)} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]" />
          <input aria-label="Ghi chú dòng tiền" placeholder="Ghi chú (không bắt buộc)" value={cashflowNote} onChange={(event) => setCashflowNote(event.target.value)} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]" />
          <button type="submit" className="col-span-2 rounded-xl bg-[#657D81] py-2 text-xs font-semibold text-white">Ghi dòng góp/rút</button>
        </form>

        <div className="flex flex-col gap-2 border-t border-[#8BA5AA]/10 pt-3">
          <label className="text-[10px] text-[#869699]">Ngày bắt đầu có đầy đủ lịch sử</label>
          <div className="flex gap-2">
            <input aria-label="Ngày đầu đủ lịch sử" type="date" value={completeFromInput} onChange={(event) => setCompleteFromInput(event.target.value)} className="min-w-0 flex-1 bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]" />
            <button type="button" disabled={!completeFromInput} onClick={() => setCashflowAction({ type: 'completeness', date: completeFromInput })} className="rounded-xl border border-[#8CC7AE]/30 px-3 text-[10px] font-semibold text-[#8CC7AE] disabled:opacity-40">Xác nhận đủ</button>
          </div>
        </div>

        <div className="divide-y divide-[#8BA5AA]/10">
          {(cashflowData?.cashflows || []).map((flow) => <div key={flow.id} className="flex items-center justify-between gap-2 py-2">
            <div className="min-w-0"><div className="text-[11px] font-semibold text-[#D5E1E3]">{flow.type === 'contribution' ? 'Góp vốn' : 'Rút vốn'} · {formatVND(flow.amountVnd)}</div><div className="truncate text-[10px] text-[#869699]">{flow.occurredAt}{flow.note ? ` · ${flow.note}` : ''}</div></div>
            <button type="button" aria-label={`Xóa dòng ${flow.id}`} onClick={() => setCashflowAction({ type: 'delete', id: flow.id })} className="shrink-0 text-[10px] text-[#E07A5F]">Xóa</button>
          </div>)}
          {!cashflowLoading && cashflowData?.cashflows.length === 0 && <p className="py-2 text-[10px] text-[#869699]">Chưa có dòng góp/rút được ghi.</p>}
        </div>
      </section>

      {/* Holdings List */}
      <div className="bg-[#1C2426]/80 backdrop-blur-md border border-[#8BA5AA]/12 rounded-3xl p-3.5 divide-y divide-[#8BA5AA]/10">
        {filteredHoldings.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <div className="text-xs text-[#869699]">
              Chưa có tài sản nào trong mục này.
            </div>
            <button
              onClick={() => handleOpenAddModal(filter === 'all' ? 'fund' : (filter as AssetClass))}
              className="px-3.5 py-1.5 rounded-xl bg-[#657D81]/30 text-[#8CC7AE] border border-[#8CC7AE]/30 text-xs font-semibold"
            >
              + Thêm {filter === 'all' ? 'Quỹ Fmarket / Vàng / Bạc / Đất' : ASSET_LABELS[filter as AssetClass]}
            </button>
          </div>
        ) : (
          filteredHoldings.map((h) => {
            const val = h.quantity * h.currentPrice;
            const hasCost = h.avgCost > 0;
            const p = hasCost ? ((h.currentPrice - h.avgCost) / h.avgCost) * 100 : 0;
            const isUp = p >= 0;

            return (
              <div
                key={h.symbol}
                onClick={() => handleOpenEditHolding(h)}
                className="py-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-white/[0.02] rounded-xl px-1 transition-colors"
              >
                <div
                  className="w-10 h-10 rounded-xl bg-[#232E31] border border-[#8BA5AA]/20 flex flex-col items-center justify-center font-bold text-[10px] text-[#BFD0D3] shrink-0 px-1 text-center"
                  style={{ borderColor: `${ASSET_COLORS[h.assetClass] || '#8BA5AA'}40` }}
                >
                  <span className="truncate max-w-[36px]">{h.symbol}</span>
                  <span className="text-[8.5px] font-normal text-[#869699]">
                    {ASSET_LABELS[h.assetClass] || h.assetClass}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[#F2F5F5] truncate flex items-center gap-1.5">
                    <span className="truncate">{h.name}</span>
                    {h.autoSync !== false && (h.assetClass === 'fund' || h.assetClass === 'crypto' || h.assetClass === 'gold' || h.assetClass === 'silver') && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-[#8CC7AE]/15 text-[#8CC7AE] border border-[#8CC7AE]/25 shrink-0 font-mono">
                        Auto
                      </span>
                    )}
                    <Edit2 size={10} className="text-[#869699] shrink-0 opacity-60" />
                  </div>
                  <div className="text-[11px] text-[#869699] num mt-0.5">
                    {h.quantity} {h.unit} · Giá hiện tại:{' '}
                    <b className="text-[#D5E1E3]">{new Intl.NumberFormat('vi-VN').format(Math.round(h.currentPrice))} ₫</b>
                  </div>
                </div>

                <div className="text-right num shrink-0">
                  <div className="text-[13.5px] font-bold text-[#F2F5F5]">
                    {formatVND(val)}
                  </div>
                  <div className={`text-[11px] font-medium ${!hasCost ? 'text-[#869699]' : isUp ? 'text-[#8CC7AE]' : 'text-[#D98A8A]'}`}>
                    {!hasCost ? 'Chưa có giá vốn' : `${isUp ? '+' : ''}${p.toFixed(1)}%`}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* MODAL: Thêm / Cập nhật tài sản đầu tư (Hỗ trợ chọn nhanh Quỹ Fmarket & công tắc AutoSync L-10) */}
      {showAddModal && (
        <div {...addHoldingDialogProps} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-3.5 no-scrollbar">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-[#F2F5F5]">
                {editingSymbol ? `Cập nhật tài sản: ${editingSymbol}` : 'Thêm / Cập nhật Tài sản'}
              </span>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveHolding} className="space-y-3">
              {/* Chọn nhóm tài sản */}
              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1.5">
                  Nhóm tài sản
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([
                    { id: 'fund', label: '📈 Quỹ Fmarket' },
                    { id: 'gold', label: '🥇 Vàng' },
                    { id: 'silver', label: '🥈 Bạc' },
                    { id: 'land', label: '🏡 Đất / BĐS' },
                    { id: 'stock', label: '📊 Cổ phiếu' },
                    { id: 'crypto', label: '🪙 Crypto' }
                  ] as Array<{ id: AssetClass; label: string }>).map(tab => (
                    <button
                      type="button"
                      key={tab.id}
                      onClick={() => {
                        setAssetClass(tab.id);
                        setAutoSync(getDefaultAutoSync(tab.id));
                        setUnit(
                          tab.id === 'fund' ? 'CCQ' :
                          tab.id === 'stock' ? 'CP' :
                          tab.id === 'gold' ? 'chỉ' :
                          tab.id === 'silver' ? 'lượng' :
                          tab.id === 'land' ? 'm²' : 'Coin'
                        );
                        if (tab.id === 'gold' && !symbol) {
                          setSymbol('SJC');
                          setName('Vàng nhẫn 9999 / SJC');
                        } else if (tab.id === 'silver' && !symbol) {
                          setSymbol('SILVER');
                          setName('Bạc tích trữ 999');
                        } else if (tab.id === 'land' && !symbol) {
                          setSymbol('LAND1');
                          setName('Đất nền / Bất động sản');
                        }
                      }}
                      className={`py-2 px-2 rounded-xl text-[11px] font-semibold border transition-all ${
                        assetClass === tab.id
                          ? 'bg-[#657D81] text-[#F2F5F5] border-[#8CC7AE]/40'
                          : 'bg-[#20292B] text-[#869699] border-[#8BA5AA]/15'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nếu là Quỹ Fmarket -> Hiển thị bộ chọn trực tiếp từ Fmarket API */}
              {assetClass === 'fund' && (
                <div className="bg-[#20292B] border border-[#8CC7AE]/25 rounded-2xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#8CC7AE]">
                      Chọn nhanh Quỹ Fmarket ({fmarketFunds.length} quỹ)
                    </span>
                    <span className="text-[10px] text-[#869699]">
                      {fmarketFeedStatus === 'available' ? 'NAV đã xác minh' : fmarketFeedStatus === 'stale' ? 'Dữ liệu cũ hoặc thiếu NAV' : 'Nguồn NAV không khả dụng'}
                    </span>
                  </div>
                  {fmarketFeedStatus === 'unavailable' && <p className="text-[10px] text-[#E0B782]">Không tải được danh sách/NAV Fmarket. Anh vẫn có thể nhập mã và giá thủ công.</p>}
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-2.5 text-[#869699]" />
                    <input
                      type="text"
                      placeholder="Tìm mã quỹ Fmarket (VD: VESAF, DCDS, VCBF, SSISCA...)"
                      value={fundSearch}
                      onChange={(e) => setFundSearch(e.target.value)}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl pl-8 pr-3 py-1.5 text-xs text-[#F2F5F5] focus:outline-none"
                    />
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto py-1 no-scrollbar">
                    {matchingFunds.map(f => (
                      <button
                        type="button"
                        key={f.shortName}
                        onClick={() => handleSelectFmarketFund(f)}
                        disabled={!f.navAvailable || f.stale}
                        className={`px-2.5 py-1.5 rounded-xl text-left shrink-0 border transition-all ${
                          !f.navAvailable || f.stale
                            ? 'bg-[#161C1E] border-[#8BA5AA]/10 text-[#869699] opacity-60 cursor-not-allowed'
                            : symbol.toUpperCase() === f.shortName
                            ? 'bg-[#8CC7AE]/20 border-[#8CC7AE] text-[#F2F5F5]'
                            : 'bg-[#161C1E] border-[#8BA5AA]/15 text-[#C4D0D2]'
                        }`}
                      >
                        <div className="text-[11px] font-bold text-[#8CC7AE]">{f.shortName}</div>
                        <div className="text-[10px] num text-[#D5E1E3]">
                          {f.navAvailable && f.nav ? `NAV: ${new Intl.NumberFormat('vi-VN').format(f.nav)} ₫` : 'NAV chưa xác minh'}
                        </div>
                        {f.navDate && <div className="text-[9px] text-[#869699]">{new Date(f.navDate).toLocaleDateString('vi-VN')}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                    Mã tài sản *
                  </label>
                  <input
                    type="text"
                    placeholder="VD: VESAF, SJC, LAND1..."
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] uppercase"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                    Đơn vị tính
                  </label>
                  <input
                    type="text"
                    placeholder="CCQ, chỉ, lượng, m², lô..."
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                  Tên tài sản chi tiết *
                </label>
                <input
                  type="text"
                  placeholder="VD: Quỹ đầu tư cổ phiếu tiếp cận thị trường VinaCapital..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5]"
                />
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                  Số lượng ({unit}) *
                </label>
                <input
                  type="number"
                  step="any"
                  placeholder="VD: 500.25"
                  value={quantityStr}
                  onChange={(e) => setQuantityStr(e.target.value)}
                  className="w-full bg-[#20292B] border border-[#8BA5AA]/20 rounded-xl px-3 py-2.5 text-sm font-bold num text-[#F2F5F5]"
                />
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                  Giá vốn TB / 1 {unit} (₫)
                </label>
                <CurrencyInput
                  value={avgCost}
                  onChange={setAvgCost}
                  showQuickChips={false}
                  className="text-sm font-bold"
                />
              </div>

              <div>
                <label className="text-[10.5px] font-semibold text-[#869699] uppercase block mb-1">
                  Giá thị trường hiện tại / 1 {unit} (₫)
                </label>
                <CurrencyInput
                  value={currentPrice}
                  onChange={setCurrentPrice}
                  showQuickChips={assetClass === 'land' || assetClass === 'gold'}
                  className="text-sm font-bold text-[#8CC7AE]"
                />
              </div>

              {/* L-10: Công tắc gạt bảo vệ giá tự nhập (SJC / BĐS) khỏi bị giá quốc tế ghi đè */}
              {assetClass !== 'land' && (
                <button
                  type="button"
                  onClick={() => setAutoSync(!autoSync)}
                  className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-left transition-all ${
                    autoSync
                      ? 'bg-[#1D2926] border-[#8CC7AE]/45 text-[#8CC7AE]'
                      : 'bg-[#20292B] border-[#8BA5AA]/15 text-[#97A8AB]'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Zap size={13} className={autoSync ? 'text-[#8CC7AE]' : 'text-[#869699]'} />
                      Tự động cập nhật giá hàng ngày
                    </div>
                    <div className="text-[10px] text-[#869699] mt-0.5">
                      {assetClass === 'fund'
                        ? 'Đồng bộ trực tiếp NAV khớp lệnh từ Fmarket'
                        : assetClass === 'gold' || assetClass === 'silver'
                        ? 'Tắt nếu anh muốn giữ nguyên giá Vàng SJC / tiệm vàng trong nước'
                        : 'Cập nhật giá thị trường quốc tế tự động'}
                    </div>
                  </div>
                  <span className="text-[10.5px] font-bold shrink-0 ml-2">
                    {autoSync ? 'Bật' : 'Giữ giá tay'}
                  </span>
                </button>
              )}

              <div className="pt-1 flex flex-col gap-2">
                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#8CC7AE] text-[#0E1314] text-xs font-bold shadow active:scale-98"
                >
                  {editingSymbol ? 'Lưu cập nhật tài sản' : '+ Lưu vào danh mục tài sản'}
                </button>

                {editingSymbol && (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSymbol(editingSymbol)}
                    className="w-full py-2 rounded-xl bg-transparent border border-[#E06D6D]/35 text-[#E06D6D] text-xs font-semibold flex items-center justify-center gap-1.5"
                  >
                    <Trash2 size={13} /> Xóa tài sản này
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* U-04: Confirm Bottom Sheet trước khi xóa tài sản */}
      <ConfirmSheet
        isOpen={Boolean(confirmDeleteSymbol)}
        title="Xóa tài sản đầu tư"
        description={`Anh có chắc muốn xóa mã "${confirmDeleteSymbol}" khỏi danh mục tài sản không?`}
        confirmText="Xóa tài sản"
        isDanger
        onConfirm={async () => {
          if (confirmDeleteSymbol) {
            await onDeleteHolding(confirmDeleteSymbol);
            setConfirmDeleteSymbol(null);
            setShowAddModal(false);
          }
        }}
        onCancel={() => setConfirmDeleteSymbol(null)}
      />
      <ConfirmSheet
        isOpen={Boolean(cashflowAction)}
        title={cashflowAction?.type === 'delete' ? 'Xóa dòng lịch sử đầu tư?' : cashflowAction?.type === 'completeness' ? 'Xác nhận lịch sử đã đầy đủ?' : 'Xác nhận ghi dòng góp/rút?'}
        description={cashflowAction?.type === 'completeness' ? `Anh xác nhận đã bao gồm mọi dòng góp/rút kể từ ${cashflowAction.date}. Việc này chỉ đánh dấu độ đầy đủ lịch sử, không làm thay đổi số dư.` : cashflowAction?.type === 'delete' ? 'Dòng lịch sử sẽ bị xóa và XIRR được tính lại. Số dư không thay đổi.' : 'Dòng này chỉ được lưu vào lịch sử dùng để tính XIRR; không làm thay đổi số dư hoặc sổ giao dịch.'}
        confirmText={cashflowBusy ? 'Đang lưu…' : 'Xác nhận'}
        onConfirm={() => { if (!cashflowBusy) void confirmCashflowAction(); }}
        onCancel={() => { if (!cashflowBusy) setCashflowAction(null); }}
      />
    </div>
  );
};
