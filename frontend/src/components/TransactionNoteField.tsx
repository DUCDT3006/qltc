import { useRef, useState } from 'react';
import { PencilLine } from 'lucide-react';

export function TransactionNoteField({ id, value, onChange, collapsible = true }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  collapsible?: boolean;
}) {
  const [expanded, setExpanded] = useState(!collapsible || Boolean(value));
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="my-3 select-text" onTouchStart={event => event.stopPropagation()} onTouchMove={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
      {!expanded && <button type="button" aria-expanded={false} aria-controls={id} onClick={() => {
        setExpanded(true);
        requestAnimationFrame(() => input.current?.focus());
      }} className="min-h-11 flex items-center gap-2 rounded-xl px-3 text-sm text-[#BFD0D3] bg-[#1C2628] border border-[#8BA5AA]/20">
        <PencilLine size={16} aria-hidden="true" /> Thêm ghi chú
      </button>}
      <div hidden={!expanded}>
        <label htmlFor={id} className="block text-sm font-medium text-[#C4D0D2] mb-1.5">Ghi chú <span className="font-normal text-[#869699]">(không bắt buộc)</span></label>
        <textarea ref={input} id={id} rows={2} maxLength={500} value={value} onChange={event => onChange(event.target.value)} aria-describedby={`${id}-hint`}
          placeholder="Ví dụ: Ăn trưa cùng gia đình"
          className="block w-full min-h-20 resize-y rounded-xl bg-[#20292B] border border-[#8BA5AA]/25 px-3 py-2.5 text-base leading-relaxed text-[#F2F5F5] placeholder:text-[#869699] focus:outline-none focus:ring-2 focus:ring-[#8CC7AE]/60" />
        <p id={`${id}-hint`} className="mt-1 text-xs text-[#869699]">Có thể để trống · {value.length}/500 ký tự</p>
      </div>
    </div>
  );
}
