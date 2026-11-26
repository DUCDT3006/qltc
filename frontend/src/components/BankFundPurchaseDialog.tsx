import { useRef, useState, type FormEvent } from 'react';
import type { BankFundPurchaseRequest, Transaction } from '../types';
import type { NotificationFund } from '../utils/notificationFund';
import { ApiRequestError, generateOperationId } from '../services/apiClient';
import { formatPrivacyVND } from '../utils/financeMath';
import { FundDecimalInput, fundPurchasePriceDraft } from './FundDecimalInput';
import { useManagedOverlay } from '../utils/overlayManager';

const numbers = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 8 });

function readPending(key: string, symbol: string): BankFundPurchaseRequest | null {
  try {
    const pending = JSON.parse(localStorage.getItem(key) || 'null');
    const revisionOK = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 1;
    if (!pending || pending.symbol !== symbol || pending.type !== 'expense' || typeof pending.accountId !== 'string' || !pending.accountId ||
        !revisionOK(pending.expectedTransactionRevision) || !(pending.expectedHoldingRevision === null || revisionOK(pending.expectedHoldingRevision)) ||
        typeof pending.operationId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(pending.operationId) ||
        typeof pending.alreadyRecorded !== 'boolean' || typeof pending.confirmAmountDifference !== 'boolean') return null;
    if (pending.alreadyRecorded || (typeof pending.quantity === 'number' && pending.quantity > 0 && Number.isFinite(pending.quantity) &&
        typeof pending.unitPrice === 'number' && pending.unitPrice > 0 && Number.isFinite(pending.unitPrice))) return pending;
  } catch { /* Only a valid request that the user has submitted can be retried. */ }
  return null;
}

