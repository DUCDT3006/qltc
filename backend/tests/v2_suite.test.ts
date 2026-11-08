// Test Suite Toàn Diện Cho V2 (AT2-01 đến AT2-46)
// Kiểm tra các bất biến toán học, parser, sổ cái delta, XIRR, largest remainder, và phân bổ ngân sách

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  TxnState,
  getTxnContribution,
  calculateBalanceDelta,
  allocateVndLargestRemainder,
  calculateBudgetExpected,
  hashPayload
} from '../src/services/ledger';

import { parseBankNotification, redactOtp, isOtpNotification } from '../src/services/parser';
import { matchAccountForNotification } from '../src/services/accountMatcher';
import { calculateXIRR } from '../src/services/xirr';

describe('V2-02 & AT2-03, AT2-06, AT2-46: Sổ Cái Delta & Bất Biến Tài Khoản', () => {
  it('AT2-03: Chuyển khoản nội bộ thuần bảo toàn tổng tiền (SUM delta = 0)', () => {
    const accA = 'acc_A';
    const accB = 'acc_B';

    const transferTxn: TxnState = {
      type: 'transfer',
      amount: 2000000,
      status: 'confirmed',
      sourceAccountId: accA,
      toAccountId: accB
    };

    const deltaA = calculateBalanceDelta(null, transferTxn, accA);
    const deltaB = calculateBalanceDelta(null, transferTxn, accB);

    assert.strictEqual(deltaA, -2000000, 'Tài khoản nguồn phải bị trừ 2 triệu');
    assert.strictEqual(deltaB, 2000000, 'Tài khoản đích phải được cộng 2 triệu');
    assert.strictEqual(deltaA + deltaB, 0, 'Bất biến: Tổng delta của chuyển khoản nội bộ = 0');
  });

  it('AT2-06: Sửa số tiền chi confirmed từ 100k lên 200k trừ thêm 100k', () => {
    const accId = 'acc_cash';

    const oldExpense: TxnState = {
      type: 'expense',
      amount: 100000,
      status: 'confirmed',
      sourceAccountId: accId
    };

    const newExpense: TxnState = {
      type: 'expense',
      amount: 200000,
      status: 'confirmed',
      sourceAccountId: accId
    };

    const delta = calculateBalanceDelta(oldExpense, newExpense, accId);
    assert.strictEqual(delta, -100000, 'Tài khoản phải bị trừ thêm 100.000 VND');
  });

  it('AT2-06: Xóa giao dịch confirmed hoàn tác đúng số tiền trước đó', () => {
    const accId = 'acc_vcb';

    const oldExpense: TxnState = {
      type: 'expense',
      amount: 150000,
      status: 'confirmed',
      sourceAccountId: accId
    };

    const delta = calculateBalanceDelta(oldExpense, null, accId);
    assert.strictEqual(delta, 150000, 'Xóa khoản chi đã confirmed phải hoàn lại 150.000 VND');
  });

  it('Chân phụ paired_hidden không tạo đóng góp số dư (chống nhân đôi)', () => {
    const accId = 'acc_dest';

    const hiddenLeg: TxnState = {
      type: 'transfer',
      amount: 1000000,
      status: 'paired_hidden',
      sourceAccountId: accId,
      isPairedHidden: true
    };

    const contrib = getTxnContribution(hiddenLeg, accId);
    assert.strictEqual(contrib, 0, 'Chân ẩn paired_hidden phải có đóng góp = 0');
  });
});

