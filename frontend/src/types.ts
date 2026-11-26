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
  isDefault?: boolean;
  isActive?: boolean;
  revision?: number;
}

export interface BankAccount {
  id: string;
  name: string;
  bankCode?: string;
  bankName?: string;
  accountNumberMask?: string;
  accountNumber?: string;
  accountHolder?: string;
  branch?: string;
  bankBin?: string;
  balance: number;
  currency?: string;
  type: 'bank' | 'cash' | 'ewallet' | 'securities' | 'crypto' | 'savings';
  isActive?: boolean;
  archivedAt?: string | null;
  includeInNetWorth?: boolean;
  revision?: number;
}

export interface IncomeSource {
  id: string;
  name: string;
  kind?: 'fixed' | 'irregular' | 'passive';
  expectedAmount?: number;
  recurrence?: string;
  cadence?: string;
  oneTimeDate?: string | null;
  effectiveFromMonth?: string;
  color?: string;
  keywords?: string;
  revision?: number;
}

export const RECURRENCE_PRESETS: Array<{ value: string; label: string; divisor: number; hint: string }> = [
  { value: 'Hàng tháng', label: 'Hàng tháng', divisor: 1, hint: 'Nhận đều mỗi tháng' },
  { value: 'Hàng quý', label: 'Hàng quý (3 tháng/lần)', divisor: 3, hint: 'Tự động chia 3 cho hàng tháng' },
  { value: 'Hàng năm', label: 'Hàng năm (12 tháng/lần)', divisor: 12, hint: 'Tự động chia 12 cho hàng tháng' },
  { value: 'Nửa năm (6 tháng)', label: 'Nửa năm (6 tháng/lần)', divisor: 6, hint: 'Tự động chia 6 cho hàng tháng' },
  { value: 'Hàng tuần', label: 'Hàng tuần', divisor: 12 / 52, hint: 'Quy đổi 4.33 tuần/tháng' },
  { value: 'Một lần', label: 'Một lần (có ngày cụ thể)', divisor: 1, hint: 'Chỉ tính vào đúng tháng diễn ra' }
];

