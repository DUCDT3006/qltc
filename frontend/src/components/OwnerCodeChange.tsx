import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, KeyRound } from 'lucide-react';
import { API_BASE, ApiRequestError, apiRequestJson, generateOperationId } from '../services/apiClient';

const inputClass = 'mt-1 min-h-11 w-full rounded-xl border border-[#8BA5AA]/25 bg-[#20292B] px-3 text-base text-[#F2F5F5] focus:outline-none focus:ring-2 focus:ring-[#8CC7AE]/60';

export function OwnerCodeChange() {
  const [open, setOpen] = useState(false);
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const operationId = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  const edit = (setter: (value: string) => void, value: string) => {
    setter(value);
    operationId.current = null;
    setError('');
    setMessage('');
  };
  const close = () => {
    if (busy) return;
    setCurrentCode(''); setNewCode(''); setConfirmation('');
    setVisible(false); setOpen(false); setError('');
    operationId.current = null;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const current = currentCode.trim();
    const next = newCode.trim();
    if (!current || Array.from(next).length < 5) { setError('Anh nhập mã hiện tại và mã mới có ít nhất 5 ký tự.'); return; }
    if (next !== confirmation.trim()) { setError('Hai lần nhập mã mới chưa khớp.'); return; }
    if (next === current) { setError('Anh chọn mã mới khác mã hiện tại.'); return; }
    operationId.current ??= generateOperationId('owner_code');
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 20000);
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiRequestJson<{ success: boolean }>(API_BASE + '/auth/change-owner-code', {
        method: 'POST', body: { currentCode: current, newCode: next, operationId: operationId.current }, signal: request.signal
      });
      if (!result?.success) throw new Error('Missing confirmation');
      setCurrentCode(''); setNewCode(''); setConfirmation('');
      setVisible(false); setOpen(false); operationId.current = null;
      setMessage('Đã đổi mã. Các phiên đăng nhập khác cần dùng mã mới.');
    } catch (cause) {
      if (cause instanceof ApiRequestError && cause.status === 429) {
        setError('Nhập sai quá nhiều lần. Anh thử lại sau 15 phút.');
      } else if (cause instanceof ApiRequestError && cause.status >= 400 && cause.status < 500) {
        setError(cause.message);
      } else {
        setError('Chưa xác nhận được kết quả. Anh bấm Lưu mã mới lần nữa để kiểm tra.');
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === request) controller.current = null;
      setBusy(false);
    }
  };

  return <section className="space-y-3 rounded-2xl border border-[#8BA5AA]/15 bg-[#1C2426] p-3.5">
    <button type="button" aria-expanded={open} onClick={() => {
      if (open) { close(); return; }
      setOpen(true);
      setMessage('');
    }}
      disabled={busy} className="flex min-h-11 w-full items-center justify-between gap-2 text-left text-sm font-semibold text-[#D5E1E3] disabled:opacity-60">
      <span className="flex items-center gap-2.5"><KeyRound size={17} className="text-[#8CC7AE]" aria-hidden="true" /> Đổi mã chủ tài khoản</span>
      {open ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
    </button>
    {message && <p role="status" className="text-sm text-[#8CC7AE]">{message}</p>}
    {open && <form onSubmit={event => void submit(event)} className="space-y-3 border-t border-[#8BA5AA]/15 pt-3">
      <p className="text-xs leading-relaxed text-[#BFD0D3]">Mã mới có ít nhất 5 ký tự. Anh ghi nhớ mã mới để đăng nhập lại. Các phiên đăng nhập khác sẽ cần dùng mã mới.</p>
      <p className="text-xs leading-relaxed text-[#BFD0D3]">Nhập sai 10 lần sẽ cần chờ tối đa 15 phút.</p>
      <label className="block text-sm text-[#D5E1E3]">Mã hiện tại
        <input id="owner-code-current" type={visible ? 'text' : 'password'} autoComplete="current-password" maxLength={256}
          className={inputClass} value={currentCode} disabled={busy} onChange={event => edit(setCurrentCode, event.target.value)} />
      </label>
      <label className="block text-sm text-[#D5E1E3]">Mã mới
        <input id="owner-code-new" type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128}
          className={inputClass} value={newCode} disabled={busy} onChange={event => edit(setNewCode, event.target.value)} />
      </label>
      <label className="block text-sm text-[#D5E1E3]">Nhập lại mã mới
        <input id="owner-code-confirm" type={visible ? 'text' : 'password'} autoComplete="new-password" maxLength={128}
          className={inputClass} value={confirmation} disabled={busy} onChange={event => edit(setConfirmation, event.target.value)} />
      </label>
      <button type="button" aria-pressed={visible} onClick={() => setVisible(value => !value)}
        className="flex min-h-11 items-center gap-2 text-sm font-semibold text-[#8CC7AE]">
        {visible ? <EyeOff size={17} aria-hidden="true" /> : <Eye size={17} aria-hidden="true" />}
        {visible ? 'Ẩn mã' : 'Hiện mã'}
      </button>
      {error && <p role="alert" className="text-sm text-[#E99191]">{error}</p>}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <button type="button" onClick={close} disabled={busy} className="min-h-11 rounded-xl border border-[#8BA5AA]/30 text-sm font-semibold text-[#D5E1E3] disabled:opacity-50">Hủy</button>
        <button type="submit" disabled={busy || !currentCode || !newCode || !confirmation}
          className="min-h-11 rounded-xl bg-[#8CC7AE] px-3 text-sm font-bold text-[#0E1314] active:bg-[#B2DEC9] disabled:opacity-50">
          {busy ? 'Đang đổi mã…' : 'Lưu mã mới'}
        </button>
      </div>
    </form>}
  </section>;
}
