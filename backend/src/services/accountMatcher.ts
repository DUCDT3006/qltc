// Account matching logic according to V2-03
// Aliases chuẩn hóa, khớp theo thứ tự ưu tiên, cờ needs_account_review

import type { ParsedTransaction } from '../types';

export interface BankAccountCandidate {
  id: string;
  name: string;
  type?: string;
  bankCode?: string | null;
  bank_code?: string | null;
  bankName?: string | null;
  bank_name?: string | null;
  accountNumber?: string | null;
  account_number?: string | null;
  accountNumberMask?: string | null;
  account_number_mask?: string | null;
  aliases_json?: string | null;
  isActive?: number;
  is_active?: number;
}

export type AccountCandidate = BankAccountCandidate;

export interface AccountMatchResult {
  accountId: string | null;
  confidence: number;
  needsAccountReview: boolean;
  matchMethod: 'full_number' | 'bank_mask' | 'single_bank_candidate' | 'none';
  reason?: string;
  reasonCode?: string;
}

export const BANK_ALIASES: Record<string, string> = {
  VCB: 'VCB',
  VIETCOMBANK: 'VCB',
  TCB: 'TCB',
  TECHCOMBANK: 'TCB',
  MB: 'MB',
  MBBANK: 'MB',
  'MB BANK': 'MB',
  VPB: 'VPB',
  VPBANK: 'VPB',
  CAKE: 'VPB',
  TPB: 'TPB',
  TPBANK: 'TPB',
  HDB: 'HDB',
  HDBANK: 'HDB',
  COOPBANK: 'COOPBANK',
  ICB: 'CTG',
  CTG: 'CTG',
  VIETINBANK: 'CTG',
  BIDV: 'BIDV',
  ACB: 'ACB',
  MSB: 'MSB',
  SHB: 'SHB',
  OCB: 'OCB',
  VIB: 'VIB',
  STB: 'STB',
  SACOMBANK: 'STB',
  TIMO: 'TIMO',
  MOMO: 'MOMO',
  ZALOPAY: 'ZALOPAY',
  VIETTELPAY: 'VIETTELPAY',
  AGRIBANK: 'VBA',
  VBA: 'VBA'
};

export function canonicalBankCode(bankCodeOrName: string): string {
  const clean = bankCodeOrName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/Đ/g, 'D').replace(/[^A-Z0-9]/g, '');
  if (!clean || clean === 'UNKNOWN') return 'BANK';
  return BANK_ALIASES[clean] || clean;
}

/**
 * Supports both calling conventions:
 * 1) matchAccountForNotification('VCB', '2222', accounts, fullAccountNumber)
 * 2) matchAccountForNotification(accounts, parsedTx, title, text)
 */
