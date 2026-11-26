import { useRef, useState, type FormEvent } from 'react';
import type { FundPurchaseRequest, Holding } from '../types';
import { ApiRequestError, generateOperationId } from '../services/apiClient';
import { useManagedOverlay } from '../utils/overlayManager';
import { FundDecimalInput, fundPurchasePriceDraft } from './FundDecimalInput';

const displayNumber = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 });

function readPendingPurchase(key: string): FundPurchaseRequest | null {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (saved && Number.isFinite(saved.quantity) && saved.quantity > 0 && Number.isFinite(saved.unitPrice) && saved.unitPrice > 0 &&
        Number.isSafeInteger(saved.expectedRevision) && saved.expectedRevision >= 1 &&
        typeof saved.operationId === 'string' && /^[a-z0-9_-]{1,128}$/i.test(saved.operationId)) return saved;
  } catch { /* A missing or invalid local draft is not submitted. */ }
  return null;
}

export function FundBuyMoreDialog({ holding, privacyMode, onBuy, onClose }: {
  holding: Holding;
  privacyMode: boolean;
  onBuy: (request: FundPurchaseRequest) => Promise<void>;
  onClose: () => void;
}) {
  const storageKey = `qltc_pending_fund_purchase_${holding.id}`;
  const [initialPending] = useState(() => readPendingPurchase(storageKey));
  const [quantityDraft, setQuantityDraft] = useState(initialPending ? fundPurchasePriceDraft(initialPending.quantity) : '');
  const [priceDraft, setPriceDraft] = useState(initialPending ? fundPurchasePriceDraft(initialPending.unitPrice) : '');
  const [saving, setSaving] = useState(false);
  const [retryPending, setRetryPending] = useState(Boolean(initialPending));
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const pending = useRef<FundPurchaseRequest | null>(initialPending);
  const close = () => { if (!inFlight.current) onClose(); };
  const dialog = useManagedOverlay(true, close, `Mua thêm ${holding.symbol}`);

  const quantity = Number(quantityDraft.replace(',', '.'));
  const unitPrice = Number(priceDraft.replace(',', '.'));
  const hasCost = Number.isFinite(holding.quantity) && holding.quantity >= 0 &&
    (holding.quantity === 0 || (Number.isFinite(holding.avgCost) && holding.avgCost > 0));
  const nextQuantity = holding.quantity + quantity;
  const totalCost = holding.quantity * holding.avgCost + quantity * unitPrice;
  const nextAverage = totalCost / nextQuantity;
  const validPurchase = hasCost && quantity > 0 && unitPrice > 0 && Number.isFinite(nextQuantity) &&
    nextQuantity > holding.quantity && Number.isFinite(nextAverage) && nextAverage > 0 && totalCost > 0 && Number.isSafeInteger(Math.round(totalCost));
  const priceText = (price: number) => privacyMode ? '•••••• ₫' : `${displayNumber.format(price)} ₫`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || (!validPurchase && !pending.current)) return;
    const request = pending.current ?? {
      quantity, unitPrice, expectedRevision: holding.revision ?? 1, operationId: generateOperationId('fund_buy')
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {
      setError('Chưa lưu được yêu cầu trên thiết bị. Anh thử lại trước khi ghi lần mua.');
      return;
    }
    pending.current = request;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await onBuy(request);
      try { localStorage.removeItem(storageKey); } catch { /* The same saved request remains safe to retry. */ }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        pending.current = null;
        try { localStorage.removeItem(storageKey); } catch { /* Keep the server response visible. */ }
        setRetryPending(false);
        setError(err.message);
      } else {
        setRetryPending(true);
        setError('Chưa xác nhận được lần mua đã lưu. Anh bấm Thử lưu lại.');
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <div {...dialog} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl border-t border-[#8BA5AA]/20 bg-[#161C1E] p-5 shadow-2xl">
        <h2 className="text-lg font-bold text-[#F2F5F5]">Mua thêm {holding.symbol}</h2>
        <p className="mt-1 text-sm text-[#BFD0D3]">Đang giữ {displayNumber.format(holding.quantity)} CCQ</p>
        <form onSubmit={submit} className="mt-4 space-y-3">
          <div>
            <label htmlFor="fund-buy-quantity" className="mb-1 block text-sm font-medium text-[#D5E1E3]">Số CCQ mua thêm</label>
            <FundDecimalInput id="fund-buy-quantity" value={quantityDraft} onChange={setQuantityDraft} disabled={saving || retryPending} placeholder="Ví dụ 25,5" />
          </div>
          <div>
            <label htmlFor="fund-buy-price" className="mb-1 block text-sm font-medium text-[#D5E1E3]">Giá mua lần này / CCQ (₫)</label>
            <FundDecimalInput id="fund-buy-price" value={priceDraft} onChange={setPriceDraft} disabled={saving || retryPending} placeholder="Ví dụ 32.500,25" />
          </div>
          {retryPending && <p className="text-sm text-[#BFD0D3]">Lần mua đã bấm lưu đang chờ xác nhận. Anh bấm Thử lưu lại để kiểm tra kết quả.</p>}
          {!retryPending && validPurchase && <div className="rounded-xl border border-[#8CC7AE]/25 bg-[#8CC7AE]/10 p-3 text-sm text-[#D5E1E3]">
            <p className="font-semibold text-[#8CC7AE]">Sau khi lưu</p>
            <p className="mt-1">Tổng số lượng {displayNumber.format(nextQuantity)} CCQ</p>
            <p>Giá vốn bình quân {priceText(nextAverage)} / CCQ</p>
          </div>}
          <p className="text-xs leading-relaxed text-[#BFD0D3]">Tiền thanh toán được ghi giảm ở tài khoản chi khi anh duyệt thông báo ngân hàng.</p>
          {!hasCost && <p className="text-sm text-[#DEB48A]">Anh bổ sung giá vốn của số CCQ đang giữ trước khi ghi lần mua thêm.</p>}
          {error && <p role="alert" className="text-sm text-[#E99191]">{error}</p>}
          <div className="grid grid-cols-[1fr_2fr] gap-2 pt-1">
            <button type="button" onClick={close} disabled={saving} className="min-h-11 rounded-xl border border-[#8BA5AA]/25 text-sm font-semibold text-[#D5E1E3] disabled:opacity-50">Hủy</button>
            <button type="submit" disabled={saving || (!validPurchase && !retryPending)} className="min-h-11 rounded-xl bg-[#8CC7AE] text-sm font-bold text-[#0E1314] disabled:opacity-50">
              {saving ? 'Đang lưu…' : retryPending ? 'Thử lưu lại' : 'Lưu lần mua'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
