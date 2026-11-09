import { ParsedTransaction } from '../types';

const BANK_PACKAGES: Record<string, string> = {
  'com.VCB': 'VCB',
  'com.vietcombank': 'VCB',
  'vn.com.techcombank.bb.app': 'TCB',
  'com.techcombank': 'TCB',
  'com.mbmobile': 'MB',
  'com.vnpay.bidv': 'BIDV',
  'com.vietinbank.ipay': 'CTG',
  'com.ACB': 'ACB',
  'com.tpb.mb.gprsandroid': 'TPB',
  'com.vnpay.vpbankonline': 'VPB',
  'com.mservice.momotransfer': 'MOMO',
  'vn.zalopay': 'ZALOPAY',
  'com.Sacombank.ewallet': 'STB',
  'com.shinhan.global.vn.bank': 'SHBVN',
  'com.vib.myvib2': 'VIB',
  'com.hdbank.mobilebanking': 'HDB'
};

const BANK_KEYWORDS: Record<string, string> = {
  'VIETCOMBANK': 'VCB',
  'VCB': 'VCB',
  'VCBDIGIBANK': 'VCB',
  'TECHCOMBANK': 'TCB',
  'TCB': 'TCB',
  'MBBANK': 'MB',
  'MB BANK': 'MB',
  'QUAN DOI': 'MB',
  'BIDV': 'BIDV',
  'SMARTBANKING': 'BIDV',
  'VIETINBANK': 'CTG',
  'CTG': 'CTG',
  'IPAY': 'CTG',
  'ACB': 'ACB',
  'TPBANK': 'TPB',
  'TPB': 'TPB',
  'VPBANK': 'VPB',
  'VPB': 'VPB',
  'MOMO': 'MOMO',
  'ZALOPAY': 'ZALOPAY',
  'SACOMBANK': 'STB',
  'STB': 'STB',
  'VIB': 'VIB',
  'HDBANK': 'HDB',
  'AGRIBANK': 'VBA',
  'LPBANK': 'LPB',
  'SEABANK': 'SSB',
  'MSB': 'MSB',
  'OCB': 'OCB',
  'SHB': 'SHB',
  'EXIMBANK': 'EIB'
};

const UNICODE_MINUS_REGEX = /[\u2212\u2013\u2014\uFE63\uFF0D]/g;
const UNICODE_SPACES_REGEX = /[\u00A0\u202F\u2007\u2009]/g;

/**
 * Normalizes text before parsing: NFC, Unicode minus -> '-', non-breaking spaces -> ' '
 */
export function normalizeNotificationText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFC')
    .replace(UNICODE_MINUS_REGEX, '-')
    .replace(UNICODE_SPACES_REGEX, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if notification is an OTP / authentication message that must not be ingested as transaction.
 */
export function isOtpNotification(title: string, text: string): boolean {
  const full = normalizeNotificationText(`${title} ${text}`).toLowerCase();
  const hasOtpKeyword = /(?:mã\s*otp|ma\s*otp|\botp\b|smart\s*otp|mã\s*xác\s*thực|ma\s*xac\s*thuc|xác\s*thực\s*giao\s*dịch|verification\s*code|passcode|mã\s*bảo\s*mật)/i.test(full);
  const hasBalanceChange = /(?:số\s*dư|so\s*du|\bsd\b|\btk\b.*[+-]\s*\d)/i.test(full);
  return hasOtpKeyword && !hasBalanceChange;
}

/**
 * Redacts sensitive OTP codes before storing raw notification logs.
 */
export function redactOtp(text: string): string {
  if (!text) return text;
  return text.replace(/(?:OTP|mã xác thực|ma xac thuc|code|passcode)([^0-9]{0,15})(\d{4,8})/gi, 'OTP$1[OTP_REDACTED]');
}

/**
 * Parses a Vietnamese/International money string into integer VND.
 * Returns null if invalid or overflowing safe integer bounds.
 */
export function parseVndAmountString(rawNum: string): number | null {
  const cleaned = rawNum.trim();
  if (!cleaned) return null;

  // Check if decimal suffix exists, e.g., 1,250,000.00 or 1.250.000,00
  let integerPart = cleaned;
  const dotParts = cleaned.split('.');
  const commaParts = cleaned.split(',');

  if (dotParts.length === 2 && dotParts[1].length <= 2 && commaParts.length >= 2) {
    // Format: 1,250,000.00
    integerPart = dotParts[0];
  } else if (commaParts.length === 2 && commaParts[1].length <= 2 && dotParts.length >= 2) {
    // Format: 1.250.000,00
    integerPart = commaParts[0];
  } else if (dotParts.length === 2 && dotParts[1].length === 2 && dotParts[0].length <= 3) {
    // Ambiguous decimal or small number
    integerPart = dotParts[0];
  }

  const digitsOnly = integerPart.replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(digitsOnly)) return null;

  const val = Number(digitsOnly);
  if (!Number.isSafeInteger(val) || val < 0 || val > 10_000_000_000_000) {
    return null;
  }
  return val;
}