export function getMonthlyIncomeAmount(amount?: number, recurrence?: string, oneTimeDate?: string | null, targetMonth?: string): number {
  if (!amount || amount <= 0) return 0;
  const rec = (recurrence || '').toLowerCase().trim();
  if (rec.includes('một lần') || rec.includes('one_time')) {
    if (!targetMonth) return amount;
    if (oneTimeDate && oneTimeDate.startsWith(targetMonth)) return amount;
    return 0;
  }
  if (rec.includes('năm') || rec.includes('year') || rec.includes('annual')) {
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
  return amount;
}

export function normalizeToMonthlyAmount(amount?: number, recurrence?: string, oneTimeDate?: string | null, targetMonth?: string): number {
  return getMonthlyIncomeAmount(amount, recurrence, oneTimeDate, targetMonth);
}

export interface PlannedExpense {
  id: string;
  name: string;
  jarCode: string;
  jarId?: string;
  expectedAmount: number;
  recurrence: string;
  cadence?: string;
  oneTimeDate?: string | null;
  effectiveFromMonth?: string;
  note?: string;
  revision?: number;
}

export type CashFlowType = 'income' | 'expense';

export interface TransactionApproval {
  type?: CashFlowType;
  accountId?: string;
  jarId?: string;
  jarCode?: string;
  incomeSourceId?: string;
  categoryName?: string;
  note?: string;
}

export interface FundPurchaseLink {
  symbol: string;
  holdingId: string;
  quantity: number | null;
  unitPrice: number | null;
  alreadyRecorded: boolean;
}

export interface BankFundPurchaseRequest {
  symbol: string;
  type: 'expense';
  accountId: string;
  quantity: number | null;
  unitPrice: number | null;
  expectedTransactionRevision: number;
  expectedHoldingRevision: number | null;
  operationId: string;
  alreadyRecorded: boolean;
  confirmAmountDifference: boolean;
  note?: string;
}

export interface Transaction {
  id: string;
  accountId?: string;
  bankCode: string;
  accountMask: string;
  accountName: string;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description: string;
  note?: string;
  source?: string;
  debtPaymentId?: string | null;
  rawQuote?: string;
  suggestedCategory: string;
  suggestedJarCode: string;
  jarId?: string;
  toAccountId?: string;
  toAccountName?: string;
  incomeSourceId?: string;
  incomeSourceName?: string;
  originalType?: 'income' | 'expense';
  balanceAfter?: number;
  confidence?: number;
  occurredAt: string;
  occurredAtIso?: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'paired_hidden' | 'draft';
  needsAccountReview?: boolean;
  review?: { type: CashFlowType | null; accountId: string | null; bankCode: string | null };
  fundPurchase?: FundPurchaseLink;
  parseStatus?: string;
  suggestedPairId?: string | null;
  transferPairId?: string | null;
  pairedTxnId?: string | null;
  pairedAccountName?: string | null;
  pairedBankCode?: string | null;
  pairedAccountMask?: string | null;
  pairedType?: string | null;
  revision?: number;
  operationId?: string;
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
  quoteUnit?: string;
  provider?: string;
  priceUpdatedAt?: string;
  priceAsOf?: string;
  syncStatus?: 'ok' | 'stale';
  source?: string;
  autoSync?: boolean;
  costBasisVnd?: number;
  marketValueVnd?: number;
  unrealizedPnlVnd?: number;
  simpleRoiPct?: number | null;
  revision?: number;
  landDetails?: LandDetails | null;
}

export interface LandPosition { lat: number; lng: number }
export interface LandValuation {
  source: 'dulieu.dev';
  kind: 'asking';
  surveyedAt: string;
  newestSampleOn: string | null;
  radiusKm: number;
  sampleCount: number;
  lowPerM2: number;
  medianPerM2: number;
  highPerM2: number;
  scope?: 'ward' | 'district';
  locationLabel?: string;
}
export interface LandDetails extends LandPosition {
  address: string;
  parcel: string;
  landUse: 'residential' | 'agricultural' | 'mixed' | null;
  access: 'frontage' | 'alley' | null;
  valuation: LandValuation | null;
}
export interface LandComparison {
  title: string;
  area: number;
  perM2: number;
  distanceM: number | null;
  source: string;
  observedOn: string | null;
  url: string | null;
}
export interface LandSurvey {
  valuation: LandValuation | null;
  sampleCount: number;
  scope?: 'ward' | 'district';
  locationLabel?: string;
  comparisons: LandComparison[];
  reference?: { scope: 'ward' | 'district'; locationLabel: string; comparisons: LandComparison[] };
}

export type DebtKind = 'payable' | 'receivable';
export interface Debt {
  id: string;
  name: string;
  creditor: string;
  kind?: DebtKind;
  principal_vnd: number;
  charges_vnd: number;
  due_on: string | null;
  due_vnd: number;
  collateral_holding_id: string | null;
  has_payment_history: number;
  revision: number;
}
export interface DebtPayment {
  id: string;
  debt_id: string;
  account_id: string | null;
  account_name: string | null;
  principal_vnd: number;
  charges_vnd: number;
  debt_revision_after: number;
  account_revision_after: number;
  occurred_at: string;
  note?: string | null;
}
export interface DebtSnapshot { debts: Debt[]; payments: DebtPayment[] }
export interface LoanReceiptDraft { transaction: Transaction; note?: string }

export interface FundPurchaseRequest {
  quantity: number;
  unitPrice: number;
  expectedRevision: number;
  operationId: string;
}

export interface InvestmentTransaction {
  id: string;
  assetId: string;
  symbol?: string;
  assetName?: string;
  accountId?: string | null;
  type: 'buy' | 'sell' | 'dividend' | 'interest' | 'fee' | 'tax';
  occurredAt: string;
  quantity: number;
  unitPrice: number;
  fee: number;
  tax: number;
  totalAmountVnd: number;
  linkedTransactionId?: string | null;
  note?: string;
}

export interface FmarketFund {
  shortName: string;
  name: string;
  nav: number | null;
  navDate?: string;
  issuer?: string;
  updatedAt?: number;
  stale?: boolean;
  navAvailable?: boolean;
}

export interface InvestmentCashflow {
  id: string;
  type: 'contribution' | 'withdrawal';
  amountVnd: number;
  occurredAt: string;
  note?: string | null;
}

export interface InvestmentXirrResult {
  rate: number | null;
  annualizedPct: number | null;
  reasonCode?: string | null;
  message?: string | null;
  terminalValueVnd?: number | null;
  valuationDate?: string | null;
  priceAsOfOldest?: string | null;
}

export interface InvestmentCashflowsResponse {
  cashflows: InvestmentCashflow[];
  historyCompleteFrom: string | null;
  xirr: InvestmentXirrResult | null;
}

export interface UserProfile {
  id?: string;
  name: string;
  email: string;
  phone?: string | null;
  avatar?: string | null;
}
