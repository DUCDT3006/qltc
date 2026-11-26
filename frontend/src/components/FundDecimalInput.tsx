import type { ChangeEvent, ClipboardEvent } from 'react';

const draftFormat = new Intl.NumberFormat('vi-VN', { useGrouping: false, maximumFractionDigits: 20 });

export function fundPurchasePriceDraft(amount: number): string {
  return Number.isFinite(amount) && amount > 0 ? draftFormat.format(amount) : '';
}

function formatDraft(value: string): string {
  const [whole, fraction] = value.split(',');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return fraction === undefined ? grouped : `${grouped},${fraction}`;
}

function displayCaret(value: string, length: number): number {
  if (length === 0) return 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== '.' && --length === 0) return i + 1;
  }
  return value.length;
}

export function FundDecimalInput({ id, value, onChange, placeholder, disabled }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const display = formatDraft(value);

  const applyEdit = (input: HTMLInputElement, text: string, caret: number) => {
    const draft = text.replace(/\./g, '');
    if (!/^\d*(?:,\d*)?$/.test(draft)) return;

    const leadingZero = draft.startsWith(',');
    const nextDraft = leadingZero ? `0${draft}` : draft;
    const nextDisplay = formatDraft(nextDraft);
    const beforeCaret = text.slice(0, caret).replace(/\./g, '').length + (leadingZero ? 1 : 0);
    const nextCaret = displayCaret(nextDisplay, beforeCaret);
    input.value = nextDisplay;
    input.setSelectionRange(nextCaret, nextCaret);
    onChange(nextDraft);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    let text = input.value;
    const caret = input.selectionStart ?? text.length;
    const inserted = (event.nativeEvent as InputEvent).data;
    const insertedDot = inserted === '.' || (inserted == null && text.length === display.length + 1 &&
      text.slice(0, caret - 1) + text.slice(caret) === display);
    // Some Android keyboards emit a dot for the decimal key even with inputMode="decimal".
    if (insertedDot && text[caret - 1] === '.' && !text.includes(',')) {
      text = `${text.slice(0, caret - 1)},${text.slice(caret)}`;
    }
    applyEdit(input, text, caret);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const input = event.currentTarget;
    const pasted = event.clipboardData.getData('text').replace(/\s/g, '');
    const isVietnamese = /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d*)?$/.test(pasted) || /^,\d+$/.test(pasted);
    const decimal = isVietnamese ? pasted : /^\d+\.\d+$/.test(pasted) ? pasted.replace('.', ',') : null;
    if (decimal === null) return;
    const start = input.selectionStart ?? display.length;
    const end = input.selectionEnd ?? start;
    applyEdit(input, display.slice(0, start) + decimal + display.slice(end), start + decimal.length);
  };

  return (
    <input id={id} type="text" inputMode="decimal" autoComplete="off" value={display} disabled={disabled}
      onChange={handleChange} onPaste={handlePaste} placeholder={placeholder}
      className="min-h-11 w-full rounded-xl border border-[#8BA5AA]/20 bg-[#20292B] px-3 text-base text-[#F2F5F5] focus:outline-none focus:ring-2 focus:ring-[#8CC7AE]/60" />
  );
}
