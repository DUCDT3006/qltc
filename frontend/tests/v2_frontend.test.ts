import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  allocateVndExact,
  formatPrivacyVND,
  formatPrivacyText
} from '../src/utils/financeMath';

import { calculateXIRR } from '../src/utils/xirr';
import { isTxnInPeriod } from '../src/utils/dateUtils';

describe('V2-17 & AT2-31: Frontend Largest Remainder Allocation', () => {
  it('1.000.001 VND chia 33/33/34 tổng đúng chính xác 1.000.001 VND', () => {
    const weights = [33, 33, 34];
    const allocated = allocateVndExact(1000001, weights);
    const sum = allocated.reduce((acc, it) => acc + it, 0);

    assert.strictEqual(sum, 1000001);
    assert.strictEqual(allocated[2], 340001);
  });
});

describe('V2-23 & AT2-37: Chế Độ Riêng Tư & Che Dữ Liệu Nhạy Cảm', () => {
  it('formatPrivacyVND che dấu số tiền khi isPrivateMode = true', () => {
    const hidden = formatPrivacyVND(50000000, true);
    assert.strictEqual(hidden, '•••••• ₫');

    const visible = formatPrivacyVND(50000000, false);
    assert.ok(visible.includes('50.000.000'));
  });

  it('formatPrivacyText che nội dung văn bản khi isPrivateMode = true', () => {
    const hidden = formatPrivacyText('0912345678', true);
    assert.strictEqual(hidden, '••••••');

    const visible = formatPrivacyText('0912345678', false);
    assert.strictEqual(visible, '0912345678');
  });
});

describe('V2-19 & AT2-42: Frontend XIRR Solver', () => {
  it('Dòng tiền -10M và +11M sau 1 năm cho XIRR ~ 10%', () => {
    const cfs = [
      { date: '2025-01-01', amount: -10000000 },
      { date: '2026-01-01', amount: 11000000 }
    ];
    const rate = calculateXIRR(cfs);
    assert.ok(rate !== null);
    assert.ok(Math.abs(rate! - 0.10) < 0.005);
  });
});

describe('V2-15 & AT2-28: Bộ Lọc Kỳ Giao Dịch', () => {
  it('Giao dịch tháng 9/2026 nhận đúng khi lọc theo tháng 9', () => {
    const inSep = isTxnInPeriod('2026-09-15T10:00:00Z', 'month', { year: 2026, month: 9 });
    assert.strictEqual(inSep, true);

    const inOct = isTxnInPeriod('2026-09-15T10:00:00Z', 'month', { year: 2026, month: 10 });
    assert.strictEqual(inOct, false);
  });

  it('Lọc Tất cả (all) luôn trả về true', () => {
    assert.strictEqual(isTxnInPeriod('2026-01-01T00:00:00Z', 'all'), true);
  });
});
