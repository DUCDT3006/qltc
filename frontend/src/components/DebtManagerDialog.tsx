import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { BankAccount, Debt, DebtKind, DebtPayment, DebtSnapshot, Holding, LoanReceiptDraft, Transaction } from '../types';
import { ApiRequestError, generateOperationId, getDraftOutbox, removeDraftFromOutbox, submitRecordedMutation, type DraftMutation } from '../services/apiClient';
import { formatPrivacyVND } from '../utils/financeMath';
import { useManagedOverlay } from '../utils/overlayManager';
import { ConfirmSheet } from './ConfirmSheet';
import { CurrencyInput } from './CurrencyInput';

const button = 'min-h-11 rounded-xl border border-[#8BA5AA]/30 px-3 text-sm font-semibold text-[#D5E1E3] active:bg-[#263234] disabled:opacity-50';
const primary = 'min-h-11 rounded-xl bg-[#8CC7AE] px-3 text-sm font-bold text-[#0E1314] active:bg-[#B2DEC9] disabled:opacity-50';
const input = 'min-h-11 w-full rounded-xl border border-[#8BA5AA]/25 bg-[#20292B] px-3 text-sm text-[#F2F5F5] [color-scheme:dark] focus:ring-2 focus:ring-[#8CC7AE]/60';
const selectOption = 'bg-[#161C1E] text-[#F2F5F5]';
const label = 'mb-1 block text-sm text-[#BFD0D3]';
const outstanding = (debt: Debt) => debt.principal_vnd + debt.charges_vnd;
const shortDate = (day: string) => day.slice(0, 10).split('-').reverse().join('/');
const canUseAccount = (account: BankAccount) => account.isActive !== false && account.id !== 'acc_unassigned' && (account.currency ?? 'VND').toUpperCase() === 'VND';

function AmountField({ id, text, value, onChange }: { id: string; text: string; value: number; onChange: (amount: number) => void }) {
  return <div><label htmlFor={id} className={label}>{text}</label><CurrencyInput id={id} value={value} onChange={onChange} showQuickChips={false} className="min-h-11 text-sm" /></div>;
}

type Submit = (endpoint: string, body: object, method?: 'POST' | 'DELETE') => void;

function DebtForm({ debt, kind, land, onSave, onBack }: { debt: Debt | null; kind: DebtKind; land: Holding[]; onSave: Submit; onBack: () => void }) {
  const loan = kind === 'receivable';
  const [name, setName] = useState(debt?.name ?? '');
  const [creditor, setCreditor] = useState(debt?.creditor ?? '');
  const [principalVnd, setPrincipal] = useState(debt?.principal_vnd ?? 0);
  const [chargesVnd, setCharges] = useState(debt?.charges_vnd ?? 0);
  const [dueOn, setDueOn] = useState(debt?.due_on ?? '');
  const [dueVnd, setDue] = useState(debt?.due_vnd ?? 0);
  const [collateralHoldingId, setCollateral] = useState(debt?.collateral_holding_id ?? '');
  const valid = Boolean(name.trim() && (debt || principalVnd + chargesVnd > 0) && (!dueVnd || dueOn));
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (valid) onSave('/debts', { id: debt?.id ?? null, expectedRevision: debt?.revision ?? null, kind, name, creditor, principalVnd, chargesVnd,
      dueOn: dueOn || null, dueVnd, collateralHoldingId: collateralHoldingId || null });
  }}>
    <p className="text-sm text-[#BFD0D3]">{loan ? 'Nhập số gốc người vay còn nợ anh. Khi nhận chuyển khoản, chọn Thu nợ trong mục Chờ duyệt.' : 'Nhập số dư nợ hiện tại. Dùng mục Trả nợ để ghi tiền ra từ tài khoản.'}</p>
    <label className={label}>{loan ? 'Tên khoản cho vay' : 'Tên khoản nợ'}<input className={input} maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder={loan ? 'Ví dụ cho vay mua xe' : 'Ví dụ vay mua lô đất'} required /></label>
    <label className={label}>{loan ? 'Người vay' : 'Người cho vay / ngân hàng'}<input className={input} maxLength={100} value={creditor} onChange={e => setCreditor(e.target.value)} /></label>
    <AmountField id="debt-principal" text={loan ? 'Gốc còn phải thu' : 'Gốc còn lại'} value={principalVnd} onChange={setPrincipal} />
    {!loan && <AmountField id="debt-charges" text="Lãi/phí đã phát sinh chưa trả" value={chargesVnd} onChange={setCharges} />}
    <label className={label}>{loan ? 'Ngày hẹn trả' : 'Ngày trả kỳ tới'}<input type="date" className={input} value={dueOn} onChange={e => setDueOn(e.target.value)} /></label>
    {!loan && <><AmountField id="debt-due" text="Số tiền dự kiến kỳ tới" value={dueVnd} onChange={setDue} />
    <label className={label}>Lô đất thế chấp<select className={input} value={collateralHoldingId} onChange={e => setCollateral(e.target.value)}>
      <option value="" className={selectOption}>Không gắn lô đất</option>{land.map(holding => <option key={holding.id} value={holding.id} className={selectOption}>{holding.name}</option>)}
    </select></label></>}
    <div className="grid grid-cols-[1fr_2fr] gap-2"><button className={button} type="button" onClick={onBack}>Quay lại</button><button className={primary} type="submit" disabled={!valid}>{loan ? 'Lưu khoản cho vay' : 'Lưu khoản nợ'}</button></div>
  </form>;
}

