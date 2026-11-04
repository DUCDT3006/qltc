export type TabType = 'dashboard' | 'transactions' | 'budget' | 'investments';

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
  status: 'pending' | 'confirmed' | 'rejected';
}

export interface Holding {
  symbol: string;
  name: string;
  assetClass: 'stock' | 'fund' | 'crypto' | 'gold';
  quantity: number;
  avgCost: number;
  currentPrice: number;
  unit: string;
}