export function matchAccountForNotification(
  arg1: string | BankAccountCandidate[],
  arg2?: string | null | ParsedTransaction,
  arg3?: BankAccountCandidate[] | string,
  arg4?: string
): AccountMatchResult {
  let detectedBankCode = 'BANK';
  let accountMask: string | null = null;
  let accounts: BankAccountCandidate[] = [];
  let fullAccountNumber: string | undefined = undefined;

  if (Array.isArray(arg1)) {
    accounts = arg1;
    const parsed = arg2 as ParsedTransaction | undefined;
    if (parsed?.accountReferenceAmbiguous) {
      return { accountId: null, confidence: 0, needsAccountReview: true, matchMethod: 'none', reasonCode: 'AMBIGUOUS_ACCOUNT' };
    }
    detectedBankCode = parsed?.bankCode || 'BANK';
    accountMask = parsed?.accountNumberMask || null;
    fullAccountNumber = parsed?.accountNumber;
  } else {
    detectedBankCode = arg1 || 'BANK';
    accountMask = (arg2 as string | null) || null;
    accounts = Array.isArray(arg3) ? arg3 : [];
    fullAccountNumber = arg4;
  }

  const activeAccounts = accounts.filter((a) => a.id !== 'acc_unassigned' && a.isActive !== 0 && a.is_active !== 0);
  const canonBank = canonicalBankCode(detectedBankCode);
  if (canonBank === 'FMARKET') {
    return { accountId: null, confidence: 0, needsAccountReview: true, matchMethod: 'none', reasonCode: 'FMARKET_ACCOUNT_REQUIRED' };
  }

  const getBank = (a: BankAccountCandidate) => canonicalBankCode(a.bankCode || a.bank_code || a.bankName || a.bank_name || '');
  const getFull = (a: BankAccountCandidate) => (a.accountNumber || a.account_number || '').replace(/[^\d]/g, '');
  const getMask = (a: BankAccountCandidate) => (a.accountNumberMask || a.account_number_mask || '').replace(/[^\d]/g, '');

  const cleanFull = fullAccountNumber?.replace(/\D/g, '') || '';
  const hasFullNumber = cleanFull.length >= 6;
  const bankMatches = (account: BankAccountCandidate) => canonBank === 'BANK' || getBank(account) === 'BANK' || getBank(account) === canonBank;
  if (hasFullNumber) {
    const fullMatches = activeAccounts.filter(account => getFull(account) === cleanFull && bankMatches(account));
    if (fullMatches.length === 1) {
      return {
        accountId: fullMatches[0].id,
        confidence: 1.0,
        needsAccountReview: false,
        matchMethod: 'full_number'
      };
    }
    if (fullMatches.length > 1) return { accountId: null, confidence: 0, needsAccountReview: true, matchMethod: 'none', reasonCode: 'AMBIGUOUS_FULL_NUMBER' };
  }

  // 2. Khớp ngân hàng + số đuôi mask (ví dụ 4 số cuối)
  const cleanMask = (accountMask || (hasFullNumber ? cleanFull.slice(-4) : '')).replace(/[^\d]/g, '');
  if (cleanMask.length >= 3) {
    const maskCandidates = activeAccounts.filter((a) => {
      const aFull = getFull(a);
      const aMask = getMask(a);
      // Do not accept a matching suffix when a known complete number contradicts it.
      if (hasFullNumber && (aFull || canonBank === 'BANK' || getBank(a) !== canonBank)) return false;
      const maskMatches =
        (aMask.length >= 3 && aMask.endsWith(cleanMask)) || (aFull.length >= 4 && aFull.endsWith(cleanMask));
      return bankMatches(a) && maskMatches;
    });

    if (maskCandidates.length === 1) {
      return {
        accountId: maskCandidates[0].id,
        confidence: 0.95,
        needsAccountReview: false,
        matchMethod: 'bank_mask'
      };
    } else if (maskCandidates.length > 1) {
      return {
        accountId: null,
        confidence: 0.5,
        needsAccountReview: true,
        matchMethod: 'none',
        reason: `Có ${maskCandidates.length} tài khoản có cùng số đuôi ${cleanMask}`,
        reasonCode: 'AMBIGUOUS_MASK'
      };
    }
  }

  if (hasFullNumber || cleanMask.length >= 3) {
    return { accountId: null, confidence: 0, needsAccountReview: true, matchMethod: 'none', reasonCode: 'ACCOUNT_NUMBER_MISMATCH' };
  }

  // 3. Nếu chỉ biết ngân hàng: CHỈ nhận khi có ĐÚNG 1 tài khoản duy nhất của ngân hàng đó (và không có mask xung đột)
  if (canonBank !== 'BANK') {
    const bankCandidates = activeAccounts.filter((a) => getBank(a) === canonBank);
    if (bankCandidates.length === 1) {
      const singleAcc = bankCandidates[0];
      return {
        accountId: singleAcc.id,
        confidence: 0.8,
        needsAccountReview: false,
        matchMethod: 'single_bank_candidate'
      };
    } else if (bankCandidates.length > 1) {
      return {
        accountId: null,
        confidence: 0.3,
        needsAccountReview: true,
        matchMethod: 'none',
        reason: `Có ${bankCandidates.length} tài khoản thuộc ngân hàng ${canonBank}, cần người dùng chọn tài khoản`,
        reasonCode: 'MULTIPLE_BANK_ACCOUNTS'
      };
    }
  }

  return {
    accountId: null,
    confidence: 0,
    needsAccountReview: true,
    matchMethod: 'none',
    reason: 'Không tìm thấy tài khoản ngân hàng tương ứng',
    reasonCode: 'NO_ACCOUNT_MATCH'
  };
}
