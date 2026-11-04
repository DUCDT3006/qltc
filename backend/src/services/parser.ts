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

export interface BankPattern {
  bankCode: string;
  packageNames: string[];
  parse: (title: string, body: string) => ParsedBankNotification | null;
}

// Hàm làm sạch chuỗi số tiền Việt Nam (ví dụ: "85,000", "25.000.000", "85000VND")
export function parseVndAmount(raw: string): number {
  const cleaned = raw.replace(/[^\d]/g, '');
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? 0 : parsed;
}

export const BANK_PATTERNS: BankPattern[] = [
  // 1. VIETCOMBANK (VCB)
  {
    bankCode: 'VCB',
    packageNames: ['com.VCB', 'com.vcb.digibank'],
    parse: (_title, body) => {
      // Ví dụ: "Số dư TK 0071...9821 -85,000VND lúc 04/11/2026 10:42. Số dư: 14,520,000VND. Ref MBVCB.784912.GRAB*TRIP"
      // Hoặc: "TK 0071... -85,000 VND luc 10:42... Ref..."
      const signMatch = body.match(/([+-])\s*([\d.,]+)\s*(?:VND|đ|d)/i);
      if (!signMatch) return null;

      const isIncome = signMatch[1] === '+';
      const amount = parseVndAmount(signMatch[2]);
      if (amount <= 0) return null;

      // Tìm số tài khoản (4 số cuối hoặc đoạn đầu)
      const accMatch = body.match(/TK\s*([0-9*.]+)/i);
      const rawAcc = accMatch ? accMatch[1] : '';
      const accountMask = rawAcc.replace(/[^\d]/g, '').slice(-4) || 'VCB';

      // Tìm số dư sau GD
      const balMatch = body.match(/(?:Số dư|SD|So du)[:\s]+([\d.,]+)\s*(?:VND|đ|d)/i);
      const balanceAfter = balMatch ? parseVndAmount(balMatch[1]) : undefined;

      // Tìm nội dung / Ref
      let description = 'Giao dịch VCB';
      const refMatch = body.match(/(?:Ref|ND|Nội dung|Noi dung)[:.\s]+(.*)$/i);
      if (refMatch) {
        description = refMatch[1].trim();
      }

      const extRefMatch = body.match(/(?:Ref|MBVCB\.)([a-zA-Z0-9]+)/i);
      const externalRef = extRefMatch ? extRefMatch[0] : undefined;

      return {
        bankCode: 'VCB',
        accountMask,
        type: isIncome ? 'income' : 'expense',
        amount,
        balanceAfter,
        occurredAt: new Date().toISOString(),
        description,
        externalRef,
        rawText: body
      };
    }
  },

  // 2. MB BANK
  {
    bankCode: 'MB',
    packageNames: ['com.mbmobile'],
    parse: (_title, body) => {
      // Ví dụ: "GD: +25,000,000VND vao 10:42 04/11. TK 034010... So du: 45,120,000VND. ND: CTY ABC THANH TOAN LUONG"
      const signMatch = body.match(/([+-])\s*([\d.,]+)\s*(?:VND|đ|d)/i);
      if (!signMatch) return null;

      const isIncome = signMatch[1] === '+';
      const amount = parseVndAmount(signMatch[2]);
      if (amount <= 0) return null;

      const accMatch = body.match(/TK\s*([0-9*.]+)/i);
      const rawAcc = accMatch ? accMatch[1] : '';
      const accountMask = rawAcc.replace(/[^\d]/g, '').slice(-4) || 'MB';

      const balMatch = body.match(/(?:So du|Số dư)[:\s]+([\d.,]+)\s*(?:VND|đ|d)/i);
      const balanceAfter = balMatch ? parseVndAmount(balMatch[1]) : undefined;

      let description = 'Giao dịch MB Bank';
      const ndMatch = body.match(/(?:ND|Nội dung|Noi dung)[:\s]+(.*)$/i);
      if (ndMatch) {
        description = ndMatch[1].trim();
      }

      return {
        bankCode: 'MB',
        accountMask,
        type: isIncome ? 'income' : 'expense',
        amount,
        balanceAfter,
        occurredAt: new Date().toISOString(),
        description,
        rawText: body
      };
    }
  },

  // 3. TECHCOMBANK (TCB)
  {
    bankCode: 'TCB',
    packageNames: ['vn.com.techcombank.bb.app'],
    parse: (_title, body) => {
      // Ví dụ: "TK 190... -350,000 VND vao 10:42 04/11. So du: 2,150,000 VND. ND: SHOPEE*ORDER"
      const signMatch = body.match(/([+-])\s*([\d.,]+)\s*(?:VND|đ|d)/i);
      if (!signMatch) return null;

      const isIncome = signMatch[1] === '+';
      const amount = parseVndAmount(signMatch[2]);
      if (amount <= 0) return null;

      const accMatch = body.match(/TK\s*([0-9*.]+)/i);
      const rawAcc = accMatch ? accMatch[1] : '';
      const accountMask = rawAcc.replace(/[^\d]/g, '').slice(-4) || 'TCB';

      const balMatch = body.match(/(?:So du|Số dư)[:\s]+([\d.,]+)/i);
      const balanceAfter = balMatch ? parseVndAmount(balMatch[1]) : undefined;

      let description = 'Giao dịch Techcombank';
      const ndMatch = body.match(/(?:ND|Nội dung|Noi dung)[:\s]+(.*)$/i);
      if (ndMatch) {
        description = ndMatch[1].trim();
      }

      return {
        bankCode: 'TCB',
        accountMask,
        type: isIncome ? 'income' : 'expense',
        amount,
        balanceAfter,
        occurredAt: new Date().toISOString(),
        description,
        rawText: body
      };
    }
  },

  // 4. ACB
  {
    bankCode: 'ACB',
    packageNames: ['mobile.acb.com.vn'],
    parse: (_title, body) => {
      // Ví dụ: "ACB: TK 219... GD -5,000,000 VND luc 10:42 04/11/2026. So du: 8,400,000 VND. ND: Chuyen sang TCB 8812"
      const signMatch = body.match(/([+-])\s*([\d.,]+)\s*(?:VND|đ|d)/i);
      if (!signMatch) return null;

      const isIncome = signMatch[1] === '+';
      const amount = parseVndAmount(signMatch[2]);
      if (amount <= 0) return null;

      const accMatch = body.match(/TK\s*([0-9*.]+)/i);
      const rawAcc = accMatch ? accMatch[1] : '';
      const accountMask = rawAcc.replace(/[^\d]/g, '').slice(-4) || 'ACB';

      const balMatch = body.match(/(?:So du|Số dư)[:\s]+([\d.,]+)/i);
      const balanceAfter = balMatch ? parseVndAmount(balMatch[1]) : undefined;

      let description = 'Giao dịch ACB';
      const ndMatch = body.match(/(?:ND|Nội dung|Noi dung)[:\s]+(.*)$/i);
      if (ndMatch) {
        description = ndMatch[1].trim();
      }

      return {
        bankCode: 'ACB',
        accountMask,
        type: isIncome ? 'income' : 'expense',
        amount,
        balanceAfter,
        occurredAt: new Date().toISOString(),
        description,
        rawText: body
      };
    }
  },

  // 5. TPBANK, VPBANK, BIDV, VIETINBANK (Mẫu chung biến động số dư)
  {
    bankCode: 'GENERIC',
    packageNames: ['*'],
    parse: (title, body) => {
      // Tìm dấu +/- và số tiền VND
      const combined = `${title} ${body}`;
      const signMatch = combined.match(/([+-])\s*([\d.,]+)\s*(?:VND|đ|d)/i);
      if (!signMatch) return null;

      const isIncome = signMatch[1] === '+';
      const amount = parseVndAmount(signMatch[2]);
      if (amount <= 0) return null;

      const accMatch = combined.match(/TK\s*([0-9*.]+)/i);
      const rawAcc = accMatch ? accMatch[1] : '';
      const accountMask = rawAcc.replace(/[^\d]/g, '').slice(-4) || 'BANK';

      const balMatch = combined.match(/(?:So du|Số dư|SD)[:\s]+([\d.,]+)/i);
      const balanceAfter = balMatch ? parseVndAmount(balMatch[1]) : undefined;

      let description = title || 'Biến động số dư ngân hàng';
      const ndMatch = combined.match(/(?:ND|Nội dung|Noi dung|Ref)[:\s]+(.*)$/i);
      if (ndMatch) {
        description = ndMatch[1].trim();
      }

      return {
        bankCode: 'BANK',
        accountMask,
        type: isIncome ? 'income' : 'expense',
        amount,
        balanceAfter,
        occurredAt: new Date().toISOString(),
        description,
        rawText: body
      };
    }
  }
];

export function parseBankNotification(packageName: string, title: string, body: string): ParsedBankNotification | null {
  // Lọc bỏ mã xác thực OTP (tuyệt đối không ghi nhận OTP)
  if (/OTP|mã xác nhận|ma xac nhan|ma xac thuc/i.test(body) || /OTP/i.test(title)) {
    return null;
  }

  // 1. Thử tìm parser theo packageName chính xác
  for (const pattern of BANK_PATTERNS) {
    if (pattern.packageNames.includes(packageName)) {
      const result = pattern.parse(title, body);
      if (result) return result;
    }
  }

  // 2. Thử parser chung nếu chưa khớp
  const generic = BANK_PATTERNS.find(p => p.bankCode === 'GENERIC');
  if (generic) {
    return generic.parse(title, body);
  }

  return null;
}
