// Bank Notification Parser V2
// Tuân thủ đầy đủ đặc tả V2-04 và V2-05

export interface ParsedBankNotification {
  bankCode: string;
  accountMask: string;
  type: 'income' | 'expense';
  amount: number; // Số tiền nguyên VND
  balanceAfter?: number;
  occurredAt: string; // ISO UTC string
  description: string;
  externalRef?: string;
  rawText: string;
  parserVersion: 'v2';
  parseStatus: 'success' | 'ambiguous' | 'failed';
  reasonCode?: string;
}

// Chuẩn hóa Unicode: dấu trừ Unicode U+2212 (MINUS SIGN) thành ASCII hyphen '-', khoảng trắng không ngắt
export function normalizeNotificationText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\u2212/g, '-') // Unicode minus sign
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ') // Non-breaking spaces
    .trim();
}

// Lọc bỏ OTP khỏi văn bản (tránh lưu OTP vào DB và log)
export function redactOtp(text: string): string {
  if (!text) return '';
  return text
    .replace(/(?:OTP|mã xác nhận|ma xac nhan|ma xac thuc|mã kích hoạt|ma kich hoat)[\s:]*([0-9A-Za-z]{4,8})/gi, '[OTP_REDACTED]')
    .replace(/\b\d{6}\b(?=.*(?:OTP|xác nhận|xac nhan|kich hoat))/gi, '[OTP_REDACTED]');
}

// Kiểm tra có phải tin nhắn chứa mã OTP không
export function isOtpNotification(text: string): boolean {
  return /OTP|mã xác nhận|ma xac nhan|ma xac thuc|mã kích hoạt|ma kich hoat|ma OTP/i.test(text);
}