export function BankFundPurchaseDialog({ transaction, fund, note, privacyMode, onSave, onClose }: {
  transaction: Transaction;
  fund: NotificationFund;
  note?: string;
  privacyMode: boolean;
  onSave: (request: BankFundPurchaseRequest) => Promise<void>;
  onClose: () => void;
}) {
  const key = `qltc_pending_bank_fund_${transaction.id}`;
  const [initial] = useState(() => readPending(key, fund.symbol));
  const [quantityText, setQuantityText] = useState(initial?.quantity ? fundPurchasePriceDraft(initial.quantity) : '');
  const [priceText, setPriceText] = useState(initial?.unitPrice ? fundPurchasePriceDraft(initial.unitPrice) : '');
  const [alreadyRecorded, setAlreadyRecorded] = useState(initial?.alreadyRecorded ?? false);
  const [confirmDifference, setConfirmDifference] = useState(initial?.confirmAmountDifference ?? false);
  const [retrying, setRetrying] = useState(Boolean(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const pending = useRef<BankFundPurchaseRequest | null>(initial);
  const close = () => { if (!inFlight.current) onClose(); };
  const dialog = useManagedOverlay(true, close, `Ghi mua quỹ ${fund.symbol}`);
  const quantity = Number(quantityText.replace(',', '.'));
  const unitPrice = Number(priceText.replace(',', '.'));
  const oldQuantity = fund.holding?.quantity ?? 0;
  const oldAverage = oldQuantity > 0 ? fund.holding?.avgCost ?? 0 : 0;
  const nextQuantity = oldQuantity + quantity;
  const totalCost = oldQuantity * oldAverage + quantity * unitPrice;
  const newAverage = totalCost / nextQuantity;
  const hasCost = Number.isFinite(oldQuantity) && oldQuantity >= 0 && (oldQuantity === 0 || (Number.isFinite(oldAverage) && oldAverage > 0));
  const valid = hasCost && quantity > 0 && unitPrice > 0 && Number.isFinite(nextQuantity) && nextQuantity > oldQuantity &&
    Number.isFinite(newAverage) && newAverage > 0 && Number.isSafeInteger(Math.round(totalCost));
  const difference = valid ? Math.round(quantity * unitPrice) - transaction.amount : 0;
  const canSave = alreadyRecorded ? Boolean(fund.holding) : valid && (Math.abs(difference) <= 1 || confirmDifference);
  const action = fund.holding ? 'Mua thêm' : 'Mua mới';
  const money = (value: number) => formatPrivacyVND(value, privacyMode);
  const price = (value: number) => privacyMode ? '•••••• ₫' : `${numbers.format(value)} ₫`;

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || (!canSave && !pending.current)) return;
    const request: BankFundPurchaseRequest = pending.current ?? {
      symbol: fund.symbol, type: 'expense', accountId: transaction.accountId || '',
      quantity: alreadyRecorded ? null : quantity, unitPrice: alreadyRecorded ? null : unitPrice,
      expectedTransactionRevision: transaction.revision ?? 1,
      expectedHoldingRevision: fund.holding ? fund.holding.revision ?? 1 : null,
      operationId: generateOperationId('bank_fund'), alreadyRecorded, confirmAmountDifference: confirmDifference,
      ...(note !== undefined ? { note } : {})
    };
    try { localStorage.setItem(key, JSON.stringify(request)); }
    catch { setError('Chưa lưu được yêu cầu trên thiết bị. Anh thử lại.'); return; }
    pending.current = request;
    inFlight.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(request);
      try { localStorage.removeItem(key); } catch { /* Server confirmation prevents a duplicate purchase. */ }
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500 && err.status !== 408) {
        pending.current = null;
        try { localStorage.removeItem(key); } catch { /* Keep the error visible. */ }
        setRetrying(false);
        setError(err.message);
      } else {
        setRetrying(true);
        setError('Chưa xác nhận được kết quả. Anh bấm Thử lưu lại.');
      }
    } finally { inFlight.current = false; setSaving(false); }
  }

  return (
    <div {...dialog} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl border-t border-[#8BA5AA]/20 bg-[#161C1E] p-5">
        <h2 className="text-lg font-bold text-[#F2F5F5]">{action} {fund.symbol}</h2>
        <p className="mt-1 text-sm text-[#BFD0D3]">{fund.name}</p>
        <p className="mt-1 text-sm text-[#BFD0D3]">Tiền chi {money(transaction.amount)} · {transaction.accountName}</p>
        <form onSubmit={save} className="mt-4 space-y-3">
          {fund.holding && <label className="flex min-h-11 items-start gap-2 text-sm text-[#D5E1E3]">
            <input type="checkbox" checked={alreadyRecorded} disabled={saving || retrying} onChange={event => setAlreadyRecorded(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
            <span>Đã cập nhật CCQ của lần mua này trong danh mục</span>
          </label>}
          {alreadyRecorded ? <p className="text-sm text-[#BFD0D3]">Lưu để duyệt khoản tiền ngân hàng cho lần mua đã ghi.</p> : <>
            <div><label htmlFor="bank-fund-quantity" className="mb-1 block text-sm text-[#D5E1E3]">Số CCQ của lần mua</label>
              <FundDecimalInput id="bank-fund-quantity" value={quantityText} onChange={value => { setQuantityText(value); setConfirmDifference(false); }} disabled={saving || retrying} placeholder="Ví dụ 25,5" /></div>
            <div><label htmlFor="bank-fund-price" className="mb-1 block text-sm text-[#D5E1E3]">Giá mua lần này / CCQ (₫)</label>
              <FundDecimalInput id="bank-fund-price" value={priceText} onChange={value => { setPriceText(value); setConfirmDifference(false); }} disabled={saving || retrying} placeholder="Ví dụ 32.500,25" /></div>
            {!hasCost && <p className="text-sm text-[#DEB48A]">Anh cập nhật giá vốn của số CCQ đang giữ trước khi mua thêm.</p>}
            {!retrying && valid && <div className="rounded-xl border border-[#8CC7AE]/25 bg-[#8CC7AE]/10 p-3 text-sm text-[#D5E1E3]">
              <p>Tổng sau mua {numbers.format(nextQuantity)} CCQ</p><p>Giá vốn bình quân {price(newAverage)} / CCQ</p>
              {Math.abs(difference) > 1 && <p className="mt-1 text-[#DEB48A]">Giá trị CCQ {money(Math.round(quantity * unitPrice))}, lệch tiền ngân hàng {money(Math.abs(difference))}.</p>}
            </div>}
            {valid && Math.abs(difference) > 1 && <label className="flex min-h-11 items-start gap-2 text-sm text-[#D5E1E3]">
              <input type="checkbox" checked={confirmDifference} disabled={saving || retrying} onChange={event => setConfirmDifference(event.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
              <span>Đã kiểm tra số CCQ, giá khớp lệnh và phần chênh lệch</span>
            </label>}
          </>}
          {retrying && <p className="text-sm text-[#BFD0D3]">Yêu cầu đang chờ xác nhận. Anh thử lưu lại để kiểm tra kết quả.</p>}
          {error && <p role="alert" className="text-sm text-[#E99191]">{error}</p>}
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <button type="button" onClick={close} disabled={saving} className="min-h-11 rounded-xl border border-[#8BA5AA]/25 text-sm text-[#D5E1E3] disabled:opacity-50">Hủy</button>
            <button type="submit" disabled={saving || (!canSave && !retrying)} className="min-h-11 rounded-xl bg-[#8CC7AE] text-sm font-bold text-[#0E1314] disabled:opacity-50">{saving ? 'Đang lưu…' : retrying ? 'Thử lưu lại' : 'Lưu quỹ và duyệt tiền'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