/**
 * Canonicalizes time input into UTC ISO string.
 * Rejects ambiguous 10-digit epoch seconds (1e9..1e10) unless passed as standard ISO string or epoch milliseconds (>= 1e11).
 */
export function canonicalizeOccurredAt(
  overrideValue?: string | number | null,
  extractedTimeStr?: string | null
): { occurredAt: string; timeSource: 'override' | 'notification_text' | 'server_received'; invalidOverride?: boolean } {
  if (overrideValue !== undefined && overrideValue !== null && overrideValue !== '') {
    if (typeof overrideValue === 'number') {
      if (!Number.isFinite(overrideValue) || overrideValue < 100_000_000_000) {
        return { occurredAt: new Date().toISOString(), timeSource: 'server_received', invalidOverride: true };
      }
      const d = new Date(overrideValue);
      if (!isNaN(d.getTime())) {
        return { occurredAt: d.toISOString(), timeSource: 'override' };
      }
      return { occurredAt: new Date().toISOString(), timeSource: 'server_received', invalidOverride: true };
    }

    const trimmed = String(overrideValue).trim();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      // Reject 10-digit epoch seconds (ambiguous ms vs s per V2-05 / AT2-11)
      if (!Number.isFinite(num) || trimmed.length < 12) {
        return { occurredAt: new Date().toISOString(), timeSource: 'server_received', invalidOverride: true };
      }
      const d = new Date(num);
      if (!isNaN(d.getTime())) {
        return { occurredAt: d.toISOString(), timeSource: 'override' };
      }
      return { occurredAt: new Date().toISOString(), timeSource: 'server_received', invalidOverride: true };
    }

    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      return { occurredAt: parsed.toISOString(), timeSource: 'override' };
    }
    return { occurredAt: new Date().toISOString(), timeSource: 'server_received', invalidOverride: true };
  }

  if (extractedTimeStr) {
    // Support DD/MM/YYYY HH:mm(:ss) or DD-MM-YYYY HH:mm(:ss) in Asia/Ho_Chi_Minh (+07:00)
    const m = extractedTimeStr.match(/(\d{2})[/-](\d{2})[/-](\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) {
      const [, dd, mm, yyyy, hh, min, ss = '00'] = m;
      const isoWithOffset = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+07:00`;
      const d = new Date(isoWithOffset);
      if (!isNaN(d.getTime())) {
        return { occurredAt: d.toISOString(), timeSource: 'notification_text' };
      }
    }
  }

  return { occurredAt: new Date().toISOString(), timeSource: 'server_received' };
}

export function parseBankNotification(
  appPackage: string,
  title: string,
  text: string,
  occurredAtOverride?: string | number
): ParsedTransaction | null {
  if (isOtpNotification(title, text)) {
    return null;
  }

  const fullText = normalizeNotificationText(`${title} ${text}`);

  // 1. Identify Bank Code
  let bankCode = BANK_PACKAGES[appPackage] || 'UNKNOWN';
  if (bankCode === 'UNKNOWN') {
    const upperText = fullText.toUpperCase();
    for (const [kw, code] of Object.entries(BANK_KEYWORDS)) {
      if (upperText.includes(kw)) {
        bankCode = code;
        break;
      }
    }
  }

  // Strip dates/times and phone/account patterns from amount candidate scanning
  const textWithoutDates = fullText
    .replace(/\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/g, ' [DATE] ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' [TIME] ');

  // Extract Balance After first so we can exclude its span from transaction amount matching
  let balanceAfter: number | undefined = undefined;
  const balanceRegex = /\b(?:SD|Số dư|So du|SD cuối|SD khả dụng|Số dư cuối)(?!\s*TK\b)[:\s]+(\d[\d.,]*)\s*(?:VND|đ|d|₫|VNĐ)?/i;
  const balanceMatch = textWithoutDates.match(balanceRegex);
  let textForAmount = textWithoutDates;
  if (balanceMatch && balanceMatch[1]) {
    const parsedBal = parseVndAmountString(balanceMatch[1].replace(/[+-]\s*/, ''));
    if (parsedBal !== null) {
      balanceAfter = parsedBal;
    }
    textForAmount = textWithoutDates.replace(balanceMatch[0], ' [BALANCE] ');
  }

  // Detect multiple conflicting signed/currency amounts in the notification (AT2-09)
  const allSignedCurrencyMatches = Array.from(
    textForAmount.matchAll(/([+-])\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,15})\s*(?:VND|đ|d|₫|VNĐ)?/gi)
  );
  const distinctSignedAmounts: { sign: string; val: number }[] = [];
  for (const m of allSignedCurrencyMatches) {
    const v = parseVndAmountString(m[2]);
    if (v !== null && v > 0) {
      if (!distinctSignedAmounts.some((x) => x.val === v && x.sign === m[1])) {
        distinctSignedAmounts.push({ sign: m[1], val: v });
      }
    }
  }

  let isAmbiguousAmount = false;
  if (distinctSignedAmounts.length >= 2) {
    // Two distinct signed amounts in the same message (outside of balance) -> ambiguous!
    isAmbiguousAmount = true;
  }

  // 2. Extract Amount & Type (Income vs Expense)
  let amount = 0;
  let type: 'income' | 'expense' = 'expense';

  const signedAmountRegex = /([+-])\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,15})\s*(?:VND|đ|d|₫|VNĐ)?/i;
  const keywordAmountRegex = /(?:PS|GD|Số tiền|So tien|Thanh toán|Thanh toan|Chuyển|Chuyen|Nhận|Nhan|Biến động|Bien dong)[:\s]*([+-]?)\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,15})\s*(?:VND|đ|d|₫|VNĐ)/i;
  const currencyAmountRegex = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{4,15})\s*(?:VND|đ|₫|VNĐ)\b/i;

  const signedMatch = textForAmount.match(signedAmountRegex);
  const keywordMatch = textForAmount.match(keywordAmountRegex);
  const currencyMatch = textForAmount.match(currencyAmountRegex);

  if (signedMatch) {
    const sign = signedMatch[1];
    const parsed = parseVndAmountString(signedMatch[2]);
    if (parsed !== null) {
      amount = parsed;
      type = sign === '+' ? 'income' : 'expense';
    }
  } else if (keywordMatch) {
    const sign = keywordMatch[1];
    const parsed = parseVndAmountString(keywordMatch[2]);
    if (parsed !== null) {
      amount = parsed;
      if (sign === '+') {
        type = 'income';
      } else if (sign === '-') {
        type = 'expense';
      } else {
        const lower = fullText.toLowerCase();
        type = /(?:nhận|nhan|cộng|cong| tiền vào|tien vao|hoàn tiền|hoan tien)/i.test(lower) ? 'income' : 'expense';
      }
    }
  } else if (currencyMatch) {
    const parsed = parseVndAmountString(currencyMatch[1]);
    if (parsed !== null) {
      amount = parsed;
      const lower = fullText.toLowerCase();
      type = /(?:nhận|nhan|cộng|cong|tiền vào|tien vao|hoàn tiền|hoan tien|\+)/i.test(lower) ? 'income' : 'expense';
    }
  }

  if (!amount || amount <= 0) {
    return null;
  }

  // 3. Extract Account Mask (Last 4 digits)
  let accountNumberMask: string | undefined = undefined;
  const accMatch = fullText.match(/(?:TK|Tài khoản|Tai khoan|Thẻ|The)[:\s]*[xX*0-9]*?(\d{4})\b/i);
  if (accMatch) {
    accountNumberMask = accMatch[1];
  }

  // 4. Extract Date/Time from notification text if present
  const dateTimeMatch = fullText.match(/\b(\d{2}[/-]\d{2}[/-]\d{4}\s+\d{2}:\d{2}(?::\d{2})?)\b/);
  const extractedTimeStr = dateTimeMatch ? dateTimeMatch[1] : null;
  const { occurredAt, timeSource } = canonicalizeOccurredAt(occurredAtOverride, extractedTimeStr);

  // 5. Extract Description / Content
  let description = fullText;
  const descMatch = fullText.match(/(?:ND|Nội dung|Noi dung|Lý do|Ly do|Lời nhắn|Loi nhan|GD|Mo ta)[:\s]+(.+?)(?:\.\s*SD|;\s*SD|\s+SD:|$)/i);
  if (descMatch && descMatch[1].trim().length > 2) {
    description = descMatch[1].trim();
  }

  // 6. Extract External Reference Code if present (FT..., MBVCB..., trace ID)
  let externalRef: string | undefined = undefined;
  const refMatch = fullText.match(/\b(FT\d{10,20}|MBVCB\.\d+|Trace[:\s]*\d{6,15}|Ref[:\s]*[A-Z0-9]{6,20})\b/i);
  if (refMatch) {
    externalRef = refMatch[1].replace(/^(?:Trace|Ref)[:\s]*/i, '').trim();
  }

  return {
    type,
    amount,
    accountNumberMask,
    bankCode,
    occurredAt,
    timeSource,
    description,
    balanceAfter,
    externalRef,
    parseStatus: isAmbiguousAmount ? 'ambiguous' : 'parsed',
    reasonCode: isAmbiguousAmount ? 'MULTIPLE_AMOUNTS' : undefined
  };
}