function RepaymentForm({ debt, accounts, pending, money, privacyMode, onSave, onBack }: {
  debt: Debt; accounts: BankAccount[]; pending: Transaction[]; money: (value: number) => string; privacyMode: boolean; onSave: Submit; onBack: () => void;
}) {
  const [accountId, setAccount] = useState('');
  const [transactionId, setTransaction] = useState('');
  const [principalVnd, setPrincipal] = useState(0);
  const [chargesVnd, setCharges] = useState(0);
  const bankNotice = pending.find(row => row.id === transactionId);
  const total = principalVnd + chargesVnd;
  const valid = accounts.some(row => row.id === accountId) && Number.isSafeInteger(total) && total > 0 && total <= 10_000_000_000_000 &&
    principalVnd <= debt.principal_vnd && (!transactionId || bankNotice?.amount === total);
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (valid) onSave(`/debts/${encodeURIComponent(debt.id)}/repay`, { accountId, principalVnd, chargesVnd, transactionId: bankNotice?.id ?? null,
      expectedTransactionRevision: bankNotice ? bankNotice.revision ?? 1 : null, expectedRevision: debt.revision });
  }}>
    <p className="text-sm text-[#BFD0D3]">{debt.name} · Gốc còn {money(debt.principal_vnd)}</p>
    <label className={label}>Thông báo ngân hàng<select className={input} value={transactionId} onChange={e => {
      setTransaction(e.target.value);
      const tx = pending.find(row => row.id === e.target.value);
      if (tx && accounts.some(row => row.id === tx.accountId) && !tx.needsAccountReview) setAccount(tx.accountId || '');
    }}>
      <option value="" className={selectOption}>Ghi tay khi chưa có thông báo</option>
      {pending.map(tx => <option value={tx.id} key={tx.id} className={selectOption}>{money(tx.amount)} · {privacyMode ? tx.occurredAt : tx.description.slice(0, 65)}</option>)}
    </select></label>
    <label className={label}>Tài khoản đã trả tiền<select className={input} value={accountId} onChange={e => setAccount(e.target.value)}>
      <option value="" className={selectOption}>Chọn tài khoản</option>{accounts.map(account => <option key={account.id} value={account.id} className={selectOption}>{account.name}</option>)}
    </select></label>
    <AmountField id="repay-principal" text="Tiền gốc đã trả" value={principalVnd} onChange={setPrincipal} />
    <AmountField id="repay-charges" text="Lãi/phí đã trả" value={chargesVnd} onChange={setCharges} />
    <div className="rounded-xl border border-[#8CC7AE]/25 bg-[#8CC7AE]/10 p-3 text-sm text-[#D5E1E3]">
      <p>Tổng tiền ra {money(total)}</p><p>Dư gốc sau trả {money(Math.max(0, debt.principal_vnd - principalVnd))}</p>
      {bankNotice && <p>Tiền trên thông báo {money(bankNotice.amount)}</p>}
    </div>
    {principalVnd > debt.principal_vnd && <p role="alert" className="text-sm text-[#E99191]">Tiền gốc trả vượt số gốc còn lại.</p>}
    {bankNotice && bankNotice.amount !== total && <p className="text-sm text-[#DEB48A]">Anh nhập gốc và lãi/phí sao cho tổng bằng tiền trên thông báo.</p>}
    {!transactionId && <p className="text-xs text-[#BFD0D3]">Nếu thông báo của lần trả này tới sau khi anh ghi tay, anh có thể bỏ qua thông báo đó trong Chờ duyệt.</p>}
    <div className="grid grid-cols-[1fr_2fr] gap-2"><button className={button} type="button" onClick={onBack}>Quay lại</button><button className={primary} type="submit" disabled={!valid}>Ghi trả nợ</button></div>
  </form>;
}