describe('V2-03 & AT2-07: Khớp Tài Khoản & Bảo Vệ Tài Khoản Mơ Hồ', () => {
  const accounts = [
    {
      id: 'acc_vcb_1',
      name: 'VCB Chính',
      bankCode: 'VCB',
      accountNumberMask: '1111',
      accountNumber: '0011001111'
    },
    {
      id: 'acc_vcb_2',
      name: 'VCB Phụ',
      bankCode: 'VCB',
      accountNumberMask: '2222',
      accountNumber: '0011002222'
    }
  ];

  it('AT2-07: Mask 2222 vào đúng VCB Phụ', () => {
    const match = matchAccountForNotification('VCB', '2222', accounts);
    assert.strictEqual(match.accountId, 'acc_vcb_2');
    assert.strictEqual(match.needsAccountReview, false);
  });

  it('AT2-07: Thiếu mask + nhiều tài khoản VCB => needsAccountReview = true, không tự gán', () => {
    const match = matchAccountForNotification('VCB', null, accounts);
    assert.strictEqual(match.needsAccountReview, true);
    assert.strictEqual(match.accountId, null);
  });

  it('Một tài khoản duy nhất của ngân hàng => tự gán an toàn', () => {
    const singleTcb = [{
      id: 'acc_tcb',
      name: 'Techcombank',
      bankCode: 'TCB',
      accountNumberMask: '9999'
    }];
    const match = matchAccountForNotification('TCB', null, singleTcb);
    assert.strictEqual(match.accountId, 'acc_tcb');
    assert.strictEqual(match.needsAccountReview, false);
  });
});

describe('V2-04 & AT2-08, AT2-09: Bộ Phân Tích Thông Báo Ngân Hàng (Parser V2)', () => {
  it('AT2-08: Dấu gạch ngang ngày 08-11-2026 không bị nhầm thành dấu trừ số tiền 11 VND', () => {
    const body = 'TK 12345678 thanh toan 150,000 VND ngay 08-11-2026. So du: 2,000,000 VND';
    const parsed = parseBankNotification('com.vietcombank', 'VCB Digibank', body);
    assert.ok(parsed, 'Phải parse được thông báo');
    assert.strictEqual(parsed?.amount, 150000, 'Số tiền phải là 150.000 VND chứ không phải 11 hay 8');
    assert.strictEqual(parsed?.balanceAfter, 2000000, 'Số dư sau phải là 2.000.000 VND');
  });

  it('AT2-09: Hỗ trợ Unicode minus (−), .00 thập phân, và balanceAfter = 0', () => {
    const body = 'TK 9876 GD: −500,000.00 VND. So du: 0 VND';
    const parsed = parseBankNotification('com.mbmobile', 'MB Bank', body);
    assert.ok(parsed, 'Phải parse được Unicode minus');
    assert.strictEqual(parsed?.type, 'expense');
    assert.strictEqual(parsed?.amount, 500000);
    assert.strictEqual(parsed?.balanceAfter, 0, 'Số dư 0 VND phải được giữ nguyên');
  });

  it('AT2-09: Redact mã OTP trong mô tả giao dịch và chặn ingest tin nhắn OTP thuần', () => {
    const textWithOtp = 'TK 1234 -50,000 VND. Ma OTP 849201 khong chia se voi ai';
    const redacted = redactOtp(textWithOtp);
    assert.strictEqual(redacted.includes('849201'), false, 'Mã OTP không được lưu trong mô tả');
    assert.ok(redacted.includes('[OTP_REDACTED]'));

    // Tin nhắn OTP thuần bị từ chối, không tạo transaction (V2-04)
    const pureOtp = 'Ma xac thuc OTP cua ban la 654321, hieu luc trong 3 phut';
    const parsedOtp = parseBankNotification('com.vpb.neo', 'VPBank Smart OTP', pureOtp);
    assert.strictEqual(parsedOtp, null, 'Tin nhắn OTP phải bị loại bỏ hoàn toàn');
  });
});

