export type TabType = 'dashboard' | 'transactions' | 'budget' | 'investments';

export type AssetClass = 'fund' | 'stock' | 'crypto' | 'gold' | 'silver' | 'land';

export interface Jar {
  id: string;
  code: string;
  name: string;
  targetPercent: number;
  monthlyLimit: number;
  spentThisMonth: number;
  color: string;
}

export interface BankAccount {
  id: string;
  name: string;
  bankCode?: string;
  accountNumberMask?: string;
  balance: number;
  type: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto';
}

export interface IncomeSource {
  id: string;
  name: string;
  kind: 'fixed' | 'irregular' | 'passive';
  expectedAmount: number;
  recurrence: string;
  color?: string;
}

export const RECURRENCE_PRESETS: Array<{ value: string; label: string; divisor: number; hint: string }> = [
  { value: 'Hàng tháng', label: 'Hàng tháng', divisor: 1, hint: 'Nhận đều mỗi tháng' },
  { value: 'Hàng quý', label: 'Hàng quý (3 tháng/lần)', divisor: 3, hint: 'Tự động chia 3 cho hàng tháng' },
  { value: 'Hàng năm', label: 'Hàng năm (12 tháng/lần)', divisor: 12, hint: 'Tự động chia 12 cho hàng tháng' },
  { value: 'Nửa năm (6 tháng)', label: 'Nửa năm (6 tháng/lần)', divisor: 6, hint: 'Tự động chia 6 cho hàng tháng' },
  { value: 'Hàng tuần', label: 'Hàng tuần', divisor: 12 / 52, hint: 'Quy đổi 4.33 tuần/tháng' }
];

export function getMonthlyIncomeAmount(amount: number, recurrence?: string): number {
  if (!amount || amount <= 0) return 0;
  const rec = (recurrence || '').toLowerCase().trim();
  if (rec.includes('năm') || rec.includes('year')) {
    return Math.round(amount / 12);
  }
  if (rec.includes('quý') || rec.includes('quarter')) {
    return Math.round(amount / 3);
  }
  if (rec.includes('6 tháng') || rec.includes('nửa năm') || rec.includes('semiannual')) {
    return Math.round(amount / 6);
  }
  if (rec.includes('tuần') || rec.includes('week')) {
    return Math.round((amount * 52) / 12);
  }
  return amount; // Mặc định Hàng tháng
}

export interface PlannedExpense {
  id: string;
  name: string;
  jarCode: string;
  expectedAmount: number;
  recurrence: string;
  note?: string;
}

export interface Transaction {
  id: string;
  bankCode: string;
  accountMask: string;
  accountName: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description: string;
  rawQuote?: string;
  suggestedCategory: string;
  suggestedJarCode: string;
  occurredAt: string;
  occurredAtIso?: string;
  status: 'pending' | 'confirmed' | 'rejected';
  transferPairId?: string | null;
  pairedTxnId?: string | null;
  pairedAccountName?: string | null;
  pairedBankCode?: string | null;
  pairedAccountMask?: string | null;
  pairedType?: string | null;
}

export interface Holding {
  id?: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unit: string;
  priceUpdatedAt?: string;
  source?: string;
}

export interface FmarketFund {
  shortName: string;
  name: string;
  nav: number;
  issuer?: string;
  updatedAt?: number;
}

export interface UserProfile {
  id?: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string | null;
}