function CollectionForm({ receipt, loans, settledLoanCount, payableDebtCount, accounts, money, onSave, onAdd, onBack }: {
  receipt: LoanReceiptDraft; loans: Debt[]; settledLoanCount: number; payableDebtCount: number; accounts: BankAccount[]; money: (value: number) => string;
  onSave: Submit; onAdd: () => void; onBack: () => void;
}) {
  const { transaction, note } = receipt;
  const [loanId, setLoanId] = useState('');
  const [accountId, setAccountId] = useState(accounts.some(account => account.id === transaction.accountId) ? transaction.accountId ?? '' : '');
  const loan = loans.find(row => row.id === loanId);
  const excess = Boolean(loan && transaction.amount > loan.principal_vnd);
  const valid = Boolean(loan && !excess && Number.isSafeInteger(transaction.amount) && transaction.amount > 0 &&
    accounts.some(account => account.id === accountId));

  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault();
    if (!valid || !loan) return;
    onSave(`/debts/${encodeURIComponent(loan.id)}/repay`, {
      type: 'income', accountId, principalVnd: transaction.amount, chargesVnd: 0, transactionId: transaction.id,
      expectedTransactionRevision: transaction.revision ?? 1, expectedRevision: loan.revision, note
    });
  }}>
    <p className="text-sm text-[#D5E1E3]">Tiền người vay chuyển <strong>{money(transaction.amount)}</strong></p>
    {loans.length === 0 ? <div className="space-y-2 rounded-xl bg-[#20292B] p-3">
      <p className="text-sm text-[#BFD0D3]">Anh chưa có khoản cho vay còn dư gốc.</p>
      {settledLoanCount > 0 && <p className="text-xs text-[#97A8AB]">Hiện có {settledLoanCount} khoản cho vay đã tất toán (gốc còn 0 ₫).</p>}
      {payableDebtCount > 0 && <p className="text-xs text-[#DEB48A]">Đang có {payableDebtCount} khoản nằm ở mục Nợ phải trả (chỉ các khoản tạo ở mục Khoản cho vay mới chọn thu nợ được).</p>}
      <button type="button" className={button} onClick={onAdd}>Thêm khoản cho vay</button>
    </div> : <>
      <label className={label}>Khoản cho vay<select id="loan-receipt-choice" className={input} value={loanId} onChange={e => setLoanId(e.target.value)}>
        <option value="" className={selectOption}>Chọn khoản cho vay</option>
        {loans.map(row => <option key={row.id} value={row.id} className={selectOption}>{row.name}{row.creditor ? ' · ' + row.creditor : ''} · Còn {money(row.principal_vnd)}</option>)}
      </select></label>
      <div role="group" aria-label="Chọn nhanh khoản cho vay" className="space-y-1.5">
        {loans.map(row => {
          const selected = row.id === loanId;
          return <button key={row.id} type="button" aria-pressed={selected} onClick={() => setLoanId(row.id)}
            className={`flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
              selected ? 'border-[#8CC7AE] bg-[#8CC7AE]/15 text-[#F2F5F5]' : 'border-[#8BA5AA]/25 bg-[#20292B] text-[#D5E1E3] active:bg-[#2A3639]'
            }`}>
            <span className="min-w-0 truncate font-medium">{row.name}{row.creditor ? ` · ${row.creditor}` : ''}</span>
            <span className="shrink-0 font-semibold text-[#8CC7AE]">{money(row.principal_vnd)}</span>
          </button>;
        })}
      </div>
      <label className={label}>Tài khoản nhận<select id="loan-receipt-account" className={input} value={accountId} onChange={e => setAccountId(e.target.value)}>
        <option value="" className={selectOption}>Chọn tài khoản nhận</option>
        {accounts.map(account => <option key={account.id} value={account.id} className={selectOption}>{account.name}</option>)}
      </select></label>
      {loan && (excess
        ? <p role="alert" className="text-sm text-[#E99191]">Tiền nhận vượt dư gốc {money(loan.principal_vnd)}. Anh kiểm tra lại khoản cho vay.</p>
        : <div className="space-y-1 rounded-xl border border-[#8CC7AE]/25 bg-[#8CC7AE]/10 p-3 text-sm text-[#D5E1E3]" aria-live="polite">
          <p>Gốc trước khi thu {money(loan.principal_vnd)}</p>
          <p>Gốc còn lại sau khi thu <strong>{money(loan.principal_vnd - transaction.amount)}</strong></p>
        </div>)}
    </>}
    <div className="grid grid-cols-[1fr_2fr] gap-2">
      <button type="button" className={button} onClick={onBack}>Quay lại</button>
      <button type="submit" className={primary} disabled={!valid}>Xác nhận thu nợ</button>
    </div>
  </form>;
}