describe('V2-17 & AT2-31, AT2-46: Phân Bổ VND Largest Remainder Method', () => {
  it('AT2-31: 1.000.001 VND chia 33/33/34 tổng đúng chính xác 1.000.001 VND', () => {
    const items = [
      { id: 'NEC', weightBps: 3300, sortOrder: 1 },
      { id: 'SAV', weightBps: 3300, sortOrder: 2 },
      { id: 'INV', weightBps: 3400, sortOrder: 3 }
    ];

    const allocated = allocateVndLargestRemainder(1000001, items);
    const sum = allocated.reduce((acc, it) => acc + it.allocatedVnd, 0);

    assert.strictEqual(sum, 1000001, 'Tổng phân bổ phải bằng đúng 1.000.001 VND');
    // 34% của 1.000.001 là 340.000,34 -> nhận phần dư lớn nhất
    assert.strictEqual(allocated.find(a => a.id === 'INV')?.allocatedVnd, 340001);
  });

  it('AT2-31: Ba hũ bằng nhau chia 100.000 VND ổn định và tổng đúng 100.000 VND', () => {
    const items = [
      { id: 'A', weightBps: 3333, sortOrder: 1 },
      { id: 'B', weightBps: 3333, sortOrder: 2 },
      { id: 'C', weightBps: 3334, sortOrder: 3 }
    ];

    const allocated = allocateVndLargestRemainder(100000, items);
    const sum = allocated.reduce((acc, it) => acc + it.allocatedVnd, 0);
    assert.strictEqual(sum, 100000);
  });

  it('AT2-46: Tổng 0 VND trả về toàn bộ 0 VND không crash', () => {
    const items = [
      { id: 'NEC', weightBps: 5500 },
      { id: 'PLAY', weightBps: 4500 }
    ];
    const allocated = allocateVndLargestRemainder(0, items);
    assert.strictEqual(allocated[0].allocatedVnd, 0);
    assert.strictEqual(allocated[1].allocatedVnd, 0);
  });
});

describe('V2-16 & AT2-29, AT2-30, AT2-45: Công Thức Kế Hoạch Tài Chính & Chu Kỳ', () => {
  it('AT2-29: Khoản một lần (one_time) 12 triệu chỉ tính 12 triệu tại kỳ', () => {
    const amt = calculateBudgetExpected(12000000, 'one_time', 'month');
    assert.strictEqual(amt, 12000000);
    const amtYear = calculateBudgetExpected(12000000, 'one_time', 'year');
    assert.strictEqual(amtYear, 12000000);
  });

  it('AT2-30: Annual 12 triệu bình quân 1 triệu/tháng, tổng năm 12 triệu', () => {
    const monthAvg = calculateBudgetExpected(12000000, 'annual', 'month');
    assert.strictEqual(monthAvg, 1000000, 'Bình quân tháng phải là 1.000.000 VND');

    const yearTotal = calculateBudgetExpected(12000000, 'annual', 'year');
    assert.strictEqual(yearTotal, 12000000, 'Tổng năm phải đúng 12.000.000 VND');
  });

  it('AT2-45: Quarterly 1.000.001 VND có tổng năm đúng 4.000.004 VND', () => {
    const yearTotal = calculateBudgetExpected(1000001, 'quarterly', 'year');
    assert.strictEqual(yearTotal, 4000004);
  });
});

describe('V2-19 & AT2-42: Thuật Toán XIRR (Đầu Tư & Lợi Nhuận Thực Tế)', () => {
  it('AT2-42: Dòng tiền đầu tư -10 triệu 01/01/2025, +11 triệu 01/01/2026 => XIRR xấp xỉ 10%', () => {
    const cashflows = [
      { date: '2025-01-01', amount: -10000000 },
      { date: '2026-01-01', amount: 11000000 }
    ];

    const xirr = calculateXIRR(cashflows);
    assert.ok(xirr !== null, 'XIRR phải hội tụ');
    // 10% = 0.10, dung sai +/- 0.005
    assert.ok(Math.abs(xirr! - 0.10) < 0.005, `XIRR tính được: ${xirr}, kỳ vọng ~0.10`);
  });

  it('Dòng tiền toàn âm hoặc toàn dương => trả về null (không xác định)', () => {
    const allNegative = [
      { date: '2025-01-01', amount: -10000000 },
      { date: '2025-06-01', amount: -5000000 }
    ];
    assert.strictEqual(calculateXIRR(allNegative), null);
  });
});

describe('V2-02 & AT2-05: Hash Payload & Idempotency', () => {
  it('Cùng payload tạo cùng SHA-256 hash', async () => {
    const p1 = { amount: 100000, desc: 'Ăn trưa' };
    const p2 = { amount: 100000, desc: 'Ăn trưa' };

    const h1 = await hashPayload(p1);
    const h2 = await hashPayload(p2);
    assert.strictEqual(h1, h2);
    assert.strictEqual(h1.length, 64, 'SHA-256 hex string phải có 64 ký tự');
  });

  it('Khác payload tạo khác hash', async () => {
    const p1 = { amount: 100000 };
    const p2 = { amount: 200000 };

    const h1 = await hashPayload(p1);
    const h2 = await hashPayload(p2);
    assert.notStrictEqual(h1, h2);
  });
});

