import { ParsedTransaction } from '../types';

const EMAIL_PACKAGES = new Set([
  'com.google.android.gm',
  'com.samsung.android.email.provider',
  'com.microsoft.office.outlook',
  'com.android.email'
]);
const FMARKET_APP_PACKAGE = 'com.fincorp.fmarket';

export function isFmarketEmailNotification(appPackage: string, title: string, text: string): boolean {
  if (!EMAIL_PACKAGES.has(appPackage.trim().toLowerCase())) return false;
  // A bank can mention Fmarket in a payment memo. Look for the sender or subject instead.
  return /\bfmarket\b/i.test(title) || /@(?:[a-z0-9-]+\.)*fmarket\.vn\b/i.test(text);
}

const BANK_PACKAGES: Record<string, string> = {
  'com.vcb': 'VCB',
  'com.vietcombank': 'VCB',
  'vn.com.techcombank.bb.app': 'TCB',
  'com.techcombank': 'TCB',
  'com.mbmobile': 'MB',
  'com.vnpay.bidv': 'BIDV',
  'com.vietinbank.ipay': 'CTG',
  'com.acb': 'ACB',
  'com.tpb.mb.gprsandroid': 'TPB',
  'com.vnpay.vpbankonline': 'VPB',
  'com.mservice.momotransfer': 'MOMO',
  'vn.zalopay': 'ZALOPAY',
  'com.sacombank.ewallet': 'STB',
  'com.shinhan.global.vn.bank': 'SHBVN',
  'com.vib.myvib2': 'VIB',
  'com.hdbank.mobilebanking': 'HDB',
  'com.vnpay.hdbank': 'HDB',
  'com.vnpay.coopbank': 'COOPBANK'
};

