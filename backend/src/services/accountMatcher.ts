// Account matching logic according to V2-03
// Aliases chuẩn hóa, khớp theo thứ tự ưu tiên, cờ needs_account_review

export interface BankAccountCandidate {
  id: string;
  name: string;
  bankCode?: string | null;
  accountNumber?: string | null;
  accountNumberMask?: string | null;
  isActive?: number;
}

export interface AccountMatchResult {
  accountId: string | null;
  confidence: number;
  needsAccountReview: boolean;
  matchMethod: 'full_number' | 'bank_mask' | 'single_bank_candidate' | 'none';
  reason?: string;
}

// Bảng ánh xạ alias chuẩn hóa mã ngân hàng Việt Nam
export const BANK_ALIASES: Record<string, string> = {
  'VCB': 'VCB',
  'VIETCOMBANK': 'VCB',
  'TCB': 'TCB',
  'TECHCOMBANK': 'TCB',
  'MB': 'MB',
  'MBBANK': 'MB',
  'MB BANK': 'MB',
  'VPB': 'VPB',
  'VPBANK': 'VPB',
  'CAKE': 'VPB',
  'TPB': 'TPB',
  'TPBANK': 'TPB',
  'HDB': 'HDB',
  'HDBANK': 'HDB',
  'ICB': 'CTG',
  'CTG': 'CTG',
  'VIETINBANK': 'CTG',
  'BIDV': 'BIDV',
  'ACB': 'ACB',
  'MSB': 'MSB',
  'SHB': 'SHB',
  'OCB': 'OCB',
  'VIB': 'VIB',
  'STB': 'STB',
  'SACOMBANK': 'STB',
  'TIMO': 'TIMO',
  'MOMO': 'MOMO',
  'ZALOPAY': 'ZALOPAY',
  'VIETTELPAY': 'VIETTELPAY',
  'AGRIBANK': 'VBA',
  'VBA': 'VBA'
};

export function canonicalBankCode(bankCodeOrName: string): string {
  if (!bankCodeOrName) return 'BANK';
  const clean = bankCodeOrName.trim().toUpperCase();
  return BANK_ALIASES[clean] || clean;
}

export function matchAccountForNotification(
  detectedBankCode: string,
  accountMask: string | null,
  accounts: BankAccountCandidate[],
  fullAccountNumber?: string
): AccountMatchResult {
  const activeAccounts = accounts.filter(a => a.isActive !== 0 && (a as any).is_active !== 0);
  const canonBank = canonicalBankCode(detectedBankCode);

  // 1. Khớp số tài khoản đầy đủ + ngân hàng nếu có
  if (fullAccountNumber && fullAccountNumber.length >= 6) {
    const cleanFull = fullAccountNumber.replace(/[^\d]/g, '');
    const fullMatch = activeAccounts.find(a => {
      const aFull = (a.accountNumber || '').replace(/[^\d]/g, '');
      const aBank = canonicalBankCode(a.bankCode || '');
      return aFull === cleanFull && (canonBank === 'BANK' || aBank === canonBank);
    });
    if (fullMatch) {
      return {
        accountId: fullMatch.id,
        confidence: 1.0,
        needsAccountReview: false,
        matchMethod: 'full_number'
      };
    }
  }

  // 2. Khớp ngân hàng + số đuôi mask (ví dụ 4 số cuối)
  const cleanMask = (accountMask || '').replace(/[^\d]/g, '');
  if (cleanMask.length >= 3) {
    const maskCandidates = activeAccounts.filter(a => {
      const aBank = canonicalBankCode(a.bankCode || '');
      const aFull = (a.accountNumber || '').replace(/[^\d]/g, '');
      const aMask = (a.accountNumberMask || '').replace(/[^\d]/g, '');

      const bankMatches = canonBank === 'BANK' || aBank === canonBank;
      const maskMatches = aMask.endsWith(cleanMask) || aFull.endsWith(cleanMask);
      return bankMatches && maskMatches;
    });

    if (maskCandidates.length === 1) {
      return {
        accountId: maskCandidates[0].id,
        confidence: 0.95,
        needsAccountReview: false,
        matchMethod: 'bank_mask'
      };
    } else if (maskCandidates.length > 1) {
      // Có nhiều tài khoản cùng số đuôi trong cùng ngân hàng -> Cần xác nhận, không đoán bừa!
      return {
        accountId: null,
        confidence: 0.5,
        needsAccountReview: true,
        matchMethod: 'none',
        reason: `Có ${maskCandidates.length} tài khoản có cùng số đuôi ${cleanMask}`
      };
    }
  }

  // 3. Nếu chỉ biết ngân hàng: CHỈ nhận khi có ĐÚNG 1 tài khoản duy nhất của ngân hàng đó
  if (canonBank !== 'BANK') {
    const bankCandidates = activeAccounts.filter(a => canonicalBankCode(a.bankCode || '') === canonBank);
    if (bankCandidates.length === 1) {
      return {
        accountId: bankCandidates[0].id,
        confidence: 0.8,
        needsAccountReview: false,
        matchMethod: 'single_bank_candidate'
      };
    } else if (bankCandidates.length > 1) {
      // Nhiều tài khoản cùng ngân hàng -> Buộc người dùng chọn
      return {
        accountId: null,
        confidence: 0.3,
        needsAccountReview: true,
        matchMethod: 'none',
        reason: `Có ${bankCandidates.length} tài khoản thuộc ngân hàng ${canonBank}, cần người dùng chọn tài khoản`
      };
    }
  }

  // Không khớp được
  return {
    accountId: null,
    confidence: 0,
    needsAccountReview: true,
    matchMethod: 'none',
    reason: 'Không tìm thấy tài khoản ngân hàng tương ứng'
  };
}