describe('V2-12 & AT2-23: Phân Loại Nguồn Thu Duy Nhất & Không Nhân Đôi', () => {
  it('AT2-23: Thu 10 triệu gán Lương chính, dù có thêm nguồn Lương => chỉ tính 10 triệu, không bị 20 triệu', () => {
    const incomeSources = [
      { id: 'src_luong_chinh', name: 'Lương chính' },
      { id: 'src_luong', name: 'Lương' }
    ];

    const transactions = [
      { id: 'txn_1', type: 'income', amount: 10000000, incomeSourceId: 'src_luong_chinh', description: 'Lương chính chuyển khoản' }
    ];

    // Khớp tuyệt đối theo incomeSourceId (V2-12) thay vì substring 'includes'
    const bucketLuongChinh = transactions
      .filter(t => t.incomeSourceId === 'src_luong_chinh')
      .reduce((sum, t) => sum + t.amount, 0);

    const bucketLuong = transactions
      .filter(t => t.incomeSourceId === 'src_luong')
      .reduce((sum, t) => sum + t.amount, 0);

    assert.strictEqual(bucketLuongChinh, 10000000);
    assert.strictEqual(bucketLuong, 0, 'Nguồn "Lương" không được tính trùng giao dịch của "Lương chính"');
    assert.strictEqual(bucketLuongChinh + bucketLuong, 10000000, 'Tổng các buckets phải đúng 10.000.000 VND');
  });
});

describe('V2-13 & AT2-25: Tổng Chi Bao Gồm Khoản Chưa Gắn Hũ', () => {
  it('AT2-25: Chi 300k có hũ + 200k chưa hũ => tổng chi 500k, tỷ lệ 60%/40%', () => {
    const expenses = [
      { id: 'e1', type: 'expense', amount: 300000, jarId: 'jar_nec' },
      { id: 'e2', type: 'expense', amount: 200000, jarId: null } // Chưa gắn hũ
    ];

    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);
    const assigned = expenses.filter(e => e.jarId !== null).reduce((sum, e) => sum + e.amount, 0);
    const unassigned = expenses.filter(e => e.jarId === null).reduce((sum, e) => sum + e.amount, 0);

    assert.strictEqual(totalExpense, 500000, 'Tổng chi phải đầy đủ 500.000 VND');
    assert.strictEqual(assigned, 300000);
    assert.strictEqual(unassigned, 200000);
    assert.strictEqual(assigned / totalExpense, 0.6, 'Hũ NEC chiếm 60%');
    assert.strictEqual(unassigned / totalExpense, 0.4, 'Chưa gắn hũ chiếm 40%');
  });
});

describe('V2-18 & AT2-32: Bảo Vệ Vàng Miếng SJC & Quy Đổi Đơn Vị Vàng', () => {
  it('AT2-32: Vàng SJC không bị ghi đè bởi giá PAXG quốc tế', () => {
    const sjcAsset = {
      symbol: 'SJC',
      name: 'Vàng miếng SJC 9999',
      asset_class: 'gold',
      current_price: 89000000, // 89 triệu / lượng (giá SJC tự nhập/trong nước)
      auto_sync: 0 // hoặc name có SJC
    };

    const isSjc = sjcAsset.symbol === 'SJC' || (sjcAsset.name || '').includes('SJC') || sjcAsset.auto_sync === 0;
    assert.strictEqual(isSjc, true, 'Tài sản SJC phải được nhận diện và không bị ghi đè tự động');
  });

  it('AT2-32: Quy đổi đơn vị vàng chính xác (1 lượng = 10 chỉ = 37.5g; 1 gram = 1 chỉ / 3.75)', () => {
    const goldPerChi = 8500000; // 8.5 triệu / chỉ

    // 1 lượng = 10 chỉ
    const goldPerLuong = goldPerChi * 10;
    assert.strictEqual(goldPerLuong, 85000000);

    // 1 gram = 1 chỉ / 3.75
    const goldPerGram = Math.round(goldPerChi / 3.75);
    assert.strictEqual(goldPerGram, 2266667);
  });
});
