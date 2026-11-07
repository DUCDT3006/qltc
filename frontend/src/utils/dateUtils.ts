// Tiện ích xử lý Ngày tháng & Múi giờ Việt Nam (UTC+7)

export function getVietnamDate(date?: Date | string | number): Date {
  const d = date ? new Date(date) : new Date();
  // Lấy UTC timestamp và cộng 7 tiếng
  const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
  return new Date(utc + (3600000 * 7));
}

export function formatOccurredTime(isoString?: string): string {
  if (!isoString) return 'Vừa xong';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;

    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const hours = d.getHours().toString().padStart(2, '0');
    const minutes = d.getMinutes().toString().padStart(2, '0');
    const timeStr = `${hours}:${minutes}`;

    if (isToday) {
      return `Hôm nay · ${timeStr}`;
    }
    if (isYesterday) {
      return `Hôm qua · ${timeStr}`;
    }

    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    return `${day}/${month} · ${timeStr}`;
  } catch {
    return isoString;
  }
}

// Kiểm tra giao dịch có nằm trong tháng, quý, hoặc năm đang chọn (tính theo giờ Việt Nam UTC+7)
export function isTxnInPeriod(
  isoDate: string | undefined,
  periodType: 'month' | 'quarter' | 'year',
  offsetOrTarget: number | Date = 0
): boolean {
  if (!isoDate) return false;
  try {
    const txnDate = getVietnamDate(isoDate);
    let targetDate = getVietnamDate();
    if (offsetOrTarget instanceof Date) {
      targetDate = getVietnamDate(offsetOrTarget);
    } else if (typeof offsetOrTarget === 'number' && offsetOrTarget !== 0) {
      if (periodType === 'month') {
        targetDate.setMonth(targetDate.getMonth() + offsetOrTarget);
      } else if (periodType === 'quarter') {
        targetDate.setMonth(targetDate.getMonth() + (offsetOrTarget * 3));
      } else {
        targetDate.setFullYear(targetDate.getFullYear() + offsetOrTarget);
      }
    }

    if (periodType === 'month') {
      return txnDate.getFullYear() === targetDate.getFullYear() &&
             txnDate.getMonth() === targetDate.getMonth();
    }

    if (periodType === 'quarter') {
      const txnQuarter = Math.floor(txnDate.getMonth() / 3);
      const targetQuarter = Math.floor(targetDate.getMonth() / 3);
      return txnDate.getFullYear() === targetDate.getFullYear() &&
             txnQuarter === targetQuarter;
    }

    if (periodType === 'year') {
      return txnDate.getFullYear() === targetDate.getFullYear();
    }

    return true;
  } catch {
    return false;
  }
}

// Lấy nhãn hiển thị cho thanh chọn kỳ (ví dụ: "Tháng 11/2026", "Quý 4/2026", "Năm 2026")
export function getPeriodDisplayLabel(
  periodType: 'month' | 'quarter' | 'year',
  offset: number = 0
): string {
  const d = getVietnamDate();
  if (periodType === 'month') {
    d.setMonth(d.getMonth() + offset);
    return `Tháng ${d.getMonth() + 1}/${d.getFullYear()}`;
  }
  if (periodType === 'quarter') {
    d.setMonth(d.getMonth() + (offset * 3));
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `Quý ${quarter}/${d.getFullYear()}`;
  }
  if (periodType === 'year') {
    d.setFullYear(d.getFullYear() + offset);
    return `Năm ${d.getFullYear()}`;
  }
  return '';
}