export function DebtManagerDialog({ data, accounts, holdings, pendingTransactions, initialKind, receipt, privacyMode, onReload, onClose }: {
  data: DebtSnapshot | null;
  accounts: BankAccount[];
  holdings: Holding[];
  pendingTransactions: Transaction[];
  initialKind: DebtKind;
  receipt?: LoanReceiptDraft;
  privacyMode: boolean;
  onReload: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState(initialKind);
  const [editor, setEditor] = useState<{ mode: 'edit'; debt: Debt | null } | { mode: 'repay'; debt: Debt } | { mode: 'collect' } | null>(
    receipt ? { mode: 'collect' } : null
  );
  const [queued, setQueued] = useState(() => getDraftOutbox().find(row => row.endpoint === '/debts' || row.endpoint.startsWith('/debts/')) ?? null);
  const [confirm, setConfirm] = useState<{ debt: Debt; payment?: DebtPayment } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const close = () => { if (!busyRef.current) onClose(); };
  const overlay = useManagedOverlay(true, close, 'Quản lý nợ');
  const money = (value: number) => formatPrivacyVND(value, privacyMode);
  const land = holdings.filter(holding => holding.assetClass === 'land' && holding.id);
  const eligibleAccounts = accounts.filter(canUseAccount);
  const isLoanView = kind === 'receivable';
  const debts = data?.debts.filter(debt => (debt.kind ?? 'payable') === kind) ?? [];
  const activeLoans = debts.filter(debt => debt.principal_vnd > 0);
  const settledLoanCount = debts.filter(debt => debt.principal_vnd === 0).length;
  const payableDebtCount = data?.debts.filter(debt => (debt.kind ?? 'payable') !== 'receivable' && debt.principal_vnd > 0).length ?? 0;
  const receiptCurrent = receipt && pendingTransactions.some(tx => tx.id === receipt.transaction.id && tx.status === 'pending' &&
    (tx.revision ?? 1) === (receipt.transaction.revision ?? 1));
  const pending = pendingTransactions.filter(tx => tx.status === 'pending' && tx.type === 'expense' && tx.review?.type !== 'income' &&
    ['notification', 'sms'].includes(tx.source ?? '') && !tx.fundPurchase && !tx.transferPairId && tx.review?.bankCode !== 'FMARKET');

  const send = async (draft: DraftMutation) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      await submitRecordedMutation(draft);
      setQueued(null);
      setEditor(receipt && draft.endpoint === '/debts' && draft.payload.kind === 'receivable' ? { mode: 'collect' } : null);
      const complete = await onReload();
      setMessage(complete ? (draft.payload.type === 'income' ? 'Đã ghi thu nợ và cập nhật dư gốc.' :
        isLoanView ? 'Đã lưu thông tin khoản cho vay.' : 'Đã lưu thông tin khoản nợ.') : 'Đã lưu. Anh tải lại để xem số dư và dư gốc mới.');
    } catch (err) {
      const saved = getDraftOutbox().find(item => item.operationId === draft.operationId);
      setQueued(saved ?? null);
      setError(saved ? 'Chưa xác nhận được kết quả. Anh bấm Thử gửi lại.' : err instanceof Error ? err.message : 'Chưa lưu được.');
      if (err instanceof ApiRequestError && err.status === 409) await onReload();
    } finally { setBusy(false); busyRef.current = false; }
  };
  const submit: Submit = (endpoint, payload, method = 'POST') => {
    if (queued) return;
    void send({ endpoint, payload, method, operationId: generateOperationId('debt'), createdAt: new Date().toISOString() });
  };
  const begin = (value: typeof editor) => { setEditor(value); setMessage(''); setError(''); };
  const debtLabel = isLoanView ? 'khoản cho vay' : 'khoản nợ';
  const title = editor?.mode === 'repay' ? 'Ghi trả nợ' : editor?.mode === 'collect' ? 'Ghi thu nợ' :
    editor?.mode === 'edit' ? (editor.debt ? 'Sửa ' : 'Thêm ') + debtLabel : isLoanView ? 'Khoản cho vay' : 'Nợ phải trả';

  return <>
    <div {...overlay} className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl border-t border-[#8BA5AA]/25 bg-[#161C1E] p-4 pb-6 text-[#F2F5F5]">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={close} disabled={busy} className="grid h-11 w-11 place-items-center rounded-xl bg-[#20292B] text-[#D5E1E3]" aria-label="Đóng quản lý nợ"><X size={20} aria-hidden="true" /></button>
        </div>
        {busy && <p role="status" className="mb-3 text-sm text-[#BFD0D3]">Đang lưu…</p>}
        {message && <p role="status" className="mb-3 text-sm text-[#8CC7AE]">{message}</p>}
        {error && <p role="alert" className="mb-3 text-sm text-[#E99191]">{error}</p>}
        {queued && <div className="mb-3 rounded-xl border border-[#DEB48A]/35 bg-[#20292B] p-3 text-sm text-[#D5E1E3]">
          <p>Có yêu cầu đang chờ xác nhận trên thiết bị nên biểu mẫu tạm khóa.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy} onClick={() => void send(queued)}>Thử gửi lại</button>
            <button type="button" className={button} disabled={busy} onClick={() => { removeDraftFromOutbox(queued.operationId); setQueued(null); setError(''); }}>Hủy yêu cầu chờ</button>
          </div>
        </div>}
        <fieldset disabled={busy || Boolean(queued)} className="min-w-0 space-y-3 disabled:opacity-70">
          {!editor && <div role="group" aria-label="Loại khoản nợ" className="grid grid-cols-2 gap-2">
            <button type="button" className={isLoanView ? button : primary} aria-pressed={!isLoanView} onClick={() => { setKind('payable'); begin(null); }}>Nợ phải trả</button>
            <button type="button" className={isLoanView ? primary : button} aria-pressed={isLoanView} onClick={() => { setKind('receivable'); begin(null); }}>Khoản cho vay</button>
          </div>}
          {editor?.mode === 'collect' && receipt ? (
            !receiptCurrent ? <p role="alert" className="text-sm text-[#DEB48A]">Giao dịch đã thay đổi. Anh mở lại giao dịch trong Chờ duyệt.</p> :
            !data ? <div className="space-y-2"><p className="text-sm text-[#BFD0D3]">Chưa tải được khoản cho vay.</p><button type="button" className={button} onClick={() => void onReload()}>Tải lại</button></div> :
            <CollectionForm receipt={receipt} loans={activeLoans} settledLoanCount={settledLoanCount} payableDebtCount={payableDebtCount} accounts={eligibleAccounts} money={money}
              onSave={submit} onAdd={() => begin({ mode: 'edit', debt: null })} onBack={close} />
          ) : editor?.mode === 'edit' ? <DebtForm key={editor.debt?.id ?? 'new'} debt={editor.debt} kind={kind} land={land}
              onSave={submit} onBack={() => begin(receipt && !editor.debt ? { mode: 'collect' } : null)} /> :
            editor?.mode === 'repay' ? <RepaymentForm key={editor.debt.id} debt={editor.debt} accounts={eligibleAccounts} pending={pending} money={money}
              privacyMode={privacyMode} onSave={submit} onBack={() => begin(null)} /> : <>
            {!data ? <div className="space-y-2"><p className="text-sm text-[#BFD0D3]">Chưa tải được danh sách khoản nợ.</p><button type="button" className={button} onClick={() => void onReload()}>Tải lại</button></div> : <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-sm text-[#BFD0D3]">{isLoanView ? 'Tổng gốc còn phải thu' : 'Tổng nợ còn lại'}</p><p className="text-xl font-bold">{money(debts.reduce((sum, debt) => sum + outstanding(debt), 0))}</p></div>
                <button type="button" className={`${primary} flex items-center gap-1.5`} onClick={() => begin({ mode: 'edit', debt: null })}><Plus size={16} aria-hidden="true" />Thêm {debtLabel}</button>
              </div>
              {debts.length === 0 && <p className="rounded-xl bg-[#20292B] p-3 text-sm text-[#BFD0D3]">Anh chưa ghi {debtLabel} nào.</p>}
              {debts.map(debt => {
                const payments = data.payments.filter(row => row.debt_id === debt.id);
                const collateral = land.find(row => row.id === debt.collateral_holding_id);
                const linkedDebt = collateral ? debts.filter(row => row.collateral_holding_id === collateral.id).reduce((sum, row) => sum + outstanding(row), 0) : 0;
                return <article key={debt.id} className="space-y-2 rounded-2xl border border-[#8BA5AA]/20 bg-[#20292B] p-3">
                  <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 break-words text-sm font-bold">{debt.name}</h3><span className="shrink-0 text-sm font-bold text-[#DEB48A]">{outstanding(debt) ? money(outstanding(debt)) : 'Đã tất toán'}</span></div>
                  {debt.creditor && <p className="break-words text-sm text-[#BFD0D3]">{debt.creditor}</p>}
                  <p className="text-sm text-[#D5E1E3]">{isLoanView ? 'Gốc còn phải thu' : 'Gốc'} {money(debt.principal_vnd)}{!isLoanView && <> · Lãi/phí {money(debt.charges_vnd)}</>}</p>
                  {outstanding(debt) > 0 && debt.due_on && <p className="text-sm text-[#BFD0D3]">Kỳ tới {shortDate(debt.due_on)}{debt.due_vnd ? ` · ${money(debt.due_vnd)}` : ''}</p>}
                  {collateral && <p className="break-words text-sm text-[#BFD0D3]">Thế chấp {collateral.name}{collateral.currentPrice > 0 ? ` · Giá trị ròng ${money(Math.round(collateral.quantity * collateral.currentPrice) - linkedDebt)}` : ''}</p>}
                  <div className="flex flex-wrap gap-2">
                    {!isLoanView && outstanding(debt) > 0 && <button type="button" className={primary} onClick={() => begin({ mode: 'repay', debt })}>Trả nợ</button>}
                    <button type="button" className={button} onClick={() => begin({ mode: 'edit', debt })}>Sửa</button>
                    {!debt.has_payment_history && <button type="button" className={button} onClick={() => setConfirm({ debt })}>Xóa</button>}
                  </div>
                  {payments.length > 0 && <details className="text-sm text-[#BFD0D3]"><summary className="min-h-9 cursor-pointer">Lịch sử {isLoanView ? 'thu nợ' : 'trả nợ'} ({payments.length})</summary>
                    <ul className="space-y-2">{payments.map(payment => {
                      const mayUndo = debt.revision === payment.debt_revision_after && eligibleAccounts.some(row => row.id === payment.account_id && row.revision === payment.account_revision_after);
                      return <li key={payment.id} className="border-t border-[#8BA5AA]/20 pt-2">
                        <p>{shortDate(payment.occurred_at)} · {payment.account_name ?? 'Tài khoản đã lưu'}</p>
                        <p>{isLoanView ? 'Gốc đã thu' : 'Gốc'} {money(payment.principal_vnd)}{!isLoanView && <> · Lãi/phí {money(payment.charges_vnd)}</>}</p>
                        {!privacyMode && payment.note && <p className="break-words whitespace-pre-wrap">{payment.note}</p>}
                        {mayUndo && <button type="button" className={`${button} mt-2`} onClick={() => setConfirm({ debt, payment })}>{isLoanView ? 'Hoàn tác lần thu' : 'Hoàn tác lần trả'}</button>}
                      </li>;
                    })}</ul>
                  </details>}
                </article>;
              })}
            </>}
          </>}
        </fieldset>
      </div>
    </div>
    <ConfirmSheet isOpen={Boolean(confirm)} title={confirm?.payment ? (isLoanView ? 'Hoàn tác lần thu nợ?' : 'Hoàn tác lần trả nợ?') : 'Xóa ' + debtLabel + '?'}
      description={confirm?.payment ? 'App sẽ khôi phục số dư tài khoản, dư gốc và đưa thông báo ngân hàng liên quan về Chờ duyệt.' : 'App sẽ bỏ ' + debtLabel + ' này khỏi danh sách.'}
      confirmText={confirm?.payment ? 'Hoàn tác' : 'Xóa ' + debtLabel} isDanger onCancel={() => setConfirm(null)} onConfirm={() => {
        if (!confirm) return;
        const debtPath = `/debts/${encodeURIComponent(confirm.debt.id)}`;
        if (confirm.payment) submit(`${debtPath}/payments/${encodeURIComponent(confirm.payment.id)}/undo`, {});
        else submit(debtPath, { expectedRevision: confirm.debt.revision }, 'DELETE');
        setConfirm(null);
      }} />
  </>;
}
