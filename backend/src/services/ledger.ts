// Ledger Service V2
// Ghi sổ nguyên tử, hạch toán delta, chống lặp, phân bổ tỷ trọng lớn nhất (Largest Remainder)
// Tuân thủ V2-02, V2-09, V2-10, V2-11, V2-16, V2-17

import { CadenceType, MutationAck, PeriodContext } from '../types';

export interface TxnState {
  type: string; // 'income' | 'expense' | 'transfer' | 'invest'
  amount: number;
  status?: string;
  sourceAccountId: string;
  toAccountId?: string | null;
  isSynthetic?: boolean;
  isPairedHidden?: boolean;
  deletedAt?: string | null;
}

// 1. Định nghĩa toán học đóng góp của giao dịch C(txn, account)
export function getTxnContribution(txn: TxnState, targetAccountId: string): number {
  if (
    txn.deletedAt ||
    txn.status === 'pending' ||
    txn.status === 'rejected' ||
    txn.isPairedHidden
  ) {
    return 0;
  }

  if (txn.type === 'income') {
    return txn.sourceAccountId === targetAccountId ? txn.amount : 0;
  }

  if (txn.type === 'expense') {
    return txn.sourceAccountId === targetAccountId ? -txn.amount : 0;
  }

  if (txn.type === 'transfer') {
    let contrib = 0;
    if (txn.sourceAccountId === targetAccountId) {
      contrib -= txn.amount;
    }
    if (txn.toAccountId && txn.toAccountId === targetAccountId) {
      contrib += txn.amount;
    }
    return contrib;
  }

  return 0;
}

// 2. Tính Delta đóng góp số dư cho một tài khoản giữa trạng thái cũ và mới
// delta(account) = C(new, account) - C(old, account)
export function calculateBalanceDelta(
  oldState: TxnState | null,
  newState: TxnState | null,
  targetAccountId: string
): number {
  const oldContrib = oldState ? getTxnContribution(oldState, targetAccountId) : 0;
  const newContrib = newState ? getTxnContribution(newState, targetAccountId) : 0;
  return newContrib - oldContrib;
}

// 3. Thuật toán Largest Remainder Method (Phân bổ tỷ trọng chính xác từng đồng VND - V2-17)
export interface AllocationItemInput {
  id: string;
  weightBps: number; // Điểm cơ bản (10000 bps = 100%)
  sortOrder?: number;
}

export interface AllocationItemOutput {
  id: string;
  allocatedVnd: number;
}

export function allocateVndLargestRemainder(
  totalVnd: number,
  items: AllocationItemInput[]
): AllocationItemOutput[] {
  if (items.length === 0) return [];
  if (totalVnd === 0) {
    return items.map(it => ({ id: it.id, allocatedVnd: 0 }));
  }

  const totalWeight = items.reduce((sum, it) => sum + it.weightBps, 0);
  if (totalWeight <= 0) {
    return items.map(it => ({ id: it.id, allocatedVnd: 0 }));
  }

  // Bước 1: Tính quota và phần nguyên floor
  const withQuotas = items.map(item => {
    const rawQuota = (totalVnd * item.weightBps) / totalWeight;
    const floorAmount = Math.floor(rawQuota);
    const remainder = rawQuota - floorAmount;
    return {
      id: item.id,
      floorAmount,
      remainder,
      sortOrder: item.sortOrder ?? 0
    };
  });

  const allocatedSoFar = withQuotas.reduce((sum, item) => sum + item.floorAmount, 0);
  let leftoverVnd = totalVnd - allocatedSoFar;

  // Bước 2: Sắp xếp theo phần dư giảm dần, nếu bằng nhau thì dùng sortOrder rồi id để ổn định
  const sorted = [...withQuotas].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.id.localeCompare(b.id);
  });

  // Bước 3: Phân phối từng 1 VND cho đến khi hết phần dư
  const extraAllocations = new Map<string, number>();
  for (const item of sorted) {
    if (leftoverVnd > 0) {
      extraAllocations.set(item.id, 1);
      leftoverVnd--;
    } else {
      extraAllocations.set(item.id, 0);
    }
  }

  // Kết quả cuối cùng đảm bảo tổng bằng đúng totalVnd
  return items.map(item => ({
    id: item.id,
    allocatedVnd: (withQuotas.find(w => w.id === item.id)?.floorAmount || 0) + (extraAllocations.get(item.id) || 0)
  }));
}

// 4. Công thức kế hoạch bình quân tháng và theo kỳ (V2-16)
export function calculateBudgetExpected(
  amountVnd: number,
  cadence: CadenceType,
  periodMode: 'month' | 'quarter' | 'year' | 'all' | 'custom',
  targetMonthIndex = 0 // 0-based nếu cần
): number {
  if (amountVnd <= 0) return 0;

  switch (cadence) {
    case 'monthly':
      if (periodMode === 'quarter') return amountVnd * 3;
      if (periodMode === 'year') return amountVnd * 12;
      return amountVnd;

    case 'weekly':
      // 52 tuần / 12 tháng
      const monthlyAvgWeekly = Math.round((amountVnd * 52) / 12);
      if (periodMode === 'quarter') return monthlyAvgWeekly * 3;
      if (periodMode === 'year') return amountVnd * 52;
      return monthlyAvgWeekly;

    case 'quarterly':
      if (periodMode === 'month') return Math.round(amountVnd / 3);
      if (periodMode === 'year') return amountVnd * 4;
      return amountVnd;

    case 'semiannual':
      if (periodMode === 'month') return Math.round(amountVnd / 6);
      if (periodMode === 'quarter') return Math.round(amountVnd / 2);
      if (periodMode === 'year') return amountVnd * 2;
      return amountVnd;

    case 'annual':
      if (periodMode === 'month') return Math.round(amountVnd / 12);
      if (periodMode === 'quarter') return Math.round(amountVnd / 4);
      return amountVnd;

    case 'one_time':
      // Khoản một lần chỉ tính toàn bộ A tại tháng diễn ra, kỳ năm cộng A đúng 1 lần
      return amountVnd;

    default:
      return amountVnd;
  }
}

// 5. Hash payload phục vụ kiểm tra Idempotency (V2-02)
export async function hashPayload(payload: unknown): Promise<string> {
  const jsonStr = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
