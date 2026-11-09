// Ledger Service V2
// Ghi sổ nguyên tử, hạch toán delta, chống lặp, phân bổ tỷ trọng lớn nhất (Largest Remainder)
// Tuân thủ V2-02, V2-09, V2-10, V2-11, V2-16, V2-17

import { CadenceType } from '../types';

export interface TxnState {
  type: string; // 'income' | 'expense' | 'transfer' | 'invest'
  amount: number;
  status?: string;
  sourceAccountId?: string;
  accountId?: string;
  toAccountId?: string | null;
  isSynthetic?: boolean;
  isPairedHidden?: boolean;
  deletedAt?: string | null;
}

export type LedgerTxState = TxnState;

export function isValidVndAmount(amount: unknown): amount is number {
  return (
    typeof amount === 'number' &&
    Number.isFinite(amount) &&
    Number.isSafeInteger(amount) &&
    amount > 0 &&
    amount <= 10_000_000_000_000
  );
}

// 1. Định nghĩa toán học đóng góp của giao dịch C(txn, account)
export function getTxnContribution(txn: TxnState, targetAccountId: string): number {
  if (
    txn.deletedAt ||
    txn.status === 'pending' ||
    txn.status === 'rejected' ||
    txn.status === 'ignored' ||
    txn.status === 'deleted' ||
    txn.status === 'paired_hidden' ||
    txn.isPairedHidden
  ) {
    return 0;
  }

  const srcAcc = txn.sourceAccountId || txn.accountId || '';

  if (txn.type === 'income') {
    return srcAcc === targetAccountId ? txn.amount : 0;
  }

  if (txn.type === 'expense') {
    return srcAcc === targetAccountId ? -txn.amount : 0;
  }

  if (txn.type === 'transfer') {
    let contrib = 0;
    if (srcAcc === targetAccountId) {
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

export function validateAllocationWeights(items: AllocationItemInput[]): { valid: boolean; error?: string } {
  if (!items || items.length === 0) {
    return { valid: false, error: 'Danh sách hũ phân bổ trống' };
  }
  for (const it of items) {
    if (!Number.isFinite(it.weightBps) || it.weightBps < 0) {
      return { valid: false, error: `Tỷ lệ hũ ${it.id} không hợp lệ (không được âm hoặc NaN)` };
    }
  }
  const sumBps = items.reduce((s, it) => s + Math.round(it.weightBps), 0);
  if (Math.abs(sumBps - 10000) > 1) {
    return {
      valid: false,
      error: `Tổng tỷ lệ các hũ phải bằng đúng 100% (hiện tại: ${(sumBps / 100).toFixed(2)}%)`
    };
  }
  return { valid: true };
}

export function allocateVndLargestRemainder(
  totalVnd: number,
  items: AllocationItemInput[]
): AllocationItemOutput[] & Record<string, number> {
  if (items.length === 0) return [] as unknown as AllocationItemOutput[] & Record<string, number>;
  if (totalVnd === 0) {
    const zeroArr = items.map((it) => ({ id: it.id, allocatedVnd: 0 }));
    const zeroMap: Record<string, number> = {};
    for (const it of items) zeroMap[it.id] = 0;
    return Object.assign(zeroArr, zeroMap);
  }

  const totalWeight = items.reduce((sum, it) => sum + it.weightBps, 0);
  if (totalWeight <= 0) {
    const zeroArr = items.map((it) => ({ id: it.id, allocatedVnd: 0 }));
    const zeroMap: Record<string, number> = {};
    for (const it of items) zeroMap[it.id] = 0;
    return Object.assign(zeroArr, zeroMap);
  }

  const withQuotas = items.map((item) => {
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

  const sorted = [...withQuotas].sort((a, b) => {
    if (Math.abs(b.remainder - a.remainder) > 1e-9) {
      return b.remainder - a.remainder;
    }
    if (a.sortOrder !== b.sortOrder) {
      return a.sortOrder - b.sortOrder;
    }
    return a.id.localeCompare(b.id);
  });

  const extraAllocations = new Map<string, number>();
  for (const item of sorted) {
    if (leftoverVnd > 0) {
      extraAllocations.set(item.id, 1);
      leftoverVnd--;
    } else {
      extraAllocations.set(item.id, 0);
    }
  }

  const resultArr = items.map((item) => ({
    id: item.id,
    allocatedVnd: (withQuotas.find((w) => w.id === item.id)?.floorAmount || 0) + (extraAllocations.get(item.id) || 0)
  }));

  const mapProps: Record<string, number> = {};
  for (const r of resultArr) {
    mapProps[r.id] = r.allocatedVnd;
  }
  return Object.assign(resultArr, mapProps);
}

// 4. Công thức kế hoạch bình quân tháng và theo kỳ (V2-16)
export function calculateBudgetExpected(
  amountVnd: number,
  cadence: CadenceType,
  periodMode: 'month' | 'quarter' | 'year' | 'all' | 'custom',
  _targetMonthIndex = 0
): number {
  if (amountVnd <= 0) return 0;

  switch (cadence) {
    case 'monthly':
      if (periodMode === 'quarter') return amountVnd * 3;
      if (periodMode === 'year') return amountVnd * 12;
      return amountVnd;

    case 'weekly': {
      const monthlyAvgWeekly = Math.round((amountVnd * 52) / 12);
      if (periodMode === 'quarter') return monthlyAvgWeekly * 3;
      if (periodMode === 'year') return amountVnd * 52;
      return monthlyAvgWeekly;
    }

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
      return amountVnd;

    default:
      return amountVnd;
  }
}

// 5. Hash payload phục vụ kiểm tra Idempotency & Checksum (V2-02, V2-26)
export async function hashPayload(payload: unknown): Promise<string> {
  const jsonStr = JSON.stringify(payload);
  const encoder = new TextEncoder();
  const data = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
