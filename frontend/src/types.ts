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
