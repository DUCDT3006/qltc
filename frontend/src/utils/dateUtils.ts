// Tiện ích xử lý Ngày tháng & Múi giờ Việt Nam (UTC+7) chuẩn xác cho cả ISO 8601 và SQLite UTC

export function parseIsoOrSqliteUtc(raw?: Date | string | number): Date | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) {
    return isNaN(raw.getTime()) ? null : raw;
  }
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Chuẩn hóa chuỗi SQLite UTC "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SSZ"
  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(str)) {
    const normalized = str.replace(/\s+/, 'T') + 'Z';
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

export function getVietnamDate(date?: Date | string | number): Date {
  const parsed = date !== undefined ? parseIsoOrSqliteUtc(date) : new Date();
  const base = parsed || new Date();
  // Chuyển về UTC rồi cộng đúng +7 giờ để các hàm getFullYear/getMonth/getDate trả về lịch Việt Nam
  const utcMs = base.getTime() + base.getTimezoneOffset() * 60000;
  return new Date(utcMs + 7 * 3600000);
}

export function formatOccurredTime(isoString?: string): string {
  if (!isoString) return 'Vừa xong';
  const parsed = parseIsoOrSqliteUtc(isoString);
  if (!parsed) return isoString;

  const d = getVietnamDate(parsed);
  const now = getVietnamDate();

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const yesterday = new Date(now.getTime());
  yesterday.setDate(yesterday.getDate() - 1);

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  if (isSameDay(d, now)) {
    return `Hôm nay · ${timeStr}`;
  }
  if (isSameDay(d, yesterday)) {
    return `Hôm qua · ${timeStr}`;
  }

  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${day}/${month} · ${timeStr}`;
}

export interface PeriodTargetSpec {
  year: number;
  month?: number;   // 1..12
  quarter?: number; // 1..4
}

// Kiểm tra giao dịch có nằm trong tháng, quý, hoặc năm đang chọn (tính theo giờ Việt Nam UTC+7)
export function isTxnInPeriod(
  isoDate: string | undefined,
  periodType: 'month' | 'quarter' | 'year',
  offsetOrTarget: number | Date | PeriodTargetSpec = 0
): boolean {
  const parsed = parseIsoOrSqliteUtc(isoDate);
  if (!parsed) return false;

  const txnVN = getVietnamDate(parsed);
  const txnYear = txnVN.getFullYear();
  const txnMonth1Based = txnVN.getMonth() + 1;
  const txnQuarter1Based = Math.floor(txnVN.getMonth() / 3) + 1;

  // Trường hợp truyền trực tiếp { year, month, quarter } từ bộ lọc kỳ
  if (
    offsetOrTarget &&
    typeof offsetOrTarget === 'object' &&
    !(offsetOrTarget instanceof Date) &&
    'year' in offsetOrTarget
  ) {
    if (periodType === 'month') {
      return txnYear === offsetOrTarget.year && txnMonth1Based === (offsetOrTarget.month ?? 1);
    }
    if (periodType === 'quarter') {
      return txnYear === offsetOrTarget.year && txnQuarter1Based === (offsetOrTarget.quarter ?? 1);
    }
    return txnYear === offsetOrTarget.year;
  }

  let targetVN = getVietnamDate();
  if (offsetOrTarget instanceof Date) {
    // Nếu truyền Date đã là lịch local (VD: nowVN), lấy trực tiếp year/month mà không cộng chồng +7h lần 2
    targetVN = offsetOrTarget;
  } else if (typeof offsetOrTarget === 'number' && offsetOrTarget !== 0) {
    if (periodType === 'month') {
      targetVN.setMonth(targetVN.getMonth() + offsetOrTarget);
    } else if (periodType === 'quarter') {
      targetVN.setMonth(targetVN.getMonth() + offsetOrTarget * 3);
    } else {
      targetVN.setFullYear(targetVN.getFullYear() + offsetOrTarget);
    }
  }

  if (periodType === 'month') {
    return txnYear === targetVN.getFullYear() && txnVN.getMonth() === targetVN.getMonth();
  }
  if (periodType === 'quarter') {
    return (
      txnYear === targetVN.getFullYear() &&
      Math.floor(txnVN.getMonth() / 3) === Math.floor(targetVN.getMonth() / 3)
    );
  }
  if (periodType === 'year') {
    return txnYear === targetVN.getFullYear();
  }
  return true;
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
    d.setMonth(d.getMonth() + offset * 3);
    const quarter = Math.floor(d.getMonth() / 3) + 1;
    return `Quý ${quarter}/${d.getFullYear()}`;
  }
  if (periodType === 'year') {
    d.setFullYear(d.getFullYear() + offset);
    return `Năm ${d.getFullYear()}`;
  }
  return '';
}