const BANK_KEYWORDS: Record<string, string> = {
  'VIETCOMBANK': 'VCB',
  'VCB': 'VCB',
  'VCBDIGIBANK': 'VCB',
  'TECHCOMBANK': 'TCB',
  'TCB': 'TCB',
  'MBBANK': 'MB',
  'MB': 'MB',
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
  'HDB': 'HDB',
  'COOPBANK': 'COOPBANK',
  'CO-OPBANK': 'COOPBANK',
  'CO-OP BANK': 'COOPBANK',
  'CO OP BANK': 'COOPBANK',
  'NGAN HANG HOP TAC XA VIET NAM': 'COOPBANK',
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
const BANK_NAME = new RegExp(
  `(?<![a-z0-9])(?:${Object.keys(BANK_KEYWORDS).sort((a, b) => b.length - a.length).join('|')})(?![a-z0-9])`,
  'gi'
);
const ACCOUNT_REFERENCE = /\b(?:(tu|vao|den|toi|ve|tru)\s+)?(?:so\s+(?:tai khoan|tk)|stk|tk|tai khoan|the)\b(?:\s+(nguoi\s+(?:gui|nhan)|thu huong|nhan|dich|gui|chuyen|nguon))?\s*[:#]?\s*([\d*x•]{4,24})(?![\d*x•]|[.,]\d)/gi;
const MONEY = String.raw`(?:\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d{1,15})(?!\d|[.,]\d)`;
const CURRENCY = String.raw`(?:vnd|₫|dong|d)(?![a-z0-9])`;
const PREFIXED_CURRENCY_MONEY = new RegExp(String.raw`(?<![a-z0-9])(${CURRENCY})\s*(${MONEY})`, 'gi');
const FMARKET_CONFIRMED_BUY = new RegExp(String.raw`\blenh mua\s*:?\s*(${MONEY})\s*${CURRENCY}\s+quy\s+([a-z0-9][a-z0-9._-]{0,23})\s+da (?:duoc )?xac nhan\b`, 'g');
const BALANCE = new RegExp(String.raw`\b(sd\s*(?:tt|kd)?|so du)\b(?!\s*(?:tk|tai khoan)\b)(?:\s+(truoc|sau|cuoi|kha dung|thuc te|con lai|hien tai)(?:\s+(?:giao dich|gd))?)?\s*[:=]?\s*([+-]?)\s*(${MONEY})(?:\s*${CURRENCY})?`, 'gi');
const SIGNED_MONEY = new RegExp(String.raw`(?:^|[\s:=;(])([+-])\s*(${MONEY})(?=\s*(?:${CURRENCY}|[.,;()\[]|$)|\s+[a-z])`, 'gi');
const LABELLED_MONEY = new RegExp(String.raw`\b(?:p\s*/\s*s|ps|phat sinh(?:\s+(?:co|no))?|so tien(?:\s+giao dich)?|gd|bien dong|tien vao|tien ra|thanh toan|nhan tien|ghi co|ghi no)\s*[:=]?\s*([+-]?)\s*(${MONEY})(?:\s*${CURRENCY})?`, 'i');
const CURRENCY_MONEY = new RegExp(String.raw`(?:^|[^\d.,])(${MONEY})\s*${CURRENCY}`, 'i');
const INCOMING = /\b(?:bao co|ghi co|tien vao|nhan (?:duoc )?tien|nhan duoc|chuyen den|chuyen vao|cong (?:tien|vao)|hoan tien|phat sinh co|tang so du|credited|incoming transfer|received)\b/;
const OUTGOING = /\b(?:bao no|ghi no|tien ra|bi tru|tru (?:tien|tu)|thanh toan|chuyen (?:tien )?di|rut tien|phat sinh no|giam so du|debited|outgoing transfer)\b/;

function fold(text: string): string {
  return normalizeNotificationText(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/đ/g, 'd');
}

function parseFmarketPurchase(title: string, text: string, occurredAtOverride?: string | number): ParsedTransaction | null {
  const header = fold(title);
  const body = fold(text);
  const message = body.includes(header) ? body : header.includes(body) ? header : `${header} ${body}`;
  if (/\b(?:huy|that bai|tu choi|chua thanh toan|cho thanh toan|hoan tien)\b/.test(message)) return null;

  const matches = [...message.matchAll(FMARKET_CONFIRMED_BUY)];
  if (matches.length !== 1) return null;
  const [, amountText, fund] = matches[0];
  const amount = parseVndAmountString(amountText);
  if (!amount) return null;

  const externalRef = /\bma lenh\s*[:#]\s*([a-z0-9][a-z0-9-]{3,39})\b/.exec(message)?.[1];
  const { occurredAt, timeSource } = canonicalizeOccurredAt(occurredAtOverride);
  return {
    type: 'expense', amount, bankCode: 'FMARKET', occurredAt, timeSource, externalRef,
    description: `Fmarket · Lệnh mua quỹ ${fund.toUpperCase()} đã được xác nhận`,
    parseStatus: 'parsed'
  };
}

function singleBankIn(text: string): string | undefined {
  const banks = new Set(Array.from(text.matchAll(BANK_NAME), match => BANK_KEYWORDS[match[0].toUpperCase()]));
  return banks.size === 1 ? banks.values().next().value : undefined;
}

function readAccountReference(details: string, direction: ParsedTransaction['type'] | null) {
  const references = Array.from(details.matchAll(ACCOUNT_REFERENCE), ([, prefix, role, number]) => ({
    number,
    side: /nhan|thu huong|dich/.test(role || '') || /^(vao|den|toi|ve)$/.test(prefix || '')
      ? 'income'
      : /gui|chuyen|nguon/.test(role || '') || /^(tu|tru)$/.test(prefix || '') ? 'expense' : null
  })).filter(ref => /\d{3,}$/.test(ref.number));
  const directional = direction ? references.filter(ref => ref.side === direction) : [];
  const candidates = directional.length ? directional : references.filter(ref => ref.side === null);
  const numbers = [...new Set(candidates.map(ref => ref.number))];
  const number = numbers.length === 1 ? numbers[0] : undefined;
  return {
    accountNumber: number && /^\d{6,}$/.test(number) ? number : undefined,
    accountNumberMask: number?.match(/\d{3,4}$/)?.[0],
    ambiguous: numbers.length > 1 || (!number && references.length > 0)
  };
}

/**
 * Normalizes text before parsing: NFC, Unicode minus -> '-', non-breaking spaces -> ' '
 */
export function normalizeNotificationText(input: string): string {
  if (!input) return '';
  return input
    .normalize('NFC')
    .replace(UNICODE_MINUS_REGEX, '-')
    .replace(/\uFF0B/g, '+')
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
  if (isOtpNotification(title, text) || isFmarketEmailNotification(appPackage, title, text)) {
    return null;
  }
  const sourcePackage = appPackage.trim().toLowerCase();
  if (sourcePackage === FMARKET_APP_PACKAGE) return parseFmarketPurchase(title, text, occurredAtOverride);

  const fullText = normalizeNotificationText(`${title} ${text}`);

  // The bank of the app or notification header outranks banks mentioned by the sender.
  const header = fold(title);
  const details = fold(text).split(/\b(?:nd|noi dung|ly do|loi nhan|mo ta)\s*(?:[:=]|\s)/, 1)[0];
  const bankCode = BANK_PACKAGES[sourcePackage] || singleBankIn(header) || singleBankIn(details) || 'UNKNOWN';

  let balanceAfter: number | undefined;
  let balanceBefore: number | undefined;
  let explicitBalanceAfter: number | undefined;
  const textForAmount = (header + ' ' + details)
    .replace(PREFIXED_CURRENCY_MONEY, '$2 $1')
    .replace(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/g, ' ')
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g, ' ')
    .replace(/\bbien dong so du\b/g, 'bien dong')
    .replace(BALANCE, (_match, _label, qualifier, sign, value) => {
      const parsedBalance = parseVndAmountString(value);
      if (parsedBalance !== null) {
        const balance = sign === '-' ? -parsedBalance : parsedBalance;
        if (qualifier === 'truoc') balanceBefore = balance;
        else if (qualifier === 'sau') explicitBalanceAfter = balance;
        else if (balanceAfter === undefined) balanceAfter = balance;
      }
      return ' ';
    })
    .replace(ACCOUNT_REFERENCE, ' ');
  balanceAfter = explicitBalanceAfter ?? balanceAfter;

  const signed = Array.from(textForAmount.matchAll(SIGNED_MONEY));
  const labelled = textForAmount.match(LABELLED_MONEY);
  const currency = textForAmount.match(CURRENCY_MONEY);
  const amount = parseVndAmountString(labelled?.[2] ?? signed[0]?.[2] ?? currency?.[1] ?? '');
  if (!amount) return null;

  const directions = new Set<ParsedTransaction['type']>();
  const signedValues = new Set<number>();
  for (const [, sign, value] of signed) {
    const signedAmount = parseVndAmountString(value);
    if (!signedAmount) continue;
    signedValues.add(signedAmount);
    if (signedAmount === amount) directions.add(sign === '+' ? 'income' : 'expense');
  }
  if (labelled?.[1]) directions.add(labelled[1] === '+' ? 'income' : 'expense');
  // The name in "Thông báo Co-opBank" is not a credit instruction.
  const directionText = (header + ' ' + details).replace(/\bco[\s-]*op\s*bank\b/g, ' ');
  if (INCOMING.test(directionText)) directions.add('income');
  if (OUTGOING.test(directionText)) directions.add('expense');
  if (balanceBefore !== undefined && explicitBalanceAfter !== undefined) {
    const delta = explicitBalanceAfter - balanceBefore;
    if (Math.abs(delta) === amount) directions.add(delta > 0 ? 'income' : 'expense');
  }
  const multipleAmounts = signedValues.size > 1 || (signedValues.size === 1 && !signedValues.has(amount));
  const direction = !multipleAmounts && directions.size === 1 ? [...directions][0] : null;
  const account = readAccountReference(header + ' ' + details, direction);
  const fullFolded = fold(`${title} ${text}`);
  const isCarrierPromoSms =
    !BANK_PACKAGES[sourcePackage] &&
    bankCode === 'UNKNOWN' &&
    signed.length === 0 &&
    !labelled &&
    balanceAfter === undefined &&
    balanceBefore === undefined &&
    directions.size === 0 &&
    !account.accountNumber &&
    !account.accountNumberMask &&
    /\b(?:tu choi qc|tu choi quang cao|soan\s+(?:dk|huy)\b[^\n]{0,40}\bgui\s+\d{3,5}|gia han\s+[\d.,]+\s*(?:vnd|d)\/thang)\b/.test(fullFolded);
  if (isCarrierPromoSms) {
    return null;
  }
  const reasonCode = multipleAmounts ? 'MULTIPLE_AMOUNTS'
    : directions.size > 1 ? 'CONFLICTING_DIRECTION'
    : direction === null ? 'DIRECTION_UNKNOWN'
    : account.ambiguous ? 'AMBIGUOUS_ACCOUNT' : undefined;

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
    // Keep the existing storage type while requiring explicit review for an uncertain direction.
    type: direction ?? 'expense',
    needsTypeReview: direction === null,
    amount,
    accountNumber: account.accountNumber,
    accountNumberMask: account.accountNumberMask,
    accountReferenceAmbiguous: account.ambiguous,
    bankCode,
    occurredAt,
    timeSource,
    description,
    balanceAfter,
    externalRef,
    parseStatus: reasonCode ? 'ambiguous' : 'parsed',
    reasonCode
  };
}