// Làm sạch và chuyển chuỗi tiền VND thành số nguyên an toàn
export function parseVndAmount(raw: string): number {
  if (!raw) return 0;
  let str = raw.trim();

  // Loại bỏ phần thập phân .00 hoặc ,00 ở cuối chuỗi tiền tệ (tránh nhân 100 lần)
  str = str.replace(/([,\d]+)\.00(?!\d)/, '$1').replace(/([.\d]+),00(?!\d)/, '$1');
  // Nếu có dạng 150,000.50 -> làm tròn
  str = str.replace(/([,\d]+)\.\d{1,2}(?!\d)/, '$1').replace(/([.\d]+),\d{1,2}(?!\d)/, '$1');

  const cleaned = str.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  if (isNaN(parsed) || !isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  return parsed;
}

// Nhận diện mã ngân hàng từ packageName hoặc text
export function detectBankCode(packageName: string, text: string): string {
  const lowerPkg = (packageName || '').toLowerCase();
  const upperText = (text || '').toUpperCase();

  if (lowerPkg.includes('vcb') || upperText.includes('VIETCOMBANK')) return 'VCB';
  if (lowerPkg.includes('techcombank') || upperText.includes('TECHCOMBANK') || upperText.includes('TCB')) return 'TCB';
  if (lowerPkg.includes('hdbank') || upperText.includes('HDBANK') || upperText.includes('HDB')) return 'HDBank';
  if (lowerPkg.includes('mbmobile') || upperText.includes('MBBANK') || upperText.includes('MB BANK')) return 'MB';
  if (lowerPkg.includes('acb') || upperText.includes('ACB')) return 'ACB';
  if (lowerPkg.includes('tpb') || upperText.includes('TPBANK')) return 'TPBank';
  if (lowerPkg.includes('vpbank') || upperText.includes('VPBANK')) return 'VPBank';
  if (lowerPkg.includes('bidv') || upperText.includes('BIDV')) return 'BIDV';
  if (lowerPkg.includes('vietinbank') || upperText.includes('VIETINBANK') || upperText.includes('IPAY')) return 'VietinBank';
  if (lowerPkg.includes('msb') || upperText.includes('MSB')) return 'MSB';
  if (lowerPkg.includes('shb') || upperText.includes('SHB')) return 'SHB';
  if (lowerPkg.includes('ocb') || upperText.includes('OCB')) return 'OCB';
  if (lowerPkg.includes('vib') || upperText.includes('VIB')) return 'VIB';
  if (lowerPkg.includes('sacombank') || upperText.includes('SACOMBANK')) return 'Sacombank';
  if (lowerPkg.includes('cake') || upperText.includes('CAKE')) return 'CAKE';
  if (lowerPkg.includes('timo') || upperText.includes('TIMO')) return 'TIMO';
  if (lowerPkg.includes('momotransfer') || upperText.includes('MOMO')) return 'MOMO';
  if (lowerPkg.includes('zalopay') || upperText.includes('ZALOPAY')) return 'ZALOPAY';
  if (lowerPkg.includes('viettelmoney') || upperText.includes('VIETTEL MONEY')) return 'VIETTELPAY';
  if (upperText.includes('AGRIBANK') || upperText.includes('VBA')) return 'Agribank';

  return 'BANK';
}

export function parseBankNotification(
  packageName: string,
  title: string,
  body: string,
  occurredAtOverride?: string | number
): ParsedBankNotification | null {
  const normTitle = normalizeNotificationText(title);
  const normBody = normalizeNotificationText(body);
  const fullText = `${normTitle}\n${normBody}`.trim();

  // 1. Tuyệt đối loại bỏ tin nhắn OTP / mã xác nhận bảo mật (V2-04)
  if (isOtpNotification(fullText)) {
    return null;
  }

  // 2. Lọc bỏ cuộc gọi / tin nhắn cá nhân Zalo không phải biến động tài chính
  if (packageName.includes('zing.zalo')) {
    if (!/số dư|so du|giao dịch|giao dich|thanh toán|thanh toan|biến động|bien dong/i.test(fullText)) {
      return null;
    }
  }

  // 3. Phải có dấu hiệu biến động số dư hoặc tài khoản
  const hasAccountOrBalance =
    /(?:TK|Tài khoản|Tai khoan|Số TK|So TK|Thẻ|The)\s*[:.\s#]*[0-9*xX.]/i.test(fullText) ||
    /(?:Số dư|So du|SD|Kha dung|Khả dụng)/i.test(fullText) ||
    /(?:biến động|bien dong|giao dịch|giao dich|GD:)/i.test(fullText) ||
    /(?:thanh toán|chuyển tiền|nhận tiền|cộng tiền|trừ tiền)/i.test(fullText);

  // Chuẩn bị trường ngày: Tạm thời thay thế các ngày định dạng DD-MM-YYYY hoặc DD/MM/YYYY
  // để tránh việc dấu '-' trong ngày (ví dụ 08-11-2026) bị bắt nhầm thành dấu trừ chi tiêu!
  const textWithoutDateHyphens = fullText.replace(/(\d{1,2})-(\d{1,2})-(\d{2,4})/g, '$1_$2_$3');

  let type: 'income' | 'expense' | null = null;
  let amount = 0;
  const foundCandidates: { type: 'income' | 'expense'; amount: number }[] = [];

  // Cách A: Tìm trong Title trước (ví dụ Techcombank: "+ VND 65,000" hoặc "- VND 150,000")
  const titleSignMatch = normTitle.match(/([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i) ||
                         normTitle.match(/(?:VND|VNĐ|đ|d)?\s*([\d.,]+)\s*([+-])/i);
  if (titleSignMatch) {
    const sign = titleSignMatch[1] === '+' || titleSignMatch[2] === '+' ? '+' : '-';
    const rawAmt = titleSignMatch[1] === '+' || titleSignMatch[1] === '-' ? titleSignMatch[2] : titleSignMatch[1];
    const parsed = parseVndAmount(rawAmt);
    if (parsed > 0) {
      type = sign === '+' ? 'income' : 'expense';
      amount = parsed;
      foundCandidates.push({ type, amount });
    }
  }

  // Cách B: Tìm dòng độc lập có dấu +/- (ví dụ HDBank: "-2,000,000" hoặc "+500,000")
  if (!type || amount <= 0) {
    const lines = normBody.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const standaloneMatch = trimmed.match(/^([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)\s*(?:VND|VNĐ|đ|d)?$/i);
      if (standaloneMatch) {
        type = standaloneMatch[1] === '+' ? 'income' : 'expense';
        amount = parseVndAmount(standaloneMatch[2]);
        foundCandidates.push({ type, amount });
        break;
      }
    }
  }

  // Cách C: Tìm dấu [+-] đi kèm số tiền trong toàn bộ body (loại trừ phần Số dư / SD)
  if (!type || amount <= 0) {
    // Tách bỏ phần Số dư phía sau nếu có để tránh nhầm
    const withoutBal = textWithoutDateHyphens.replace(/(?:Số dư|So du|SD|Kha dung|Khả dụng)[:\s]+(?:VND|VNĐ|đ|d)?\s*[\d.,]+/gi, '');
    const bodySignMatch = withoutBal.match(/([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i) ||
                          withoutBal.match(/([\d.,]+)\s*(?:VND|VNĐ|đ|d)?\s*([+-])/i);
    if (bodySignMatch) {
      const sign = bodySignMatch[1] === '+' || bodySignMatch[2] === '+' ? '+' : '-';
      const rawAmt = bodySignMatch[1] === '+' || bodySignMatch[1] === '-' ? bodySignMatch[2] : bodySignMatch[1];
      const parsed = parseVndAmount(rawAmt);
      if (parsed > 0) {
        type = sign === '+' ? 'income' : 'expense';
        amount = parsed;
        foundCandidates.push({ type, amount });
      }
    }
  }

  // Cách D: Tìm qua từ khóa tiếng Việt (nhận tiền, cộng tiền, thanh toán, trừ tiền - hỗ trợ cả không dấu)
  if (!type || amount <= 0) {
    const incomeWord = textWithoutDateHyphens.match(/(?:nhận|nhan|cộng|cong|nạp|nap|chuyển đến|chuyen den|hoàn tiền|hoan tien|tăng|tang)\s+(?:thành công\s+|thanh cong\s+)?(?:tiền\s+|tien\s+)?(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
    if (incomeWord) {
      const parsed = parseVndAmount(incomeWord[1]);
      if (parsed > 0) {
        type = 'income';
        amount = parsed;
        foundCandidates.push({ type, amount });
      }
    } else {
      const expenseWord = textWithoutDateHyphens.match(/(?:chi|thanh toán|thanh toan|trừ|tru|chuyển đi|chuyen di|rút|rut|phí|phi)\s+(?:thành công\s+|thanh cong\s+)?(?:tiền\s+|tien\s+)?(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
      if (expenseWord) {
        const parsed = parseVndAmount(expenseWord[1]);
        if (parsed > 0) {
          type = 'expense';
          amount = parsed;
          foundCandidates.push({ type, amount });
        }
      }
    }
  }

  // Nếu không trích xuất được số tiền hoặc không có cấu trúc tài khoản/số dư -> Bỏ qua
  if (!type || amount <= 0 || !hasAccountOrBalance) {
    return null;
  }

  // 5. Trích xuất mã ngân hàng
  const bankCode = detectBankCode(packageName, fullText);

  // 6. Trích xuất số đuôi tài khoản (accountMask)
  let accountMask = bankCode;
  const accMatch = fullText.match(/(?:Tài khoản|Tai khoan|Số TK|So TK|TK|Thẻ|The)\s*(?:VCB|TCB|MB|HDBank|BIDV|ACB)?\s*[:.\s#]*([0-9*xX.]+[\d]+)/i);
  if (accMatch) {
    const rawAcc = accMatch[1].replace(/[^\d]/g, '');
    if (rawAcc.length >= 4) {
      accountMask = rawAcc.slice(-4);
    } else if (rawAcc.length > 0) {
      accountMask = rawAcc;
    }
  }

  // 7. Trích xuất số dư sau biến động (balanceAfter).
  // ĐẶC TẢ V2-04: Nhận balanceAfter = 0 (số dư = 0 là giá trị hợp lệ!)
  let balanceAfter: number | undefined;
  const balMatch = fullText.match(/(?:Số dư|So du|SD|Kha dung|Khả dụng|Số dư khả dụng)\s*[:.\s]*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
  if (balMatch) {
    const rawBal = balMatch[1].trim();
    if (rawBal === '0' || rawBal === '0.00' || rawBal === '0,00') {
      balanceAfter = 0;
    } else {
      const b = parseVndAmount(rawBal);
      if (b >= 0) balanceAfter = b;
    }
  }

  // 8. Trích xuất nội dung / mô tả giao dịch (description)
  let description = '';
  const ndPrefixMatch = fullText.match(/(?:^|\n|\s)(?:Nội dung|Noi dung|Ref|Lý do|Ly do|(?<!V)ND)[:.\s]+(.*)$/im);
  if (ndPrefixMatch && ndPrefixMatch[1].trim().length > 0) {
    description = ndPrefixMatch[1].trim();
  } else {
    const lines = normBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    for (const line of lines) {
      const isAccountLine = /^(?:Tài khoản|Tai khoan|Số TK|So TK|TK|Thẻ|The)/i.test(line);
      const isBalanceLine = /^(?:Số dư|So du|SD|Kha dung|Khả dụng)/i.test(line);
      const isDateLine = /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(line);
      const isStandaloneAmount = /^([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)\s*(?:VND|VNĐ|đ|d)?$/i.test(line);

      if (!isAccountLine && !isBalanceLine && !isDateLine && !isStandaloneAmount) {
        description = line;
        break;
      }
    }
  }

  if (!description) {
    description = normTitle && !normTitle.includes('+') && !normTitle.includes('-')
      ? normTitle
      : `Giao dịch ${bankCode} *${accountMask}`;
  }

  // Rút gọn Ref nếu có
  const extRefMatch = fullText.match(/(?:Ref|ID|Mã GD|Ma GD)[:.\s]*([a-zA-Z0-9.*]+)/i);
  const externalRef = extRefMatch ? extRefMatch[1] : undefined;

  // Chuẩn hóa thời gian occurredAt (V2-05)
  let finalOccurredAt = new Date().toISOString();
  if (occurredAtOverride) {
    if (typeof occurredAtOverride === 'number') {
      // Milliseconds epoch từ Android
      finalOccurredAt = new Date(occurredAtOverride).toISOString();
    } else if (typeof occurredAtOverride === 'string') {
      const parsedNum = Number(occurredAtOverride);
      if (!isNaN(parsedNum) && parsedNum > 100000000000) {
        finalOccurredAt = new Date(parsedNum).toISOString();
      } else {
        const d = new Date(occurredAtOverride);
        if (!isNaN(d.getTime())) {
          finalOccurredAt = d.toISOString();
        }
      }
    }
  }

  // Tránh lưu OTP vào rawText
  const redactedRaw = redactOtp(fullText);

  return {
    bankCode,
    accountMask,
    type,
    amount,
    balanceAfter,
    occurredAt: finalOccurredAt,
    description: redactOtp(description),
    externalRef,
    rawText: redactedRaw,
    parserVersion: 'v2',
    parseStatus: 'success'
  };
}
