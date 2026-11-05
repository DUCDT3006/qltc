export interface ParsedBankNotification {
  bankCode: string;
  accountMask: string;
  type: 'income' | 'expense';
  amount: number; // Số tiền nguyên VND
  balanceAfter?: number;
  occurredAt: string; // ISO string
  description: string;
  externalRef?: string;
  rawText: string;
}

// Hàm làm sạch chuỗi số tiền Việt Nam (ví dụ: "85,000", "25.000.000", "85000VND")
export function parseVndAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
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
  body: string
): ParsedBankNotification | null {
  const cleanTitle = (title || '').trim();
  const cleanBody = (body || '').trim();
  const fullText = `${cleanTitle}\n${cleanBody}`;

  // 1. Tuyệt đối loại bỏ tin nhắn OTP / mã xác nhận bảo mật
  if (/OTP|mã xác nhận|ma xac nhan|ma xac thuc|mã kích hoạt|ma kich hoat/i.test(fullText)) {
    return null;
  }

  // 2. Lọc bỏ cuộc gọi / tin nhắn cá nhân hoặc Zalo không phải ngân hàng
  if (packageName.includes('zing.zalo')) {
    if (!/số dư|so du|giao dịch|giao dich|thanh toán|thanh toan|biến động|bien dong/i.test(fullText)) {
      return null;
    }
  }

  // 3. Phải có dấu hiệu biến động số dư hoặc tài khoản
  const hasAccountOrBalance =
    /(?:TK|Tài khoản|Tai khoan|Số TK|So TK|Thẻ|The)\s*[:.\s#]*[0-9*xX.]/i.test(fullText) ||
    /(?:Số dư|So du|SD|Kha dung|Khả dụng)/i.test(fullText) ||
    /(?:biến động|bien dong|giao dịch|giao dich|GD:)/i.test(fullText);

  // 4. Trích xuất loại giao dịch (income / expense) và số tiền
  let type: 'income' | 'expense' | null = null;
  let amount = 0;

  // Cách A: Tìm trong Title trước (ví dụ Techcombank: "+ VND 65,000" hoặc "- VND 150,000")
  const titleSignMatch = cleanTitle.match(/([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i) ||
                         cleanTitle.match(/(?:VND|VNĐ|đ|d)?\s*([\d.,]+)\s*([+-])/i);
  if (titleSignMatch) {
    const sign = titleSignMatch[1] === '+' || titleSignMatch[2] === '+' ? '+' : '-';
    const rawAmt = titleSignMatch[1] === '+' || titleSignMatch[1] === '-' ? titleSignMatch[2] : titleSignMatch[1];
    const parsed = parseVndAmount(rawAmt);
    if (parsed > 0) {
      type = sign === '+' ? 'income' : 'expense';
      amount = parsed;
    }
  }

  // Cách B: Tìm dòng độc lập có dấu +/- (ví dụ HDBank: dòng riêng "-2,000,000" hoặc "-65,000")
  if (!type || amount <= 0) {
    const lines = cleanBody.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      const standaloneMatch = trimmed.match(/^([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)\s*(?:VND|VNĐ|đ|d)?$/i);
      if (standaloneMatch) {
        type = standaloneMatch[1] === '+' ? 'income' : 'expense';
        amount = parseVndAmount(standaloneMatch[2]);
        break;
      }
    }
  }

  // Cách C: Tìm dấu [+-] đi kèm số tiền trong toàn bộ body (loại trừ phần Số dư / SD)
  if (!type || amount <= 0) {
    // Tách bỏ phần Số dư phía sau nếu có để tránh nhầm
    const withoutBal = cleanBody.replace(/(?:Số dư|So du|SD|Kha dung|Khả dụng)[:\s]+(?:VND|VNĐ|đ|d)?\s*[\d.,]+/gi, '');
    const bodySignMatch = withoutBal.match(/([+-])\s*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i) ||
                          withoutBal.match(/([\d.,]+)\s*(?:VND|VNĐ|đ|d)?\s*([+-])/i);
    if (bodySignMatch) {
      const sign = bodySignMatch[1] === '+' || bodySignMatch[2] === '+' ? '+' : '-';
      const rawAmt = bodySignMatch[1] === '+' || bodySignMatch[1] === '-' ? bodySignMatch[2] : bodySignMatch[1];
      const parsed = parseVndAmount(rawAmt);
      if (parsed > 0) {
        type = sign === '+' ? 'income' : 'expense';
        amount = parsed;
      }
    }
  }

  // Cách D: Tìm qua từ khóa tiếng Việt (nhận tiền, cộng tiền, thanh toán, trừ tiền)
  if (!type || amount <= 0) {
    const incomeWord = fullText.match(/(?:nhận|cộng|nạp|chuyển đến|hoàn tiền|tăng)\s+(?:thành công\s+)?(?:tiền\s+)?(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
    if (incomeWord) {
      const parsed = parseVndAmount(incomeWord[1]);
      if (parsed > 0) {
        type = 'income';
        amount = parsed;
      }
    } else {
      const expenseWord = fullText.match(/(?:chi|thanh toán|trừ|chuyển đi|rút|phí)\s+(?:thành công\s+)?(?:tiền\s+)?(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
      if (expenseWord) {
        const parsed = parseVndAmount(expenseWord[1]);
        if (parsed > 0) {
          type = 'expense';
          amount = parsed;
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

  // 7. Trích xuất số dư sau biến động (balanceAfter)
  let balanceAfter: number | undefined;
  const balMatch = fullText.match(/(?:Số dư|So du|SD|Kha dung|Khả dụng|Số dư khả dụng)\s*[:.\s]*(?:VND|VNĐ|đ|d)?\s*([\d.,]+)/i);
  if (balMatch) {
    const b = parseVndAmount(balMatch[1]);
    if (b > 0) balanceAfter = b;
  }

  // 8. Trích xuất nội dung / mô tả giao dịch (description)
  let description = '';

  // Ưu tiên dòng có tiền tố ND / Nội dung / Ref / Lý do (tránh nhầm chữ ND trong VND)
  const ndPrefixMatch = fullText.match(/(?:^|\n|\s)(?:Nội dung|Noi dung|Ref|Lý do|Ly do|(?<!V)ND)[:.\s]+(.*)$/im);
  if (ndPrefixMatch && ndPrefixMatch[1].trim().length > 0) {
    description = ndPrefixMatch[1].trim();
  } else {
    // Nếu không có tiền tố ND, tìm dòng văn bản trong body (ví dụ Techcombank: dòng 3 là nội dung)
    const lines = cleanBody.split('\n').map(l => l.trim()).filter(l => l.length > 0);
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
    description = cleanTitle && !cleanTitle.includes('+') && !cleanTitle.includes('-')
      ? cleanTitle
      : `Giao dịch ${bankCode} *${accountMask}`;
  }

  // Rút gọn Ref nếu có
  const extRefMatch = fullText.match(/(?:Ref|ID|Mã GD|Ma GD)[:.\s]*([a-zA-Z0-9.*]+)/i);
  const externalRef = extRefMatch ? extRefMatch[1] : undefined;

  return {
    bankCode,
    accountMask,
    type,
    amount,
    balanceAfter,
    occurredAt: new Date().toISOString(),
    description,
    externalRef,
    rawText: fullText
  };
}
