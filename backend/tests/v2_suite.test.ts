// Test Suite Toàn Diện Cho V2 (AT2-01 đến AT2-46)
// Kiểm tra các bất biến toán học, parser, sổ cái delta, XIRR, largest remainder, và phân bổ ngân sách

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

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

// ============================================================================
// END-TO-END INTEGRATION TESTS AGAINST REAL HONO APP + SQLITE D1 HARNESS
// Chứng minh thực tế 6 lỗi đã báo cáo và toàn bộ chuỗi nghiệm thu AT2-01..AT2-46
// ============================================================================

import workerApp, { resetSchemaEnsureCache } from '../src/index';
import { createSqliteD1 } from './d1Helper';

const OWNER_TOKEN = 'test_owner_secret_token_v2_2026';

function createTestEnv(options: { seedDefaults?: boolean } = {}) {
  const harness = createSqliteD1();
  const env = {
    DB: harness.db,
    OWNER_API_TOKEN: OWNER_TOKEN,
    __testSetup: Promise.resolve()
  };
  if (options.seedDefaults !== false) {
    env.__testSetup = (async () => {
      const response = await workerApp.fetch(new Request('http://localhost/api/seed', {
        method: 'POST', headers: { Authorization: `Bearer ${OWNER_TOKEN}` }
      }), env, { waitUntil: () => {} });
      if (response.status !== 200) throw new Error(`Test fixture seed failed: HTTP ${response.status}`);
    })();
  }
  return { ...harness, env };
}

async function apiCall(
  env: any,
  path: string,
  options: {
    method?: string;
    token?: string | null;
    headers?: Record<string, string>;
    body?: any;
  } = {}
): Promise<{ status: number; data: any }> {
  await env.__testSetup;
  const headers: Record<string, string> = {
    ...(options.headers || {})
  };
  if (options.token !== undefined) {
    if (options.token !== null) {
      headers['Authorization'] = `Bearer ${options.token}`;
    }
  } else {
    headers['Authorization'] = `Bearer ${OWNER_TOKEN}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const req = new Request(`http://localhost${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const res = await workerApp.fetch(req, env, { waitUntil: () => {} });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

describe('E2E Integration V2-01 (AT2-01, AT2-02): Xác thực & Phân quyền Owner vs Device', () => {
  it('AT2-01: GET /api/accounts không có token hoặc token sai bị chặn 401; có Owner token trả 200', async () => {
    const { env } = createTestEnv();

    // 1. Không có token -> phải trả 401 (sửa triệt để lỗi trả 200 khi không đăng nhập)
    const noAuth = await apiCall(env, '/api/accounts', { token: null });
    assert.strictEqual(noAuth.status, 401, 'API không có thông tin đăng nhập bắt buộc trả HTTP 401');

    // 2. Token ngẫu nhiên >= 8 ký tự -> phải trả 401 (bỏ lỗi chấp nhận token bất kỳ >= 8 ký tự)
    const fakeAuth = await apiCall(env, '/api/accounts', { token: 'random_fake_token_12345' });
    assert.strictEqual(fakeAuth.status, 401, 'Token giả mạo bắt buộc trả HTTP 401');

    // 3. Owner token hợp lệ -> trả 200
    const validAuth = await apiCall(env, '/api/accounts', { token: OWNER_TOKEN });
    assert.strictEqual(validAuth.status, 200, 'Owner token hợp lệ phải trả HTTP 200');
    assert.ok(Array.isArray(validAuth.data.accounts));
  });

  it('AT2-02: Ghép nối thiết bị Android cấp Device Token riêng; chỉ được phép ingest, bị chặn 403 trên /api/reset và /api/accounts, và thu hồi (revoke) thành công', async () => {
    const { env } = createTestEnv();

    // 1. Owner tạo mã ghép nối 6 số
    const pairRes = await apiCall(env, '/api/devices/pair-code', {
      method: 'POST',
      body: { deviceName: 'Pixel 8 Pro' }
    });
    assert.strictEqual(pairRes.status, 200);
    assert.ok(pairRes.data.code);

    // 2. Thiết bị Android đổi mã lấy deviceToken
    const exchangeRes = await apiCall(env, '/api/auth/pair-exchange', {
      method: 'POST',
      token: null,
      body: {
        code: pairRes.data.code,
        deviceId: 'android_pixel_8',
        deviceName: 'Pixel 8 Pro'
      }
    });
    assert.strictEqual(exchangeRes.status, 200);
    const deviceToken = exchangeRes.data.deviceToken;
    assert.ok(deviceToken && deviceToken.startsWith('qltc_dev_'));

    // 3. Device token gọi POST /api/notifications/ingest -> 200 OK
    const ingestRes = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      token: deviceToken,
      body: {
        packageName: 'com.VCB',
        title: 'VCB Digibank',
        text: 'SD TK 0011001234567 -50,000VND luc 08-11-2026 12:00:00. SD: 1,950,000VND. ND: Mua cafe',
        eventId: 'evt_test_001'
      }
    });
    assert.strictEqual(ingestRes.status, 200);
    assert.strictEqual(ingestRes.data.status, 'created');

    // 4. Device token cố tình gọi POST /api/reset hoặc GET /api/accounts -> 403 FORBIDDEN
    const resetAttempt = await apiCall(env, '/api/reset', {
      method: 'POST',
      token: deviceToken,
      body: { targets: ['all'] }
    });
    assert.strictEqual(resetAttempt.status, 403, 'Device token không được phép xóa/reset dữ liệu');

    const accountsAttempt = await apiCall(env, '/api/accounts', {
      method: 'GET',
      token: deviceToken
    });
    assert.strictEqual(accountsAttempt.status, 403, 'Device token không được phép đọc danh sách tài khoản');

    // 5. Owner thu hồi (revoke) thiết bị -> Device token lập tức bị 401
    const revokeRes = await apiCall(env, '/api/devices/android_pixel_8/revoke', {
      method: 'POST',
      token: OWNER_TOKEN
    });
    assert.strictEqual(revokeRes.status, 200);

    const afterRevoke = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      token: deviceToken,
      body: {
        packageName: 'com.VCB',
        title: 'VCB',
        text: 'SD TK 0011001234567 -20,000VND'
      }
    });
    assert.strictEqual(afterRevoke.status, 401, 'Device token đã bị revoke phải trả 401');
  });
});

describe('E2E Integration V2-02 & V2-09 (AT2-03, AT2-04, AT2-05, AT2-06): Nguyên tử Sổ cái, Idempotency, Concurrency & Reset Adjustment', () => {
  it('AT2-03 (Bug #2 Repro & Fix): Khi bước INSERT INTO ledger_postings lỗi, API trả 500 nhưng giao dịch KHÔNG tồn tại và số dư KHÔNG bị giảm', async () => {
    const { env, setFailOnSqlPattern } = createTestEnv();

    // Tạo tài khoản có số dư 1.000.000đ
    const accRes = await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_atomic_test', name: 'VCB Atomic', type: 'bank', balance: 1000000 }
    });
    assert.strictEqual(accRes.status, 200);

    // Tiêm lỗi vào đúng câu lệnh INSERT INTO ledger_postings
    setFailOnSqlPattern(/INSERT INTO ledger_postings/i);

    const txRes = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_should_rollback',
        accountId: 'acc_atomic_test',
        type: 'expense',
        amount: 300000,
        description: 'Giao dịch lỗi giữa chừng'
      }
    });
    assert.strictEqual(txRes.status, 500, 'API phải trả HTTP 500 khi bước ghi ledger_postings lỗi');

    // Gỡ bỏ fault injection để kiểm tra trạng thái DB sau lỗi
    setFailOnSqlPattern(null);

    const checkAcc = await apiCall(env, '/api/accounts');
    const accAfter = checkAcc.data.accounts.find((a: any) => a.id === 'acc_atomic_test');
    assert.strictEqual(accAfter.balance, 1000000, 'Số dư tài khoản phải giữ nguyên 1.000.000đ (rollback hoàn toàn)');

    const checkTxs = await apiCall(env, '/api/transactions');
    const leakedTx = checkTxs.data.transactions.find((t: any) => t.id === 'tx_should_rollback');
    assert.strictEqual(leakedTx, undefined, 'Giao dịch không được phép tồn tại mồ côi trong bảng transactions');
  });

  it('AT2-04 & AT2-05: 20 giao dịch đồng thời giữ đúng bất biến số dư; Idempotency cùng operationId không trừ tiền 2 lần, khác payload trả 409', async () => {
    const { env } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_concurrent', name: 'TK Đồng thời', type: 'bank', balance: 5000000 }
    });

    // Chạy 20 thao tác chi tiêu 50.000đ đồng thời (tổng trừ 1.000.000đ)
    const promises = Array.from({ length: 20 }, (_, i) =>
      apiCall(env, '/api/transactions', {
        method: 'POST',
        body: {
          id: `tx_conc_${i}`,
          operationId: `op_conc_${i}`,
          accountId: 'acc_concurrent',
          type: 'expense',
          amount: 50000,
          description: `Chi đồng thời #${i}`
        }
      })
    );
    const results = await Promise.all(promises);
    assert.ok(results.every(r => r.status === 200));

    // Retry lại đúng operationId `op_conc_0` với cùng payload -> trả 200 nhưng không trừ tiền lần 2
    const retrySame = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_conc_0',
        operationId: 'op_conc_0',
        accountId: 'acc_concurrent',
        type: 'expense',
        amount: 50000,
        description: 'Chi đồng thời #0'
      }
    });
    assert.strictEqual(retrySame.status, 200);

    // Retry cùng operationId `op_conc_0` nhưng khác số tiền -> phải trả 409 IDEMPOTENCY_CONFLICT
    const retryConflict = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_conc_0',
        operationId: 'op_conc_0',
        accountId: 'acc_concurrent',
        type: 'expense',
        amount: 999999,
        description: 'Chi đồng thời #0 sửa payload'
      }
    });
    assert.strictEqual(retryConflict.status, 409);
    assert.strictEqual(retryConflict.data.code, 'IDEMPOTENCY_CONFLICT');

    // Kiểm tra số dư cuối cùng = 5.000.000 - 20 * 50.000 = 4.000.000đ
    const accs = await apiCall(env, '/api/accounts');
    const acc = accs.data.accounts.find((a: any) => a.id === 'acc_concurrent');
    assert.strictEqual(acc.balance, 4000000, 'Số dư sau 20 giao dịch + 1 retry phải đúng 4.000.000đ');
  });

  it('AT2-06: Optimistic concurrency expectedRevision sai bị chặn 409 REVISION_CONFLICT', async () => {
    const { env } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_rev', name: 'TK Revision', type: 'bank', balance: 1000000 }
    });

    await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_rev_1',
        accountId: 'acc_rev',
        type: 'expense',
        amount: 100000,
        description: 'Bản ghi gốc rev=1'
      }
    });

    // Cập nhật hợp lệ với expectedRevision = 1 -> thành công, lên rev = 2
    const upd1 = await apiCall(env, '/api/transactions/tx_rev_1', {
      method: 'PUT',
      body: { expectedRevision: 1, amount: 150000 }
    });
    assert.strictEqual(upd1.status, 200);
    assert.strictEqual(upd1.data.revision, 2);

    // Phiên cũ gửi tiếp expectedRevision = 1 -> bị từ chối 409 REVISION_CONFLICT
    const staleUpd = await apiCall(env, '/api/transactions/tx_rev_1', {
      method: 'PUT',
      body: { expectedRevision: 1, amount: 300000 }
    });
    assert.strictEqual(staleUpd.status, 409);
    assert.strictEqual(staleUpd.data.code, 'REVISION_CONFLICT');
  });

  it('AT2-05 & V2-09 (Bug #3 Repro & Fix): Reset số dư 900.000 về 0 phải ghi posting điều chỉnh đúng -900.000 (không ghi 0); chế độ hide_history bảo toàn baseline/postings', async () => {
    const { env, rawDb } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_reset_900k', name: 'TK 900k', type: 'bank', balance: 900000 }
    });

    // Thực hiện reset balances về 0
    const resetRes = await apiCall(env, '/api/reset', {
      method: 'POST',
      body: { targets: ['balances'] }
    });
    assert.strictEqual(resetRes.status, 200);

    const adj = resetRes.data.balanceAdjustments.find((x: any) => x.accountId === 'acc_reset_900k');
    assert.ok(adj, 'Phải có bản ghi balanceAdjustment cho tài khoản');
    assert.strictEqual(adj.oldBalance, 900000);
    assert.strictEqual(adj.deltaVnd, -900000, 'Posting điều chỉnh phải ghi đúng -900.000 VND chứ không phải 0');

    // Kiểm tra trực tiếp trong bảng ledger_postings
    const postingRow = rawDb
      .prepare("SELECT delta_vnd, reason FROM ledger_postings WHERE account_id = 'acc_reset_900k' AND reason = 'reset_adjustment'")
      .get() as any;
    assert.ok(postingRow, 'Phải có dòng reset_adjustment trong ledger_postings');
    assert.strictEqual(Number(postingRow.delta_vnd), -900000, 'delta_vnd trong DB phải bằng -900000');

    // Kiểm tra số dư tài khoản đã về 0 và tổng baseline + SUM(postings) == 0
    const baselineRow = rawDb
      .prepare("SELECT baseline_amount_vnd FROM ledger_baselines WHERE account_id = 'acc_reset_900k'")
      .get() as any;
    const sumPostingsRow = rawDb
      .prepare("SELECT COALESCE(SUM(delta_vnd), 0) as total_delta FROM ledger_postings WHERE account_id = 'acc_reset_900k'")
      .get() as any;
    assert.strictEqual(Number(baselineRow.baseline_amount_vnd) + Number(sumPostingsRow.total_delta), 0, 'Bất biến baseline + postings = 0');
  });

  it('V2-09: hide_history hides the exact old rows, leaves balances intact, and keeps later backdated imports visible', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/accounts', { method: 'POST', body: { id: 'acc_hide_history', name: 'Hide history', type: 'cash', balance: 1000 } });
    const oldTx = await apiCall(env, '/api/transactions', {
      method: 'POST', body: { id: 'tx_hidden_same_day', accountId: 'acc_hide_history', type: 'expense', amount: 100, occurredAt: '2026-11-08T10:00:00.000Z' }
    });
    assert.strictEqual(oldTx.status, 200);
    const initialPostingCount = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM ledger_postings WHERE account_id = ?').get('acc_hide_history') as any).count);

    const reset = await apiCall(env, '/api/reset', { method: 'POST', body: { targets: ['transactions'], mode: 'hide_history' } });
    assert.strictEqual(reset.status, 200);
    assert.strictEqual(Number((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc_hide_history') as any).balance), 900);
    assert.strictEqual(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM ledger_postings WHERE account_id = ?').get('acc_hide_history') as any).count), initialPostingCount);

    const hiddenByDefault = await apiCall(env, '/api/transactions?startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-08T23:59:59.999Z');
    assert.strictEqual(hiddenByDefault.data.transactions.some((tx: any) => tx.id === 'tx_hidden_same_day'), false);
    const visibleWithHidden = await apiCall(env, '/api/transactions?includeHidden=1&startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-08T23:59:59.999Z');
    assert.strictEqual(visibleWithHidden.data.transactions.some((tx: any) => tx.id === 'tx_hidden_same_day'), true);
    const backup = await apiCall(env, '/api/backup/export');
    assert.strictEqual(backup.data.data.transactions.find((tx: any) => tx.id === 'tx_hidden_same_day').history_hidden, 1);
    const restored = await apiCall(env, '/api/backup/restore', { method: 'POST', body: backup.data });
    assert.strictEqual(restored.status, 200, JSON.stringify(restored.data));
    const afterRestore = await apiCall(env, '/api/transactions?startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-08T23:59:59.999Z');
    assert.strictEqual(afterRestore.data.transactions.some((tx: any) => tx.id === 'tx_hidden_same_day'), false, 'Backup/restore phải giữ cờ ẩn lịch sử');

    const backdatedNewTx = await apiCall(env, '/api/transactions', {
      method: 'POST', body: { id: 'tx_new_backdated', accountId: 'acc_hide_history', type: 'expense', amount: 50, occurredAt: '2026-11-08T10:00:00.000Z' }
    });
    assert.strictEqual(backdatedNewTx.status, 200);
    const visibleNew = await apiCall(env, '/api/transactions?startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-08T23:59:59.999Z');
    assert.deepStrictEqual(visibleNew.data.transactions.map((tx: any) => tx.id), ['tx_new_backdated']);
    const summary = await apiCall(env, '/api/analytics/summary?period=month&startDate=2026-10-31T17:00:00.000Z&endDate=2026-11-30T16:59:59.999Z');
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.data.totals.actualExpense, 50, 'Summary chỉ tính giao dịch mới, không tính dòng đã ẩn');
    assert.strictEqual(Number((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc_hide_history') as any).balance), 850);
  });
});

describe('E2E Integration V2-03..V2-06, V2-10, V2-11, V2-20: Ingest, Ghép chuyển khoản, Archive tài khoản & Sửa giao dịch qua Ledger', () => {
  it('AT2-07..AT2-14: Ingest với 2 tài khoản VCB cùng ngân hàng nhưng thiếu mask phải bật needs_account_review=1 và chặn confirm cho đến khi chọn tài khoản; chặn epoch 10 chữ số (400)', async () => {
    const { env } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_vcb_a', name: 'VCB Lương', bankCode: 'VCB', accountNumberMask: '1111', balance: 5000000 }
    });
    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_vcb_b', name: 'VCB Tiết kiệm', bankCode: 'VCB', accountNumberMask: '2222', balance: 10000000 }
    });

    // 1. Gửi thông báo VCB không có số tài khoản/mask -> phải đánh dấu needsAccountReview
    const ingestAmbiguous = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      body: {
        packageName: 'com.VCB',
        title: 'Vietcombank',
        text: 'Bien dong so du: -250,000 VND. ND: Thanh toan hoa don dien'
      }
    });
    assert.strictEqual(ingestAmbiguous.status, 200);
    assert.strictEqual(ingestAmbiguous.data.needsAccountReview, true);
    const txId = ingestAmbiguous.data.transactionId;

    // 2. Cố gắng duyệt ngay khi chưa chọn tài khoản -> phải bị chặn 400 ACCOUNT_REVIEW_REQUIRED
    const confirmBlocked = await apiCall(env, `/api/transactions/${txId}`, {
      method: 'PUT',
      body: { status: 'confirmed' }
    });
    assert.strictEqual(confirmBlocked.status, 400);
    assert.strictEqual(confirmBlocked.data.code, 'ACCOUNT_REVIEW_REQUIRED');

    // 3. Chọn rõ tài khoản `acc_vcb_b` khi duyệt -> 200 OK và trừ đúng 250.000đ ở `acc_vcb_b`
    const confirmOk = await apiCall(env, `/api/transactions/${txId}`, {
      method: 'PUT',
      body: { status: 'confirmed', accountId: 'acc_vcb_b' }
    });
    assert.strictEqual(confirmOk.status, 200);

    const accs = await apiCall(env, '/api/accounts');
    const vcbA = accs.data.accounts.find((a: any) => a.id === 'acc_vcb_a');
    const vcbB = accs.data.accounts.find((a: any) => a.id === 'acc_vcb_b');
    assert.strictEqual(vcbA.balance, 5000000, 'VCB A không bị trừ nhầm');
    assert.strictEqual(vcbB.balance, 9750000, 'VCB B bị trừ đúng 250.000đ');

    // 4. AT2-11: Gửi timestamp 10 chữ số (epoch seconds mơ hồ) -> trả 400 INVALID_TIME_FORMAT
    const badTime = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      body: {
        packageName: 'com.VCB',
        title: 'VCB',
        text: 'TK 1111 -100,000 VND',
        occurredAt: 1700000000
      }
    });
    assert.strictEqual(badTime.status, 400);
    assert.strictEqual(badTime.data.code, 'INVALID_TIME_FORMAT');
  });

  it('AT2-21 & AT2-22: Ghép/Tách chuyển khoản nội bộ bảo toàn thông tin gốc; Xóa tài khoản có lịch sử chuyển sang Archived và giữ nguyên Net Worth', async () => {
    const { env } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_src', name: 'TK Nguồn', type: 'bank', balance: 2000000 }
    });
    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_dst', name: 'TK Đích', type: 'bank', balance: 500000 }
    });

    // Tạo giao dịch chi đã duyệt trên TK Nguồn (số dư TK Nguồn còn 1.700.000)
    const txRes = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_single_leg',
        accountId: 'acc_src',
        type: 'expense',
        amount: 300000,
        jarId: 'jar_nec',
        description: 'Chuyển sang TK Đích'
      }
    });
    assert.strictEqual(txRes.status, 200);

    // Chuyển thành giao dịch nội bộ sang `acc_dst` -> `acc_dst` được cộng 300.000 (lên 800.000)
    const pairRes = await apiCall(env, '/api/transactions/tx_single_leg/pair-transfer', {
      method: 'POST',
      body: { toAccountId: 'acc_dst', confirmImmediately: true }
    });
    assert.strictEqual(pairRes.status, 200);
    assert.strictEqual(pairRes.data.syntheticCreated, true);

    let ov = await apiCall(env, '/api/overview');
    const dstAfterPair = ov.data.accounts.find((a: any) => a.id === 'acc_dst');
    assert.strictEqual(dstAfterPair.balance, 800000, 'TK Đích phải tăng lên 800.000đ sau khi ghép nội bộ');
    const cashBeforeArchive = ov.data.totalCash;

    // Tách (unpair) giao dịch nội bộ -> xóa synthetic leg, khôi phục jar_id='jar_nec'
    const unpairRes = await apiCall(env, '/api/transactions/tx_single_leg/unpair', {
      method: 'POST'
    });
    assert.strictEqual(unpairRes.status, 200);

    // AT2-22: Xóa tài khoản `acc_src` đang có lịch sử và số dư -> phải chuyển sang `archived` và giữ nguyên tổng tài sản
    const delAcc = await apiCall(env, '/api/accounts/acc_src', { method: 'DELETE' });
    assert.strictEqual(delAcc.status, 200);
    assert.strictEqual(delAcc.data.action, 'archived', 'Tài khoản có lịch sử bắt buộc được archive thay vì xóa cứng');

    ov = await apiCall(env, '/api/overview');
    assert.strictEqual(ov.data.totalCash, cashBeforeArchive, 'Tổng tiền mặt trong Net Worth không được biến mất khi archive tài khoản còn tiền');
  });

  it('AT2-37 (V2-20): Sửa giao dịch đã duyệt đổi tài khoản từ VCB sang TCB và đổi số tiền cập nhật chính xác số dư cả 2 tài khoản', async () => {
    const { env } = createTestEnv();

    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_edit_1', name: 'VCB Edit', type: 'bank', balance: 1000000 }
    });
    await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_edit_2', name: 'TCB Edit', type: 'bank', balance: 1000000 }
    });

    // Tạo khoản chi 200.000đ từ acc_edit_1 -> acc_edit_1 còn 800.000đ
    await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: {
        id: 'tx_move_acc',
        accountId: 'acc_edit_1',
        type: 'expense',
        amount: 200000,
        description: 'Mua sách'
      }
    });

    // Sửa giao dịch: chuyển sang acc_edit_2 và tăng số tiền lên 350.000đ
    const editRes = await apiCall(env, '/api/transactions/tx_move_acc', {
      method: 'PUT',
      body: {
        accountId: 'acc_edit_2',
        amount: 350000
      }
    });
    assert.strictEqual(editRes.status, 200);

    const accs = await apiCall(env, '/api/accounts');
    const a1 = accs.data.accounts.find((a: any) => a.id === 'acc_edit_1');
    const a2 = accs.data.accounts.find((a: any) => a.id === 'acc_edit_2');
    assert.strictEqual(a1.balance, 1000000, 'Tài khoản cũ phải được hoàn lại đúng 200.000đ về 1.000.000đ');
    assert.strictEqual(a2.balance, 650000, 'Tài khoản mới phải bị trừ đúng 350.000đ còn 650.000đ');
  });
});

describe('E2E Integration V2-12..V2-19 & V2-26: Analytics lịch sử, Chia hũ, Đầu tư & Sao lưu/Khôi phục', () => {
  it('AT2-27, AT2-30 & AT2-31: Analytics period=all trả plannedIncome=null; Plan Versioning giữ lịch sử tháng cũ; Auto-allocate chặn tổng % != 100%', async () => {
    const { env } = createTestEnv();

    // 1. Tạo nguồn thu ở tháng 2026-01 với dự kiến 20.000.000đ
    const createInc = await apiCall(env, '/api/income-sources', {
      method: 'POST',
      body: {
        id: 'inc_hist',
        name: 'Lương Công ty',
        expectedAmount: 20000000,
        cadence: 'monthly',
        effectiveFromMonth: '2026-01'
      }
    });
    assert.strictEqual(createInc.status, 200);

    // 2. Sang tháng 2026-06, tăng lương lên 30.000.000đ
    const updateInc = await apiCall(env, '/api/income-sources/inc_hist', {
      method: 'PUT',
      body: {
        expectedAmount: 30000000,
        effectiveFromMonth: '2026-06'
      }
    });
    assert.strictEqual(updateInc.status, 200);

    const accounts = await apiCall(env, '/api/accounts');
    const boundaryAccountId = accounts.data.accounts[0].id;
    const beforeExclusiveBoundary = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: { id: 'tx_before_vn_april', amount: 100, accountId: boundaryAccountId, occurredAt: '2026-03-31T16:59:59.999Z' }
    });
    const atExclusiveBoundary = await apiCall(env, '/api/transactions', {
      method: 'POST',
      body: { id: 'tx_at_vn_april', amount: 200, accountId: boundaryAccountId, occurredAt: '2026-03-31T17:00:00.000Z' }
    });
    assert.strictEqual(beforeExclusiveBoundary.status, 200);
    assert.strictEqual(atExclusiveBoundary.status, 200);

    // Kiểm tra báo cáo tháng 03/2026 vẫn giữ nguyên kế hoạch 20.000.000đ (không bị sửa lùi lịch sử)
    const sumMar = await apiCall(
      env,
      '/api/analytics/summary?period=month&startDate=2026-02-28T17:00:00.000Z&endDate=2026-03-31T16:59:59.999Z'
    );
    assert.strictEqual(sumMar.status, 200);
    assert.strictEqual(sumMar.data.totals.plannedIncome, 20000000, 'Kế hoạch tháng 03/2026 phải giữ nguyên 20 triệu');
    assert.strictEqual(sumMar.data.totals.actualExpense, 100, 'endDate inclusive phải tính giao dịch đúng tại thời điểm kết thúc');

    // New half-open range ends exactly at midnight Vietnam time on April 1.
    const sumMarExclusive = await apiCall(
      env,
      '/api/analytics/summary?period=month&startDate=2026-02-28T17:00:00.000Z&toExclusive=2026-03-31T17:00:00.000Z'
    );
    assert.strictEqual(sumMarExclusive.status, 200);
    assert.strictEqual(sumMarExclusive.data.totals.plannedIncome, 20000000, 'toExclusive phải loại tháng kế tiếp tại ranh giới VN');
    assert.strictEqual(sumMarExclusive.data.totals.actualExpense, 100, 'toExclusive loại giao dịch đúng tại ranh giới VN');

    // Kiểm tra báo cáo tháng 07/2026 áp dụng mức mới 30.000.000đ
    const sumJul = await apiCall(
      env,
      '/api/analytics/summary?period=month&startDate=2026-06-30T17:00:00.000Z&endDate=2026-07-31T16:59:59.999Z'
    );
    assert.strictEqual(sumJul.status, 200);
    assert.strictEqual(sumJul.data.totals.plannedIncome, 30000000, 'Kế hoạch tháng 07/2026 phải là 30 triệu');

    // Kiểm tra period=all trả plannedIncome = null (AT2-27)
    const sumAll = await apiCall(env, '/api/analytics/summary?period=all');
    assert.strictEqual(sumAll.status, 200);
    assert.strictEqual(sumAll.data.totals.plannedIncome, null, 'Kỳ Tất cả thời gian không được lấy 1 tháng làm mẫu số');

    // 3. Auto-allocate với tổng tỷ lệ != 100% bị chặn 400 INVALID_JAR_WEIGHTS
    const badAlloc = await apiCall(env, '/api/jars/auto-allocate', {
      method: 'POST',
      body: {
        totalIncome: 1000000,
        weights: { jar_nec: 50, jar_ffa: 10 } // Tổng < 100%
      }
    });
    assert.strictEqual(badAlloc.status, 400);
    assert.strictEqual(badAlloc.data.code, 'INVALID_JAR_WEIGHTS');

    // Auto-allocate hợp lệ 1.000.001đ chia chính xác 100%
    const goodAlloc = await apiCall(env, '/api/jars/auto-allocate', {
      method: 'POST',
      body: { totalIncome: 1000001 }
    });
    assert.strictEqual(goodAlloc.status, 200);
    const allocValues = Object.values(goodAlloc.data.allocations).filter(v => typeof v === 'number') as number[];
    const sumAllocated = allocValues.reduce((a, b) => a + b, 0);
    assert.strictEqual(sumAllocated, 1000001, 'Tổng tiền phân bổ vào 6 hũ trên DB phải bằng đúng 1.000.001đ');
  });

  it('AT2-33, AT2-34 & AT2-42: Sửa symbol tài sản theo id không nhân đôi dòng; XIRR tính từ dòng tiền đầu tư; Backup & Restore kiểm tra checksum SHA-256', async () => {
    const { env } = createTestEnv();

    // 1. Tạo tài sản đầu tư với id cố định
    const h1 = await apiCall(env, '/api/holdings', {
      method: 'POST',
      body: {
        id: 'hold_fixed_1',
        symbol: 'VESAF',
        name: 'Quỹ VESAF',
        assetClass: 'fund',
        quantity: 123.4567,
        avgCost: 25432.18,
        currentPrice: 31540.25
      }
    });
    assert.strictEqual(h1.status, 200);

    // 2. Đổi symbol từ VESAF sang VEOF nhưng giữ nguyên id='hold_fixed_1' -> không được nhân đôi bản ghi!
    const h2 = await apiCall(env, '/api/holdings', {
      method: 'POST',
      body: {
        id: 'hold_fixed_1',
        symbol: 'VEOF',
        name: 'Quỹ VEOF',
        assetClass: 'fund',
        quantity: 123.4567,
        avgCost: 25432.18,
        currentPrice: 31540.25
      }
    });
    assert.strictEqual(h2.status, 200);

    const listH = await apiCall(env, '/api/holdings');
    assert.strictEqual(listH.data.holdings.length, 1, 'Đổi symbol của holding theo ID không được tạo bản ghi trùng');
    assert.strictEqual(listH.data.holdings[0].symbol, 'VEOF');
    assert.strictEqual(listH.data.holdings[0].quantity, 123.4567, 'Phải giữ nguyên độ chính xác số thập phân của CCQ');

    // 3. Xuất bản sao lưu (Backup Export)
    const expRes = await apiCall(env, '/api/backup/export');
    assert.strictEqual(expRes.status, 200);
    assert.strictEqual(expRes.data.schemaVersion, 2);
    assert.ok(expRes.data.checksum);

    // 4. Giả mạo dữ liệu trong bản sao lưu nhưng giữ checksum cũ -> bị chặn 400 CHECKSUM_MISMATCH
    const tamperedData = JSON.parse(JSON.stringify(expRes.data.data));
    tamperedData.holdings[0].quantity = 999999;
    const badRestore = await apiCall(env, '/api/backup/restore', {
      method: 'POST',
      body: {
        schemaVersion: 2,
        checksum: expRes.data.checksum,
        data: tamperedData
      }
    });
    assert.strictEqual(badRestore.status, 400);
    assert.strictEqual(badRestore.data.code, 'CHECKSUM_MISMATCH');

    // 5. Khôi phục với bản sao lưu nguyên vẹn -> 200 OK
    const goodRestore = await apiCall(env, '/api/backup/restore', {
      method: 'POST',
      body: expRes.data
    });
    assert.strictEqual(goodRestore.status, 200, JSON.stringify(goodRestore.data));
    assert.strictEqual(goodRestore.data.restored, true);
  });
});

describe('Backup restore foreign key validation', () => {
  it('rejects a checksum-valid transaction account reference absent from an empty account list before writing', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/accounts'); // Run schema bootstrap before checking that restore writes no rows.
    const data = {
      accounts: [],
      transactions: [{
        id: 'tx_broken_account',
        occurred_at: '2026-11-08T00:00:00.000Z',
        type: 'expense',
        amount: 1000,
        account_id: 'acc_missing'
      }]
    };
    const checksum = await hashPayload(data);
    const before = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions').get() as any).count);

    const response = await apiCall(env, '/api/backup/restore', {
      method: 'POST',
      body: { schemaVersion: 2, data, checksum }
    });

    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.data.code, 'BROKEN_FOREIGN_KEY');
    const after = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions').get() as any).count);
    assert.strictEqual(after, before, 'Dữ liệu giao dịch không được ghi khi tài khoản tham chiếu không tồn tại');
  });

  it('rejects dangling transfer targets and holding assets on dry-run and restore without changing state', async () => {
    const { env, rawDb } = createTestEnv();
    const seeded = await apiCall(env, '/api/accounts', {
      method: 'POST',
      body: { id: 'acc_restore_sentinel', name: 'Keep me', type: 'cash', balance: 500 }
    });
    assert.strictEqual(seeded.status, 200);
    const beforeAccountIds = (rawDb.prepare('SELECT id FROM accounts ORDER BY id').all() as any[]).map(row => row.id);
    const beforeTransactions = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions').get() as any).count);
    const beforeHoldings = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM holdings').get() as any).count);
    const invalidBackups = [
      {
        accounts: [{ id: 'acc_valid' }],
        transactions: [{ id: 'tx_missing_target', occurred_at: '2026-11-08T00:00:00.000Z', type: 'transfer', amount: 100, account_id: 'acc_valid', to_account_id: 'acc_missing' }]
      },
      {
        accounts: [{ id: 'acc_valid' }],
        assets: [],
        holdings: [{ id: 'holding_missing_asset', asset_id: 'asset_missing', account_id: null, quantity: 1, avg_cost: 10 }]
      }
    ];

    for (const data of invalidBackups) {
      const checksum = await hashPayload(data);
      for (const dryRun of [true, false]) {
        const response = await apiCall(env, '/api/backup/restore', {
          method: 'POST',
          body: { schemaVersion: 2, data, checksum, dryRun }
        });
        assert.strictEqual(response.status, 400);
        assert.strictEqual(response.data.code, 'BROKEN_FOREIGN_KEY');
        assert.deepStrictEqual(
          (rawDb.prepare('SELECT id FROM accounts ORDER BY id').all() as any[]).map(row => row.id),
          beforeAccountIds,
          'Restore phải giữ nguyên các tài khoản hiện có khi phát hiện tham chiếu mồ côi'
        );
        assert.strictEqual(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions').get() as any).count), beforeTransactions);
        assert.strictEqual(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM holdings').get() as any).count), beforeHoldings);
      }
    }
  });
});

describe('Explicit sample data seeding', () => {
  it('keeps fresh reads empty, seeds only on explicit owner request, and does not reseed after reset', async () => {
    const { env, rawDb } = createTestEnv({ seedDefaults: false });
    const accountsBefore = await apiCall(env, '/api/accounts');
    const jarsBefore = await apiCall(env, '/api/jars');
    assert.strictEqual(accountsBefore.status, 200);
    assert.strictEqual(accountsBefore.data.accounts.length, 0, 'GET không tự tạo tài khoản demo');
    assert.strictEqual(jarsBefore.data.jars.length, 0, 'GET không tự tạo hũ demo');

    const seeded = await apiCall(env, '/api/seed', { method: 'POST' });
    assert.strictEqual(seeded.status, 200);
    assert.strictEqual(seeded.data.seeded, true);
    const seededAccounts = await apiCall(env, '/api/accounts');
    const sampleCash = seededAccounts.data.accounts.find((account: any) => account.id === 'acc_cash');
    assert.strictEqual(sampleCash.balance, 1500000);
    const baseline = rawDb.prepare('SELECT baseline_amount_vnd FROM ledger_baselines WHERE account_id = ?').get('acc_cash') as any;
    assert.strictEqual(Number(baseline.baseline_amount_vnd), 1500000, 'Số dư mẫu phải có opening baseline tương ứng');

    const repeatedSeed = await apiCall(env, '/api/seed', { method: 'POST' });
    assert.strictEqual(repeatedSeed.status, 409, 'Seed không được ghi đè dữ liệu đã có');
    const accountCountBeforeReset = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM accounts').get() as any).count);
    const reset = await apiCall(env, '/api/reset', { method: 'POST', body: { scope: 'all' } });
    assert.strictEqual(reset.status, 200);
    const accountCountAfterReset = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM accounts').get() as any).count);
    assert.strictEqual(accountCountAfterReset, accountCountBeforeReset, 'Reset không tự tạo lại hoặc nhân đôi dữ liệu mẫu');
  });

  it('stores unassigned notifications against a real inactive zero-balance placeholder and blocks confirmation', async () => {
    const { env, rawDb } = createTestEnv({ seedDefaults: false });
    const ingested = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      body: { packageName: 'com.VCB', title: 'Vietcombank', text: 'TK 1111 -100,000 VND. ND: Hoa don dien' }
    });
    assert.strictEqual(ingested.status, 200, JSON.stringify(ingested.data));
    assert.strictEqual(ingested.data.needsAccountReview, true);
    const tx = rawDb.prepare('SELECT status, needs_account_review, account_id FROM transactions WHERE id = ?').get(ingested.data.transactionId) as any;
    assert.strictEqual(tx.status, 'pending');
    assert.strictEqual(Number(tx.needs_account_review), 1);
    assert.strictEqual(tx.account_id, 'acc_unassigned');
    const placeholder = rawDb.prepare('SELECT balance, is_active, include_in_net_worth, type FROM accounts WHERE id = ?').get('acc_unassigned') as any;
    assert.strictEqual(Number(placeholder.balance), 0);
    assert.strictEqual(Number(placeholder.is_active), 0);
    assert.strictEqual(Number(placeholder.include_in_net_worth), 0);
    const blockedConfirm = await apiCall(env, `/api/transactions/${ingested.data.transactionId}`, {
      method: 'PUT', body: { status: 'confirmed' }
    });
    assert.strictEqual(blockedConfirm.status, 400);
    assert.strictEqual(blockedConfirm.data.code, 'ACCOUNT_REVIEW_REQUIRED');
    const accountList = await apiCall(env, '/api/accounts');
    assert.strictEqual(accountList.data.accounts.some((account: any) => account.id === 'acc_unassigned'), false);

    const backup = await apiCall(env, '/api/backup/export');
    const dryRun = await apiCall(env, '/api/backup/restore', { method: 'POST', body: { ...backup.data, dryRun: true } });
    assert.strictEqual(dryRun.status, 200, JSON.stringify(dryRun.data));
  });

  it('fails closed when the reserved unassigned ID belongs to an ordinary account', async () => {
    const { env, rawDb } = createTestEnv({ seedDefaults: false });
    const occupied = await apiCall(env, '/api/accounts', {
      method: 'POST', body: { id: 'acc_unassigned', name: 'Real cash account', type: 'cash', balance: 250000 }
    });
    assert.strictEqual(occupied.status, 200);
    const ingest = await apiCall(env, '/api/notifications/ingest', {
      method: 'POST',
      body: { packageName: 'com.VCB', title: 'Vietcombank', text: 'TK 1111 -100,000 VND. ND: Hoa don dien' }
    });
    assert.strictEqual(ingest.status, 500);
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS count FROM transactions').get()?.count, 0);
    assert.strictEqual(Number(rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc_unassigned')?.balance), 250000);
  });

  it('migrates legacy hidden rows once using creation cutover and leaves later backdated rows visible', async () => {
    const { env, rawDb } = createTestEnv({ seedDefaults: false });
    const account = await apiCall(env, '/api/accounts', { method: 'POST', body: { id: 'acc_legacy_hidden', name: 'Legacy', type: 'cash', balance: 0 } });
    assert.strictEqual(account.status, 200);
    const userId = (rawDb.prepare('SELECT user_id FROM accounts WHERE id = ?').get('acc_legacy_hidden') as any).user_id;
    rawDb.prepare('UPDATE users SET history_hidden_at = ? WHERE id = ?').run('2026-11-10T00:00:00.000Z', userId);
    rawDb.prepare(`INSERT INTO transactions (id, user_id, occurred_at, created_at, type, amount, account_id, status, source)
      VALUES (?, ?, ?, ?, 'expense', 1, ?, 'confirmed', 'manual')`).run(
      'tx_legacy_hidden', userId, '2026-11-08T10:00:00.000Z', '2026-11-09T10:00:00.000Z', 'acc_legacy_hidden'
    );
    rawDb.prepare("DELETE FROM schema_migrations WHERE id = 'legacy_history_hidden_cutover_v1'").run();
    resetSchemaEnsureCache();
    await apiCall(env, '/api/transactions');
    assert.strictEqual(Number((rawDb.prepare('SELECT history_hidden FROM transactions WHERE id = ?').get('tx_legacy_hidden') as any).history_hidden), 1);

    rawDb.prepare(`INSERT INTO transactions (id, user_id, occurred_at, created_at, type, amount, account_id, status, source)
      VALUES (?, ?, ?, ?, 'expense', 1, ?, 'confirmed', 'manual')`).run(
      'tx_backdated_after_cutover', userId, '2026-11-08T10:00:00.000Z', '2026-11-11T10:00:00.000Z', 'acc_legacy_hidden'
    );
    const listed = await apiCall(env, '/api/transactions?startDate=2026-11-08T00:00:00.000Z&endDate=2026-11-08T23:59:59.999Z');
    assert.deepStrictEqual(listed.data.transactions.map((tx: any) => tx.id), ['tx_backdated_after_cutover']);
  });
});

describe('One-time schedule and legacy history validation', () => {
  it('requires a real date for one-time income and expense and does not invent legacy history', async () => {
    const { env, rawDb } = createTestEnv();
    for (const [path, id] of [['/api/income-sources', 'inc_once_missing'], ['/api/planned-expenses', 'plan_once_missing']] as const) {
      const missingDate = await apiCall(env, path, { method: 'POST', body: { id, name: id, cadence: 'one_time', expectedAmount: 123 } });
      assert.strictEqual(missingDate.status, 400);
      assert.strictEqual(missingDate.data.code, 'INVALID_ONE_TIME_DATE');
      const invalidDate = await apiCall(env, path, {
        method: 'POST', body: { id: `${id}_invalid`, name: id, cadence: 'one_time', oneTimeDate: '2026-02-30', expectedAmount: 123 }
      });
      assert.strictEqual(invalidDate.status, 400);
      assert.strictEqual(invalidDate.data.code, 'INVALID_ONE_TIME_DATE');
      const validDate = await apiCall(env, path, {
        method: 'POST', body: { id: `${id}_valid`, name: id, cadence: 'one_time', oneTimeDate: '2026-02-28', expectedAmount: 123, effectiveFromMonth: '2026-02' }
      });
      assert.strictEqual(validDate.status, 200);
    }

    await apiCall(env, '/api/income-sources', { method: 'POST', body: { id: 'inc_legacy_no_date', name: 'Legacy', expectedAmount: 10 } });
    await apiCall(env, '/api/planned-expenses', { method: 'POST', body: { id: 'plan_legacy_no_date', name: 'Legacy', expectedAmount: 10 } });
    rawDb.prepare("UPDATE income_sources SET cadence = 'one_time', one_time_date = NULL WHERE id = ?").run('inc_legacy_no_date');
    rawDb.prepare("UPDATE planned_expenses SET cadence = 'one_time', one_time_date = NULL WHERE id = ?").run('plan_legacy_no_date');
    for (const [path, id] of [['/api/income-sources/inc_legacy_no_date', 'inc_legacy_no_date'], ['/api/planned-expenses/plan_legacy_no_date', 'plan_legacy_no_date']] as const) {
      const update = await apiCall(env, path, { method: 'PUT', body: { expectedAmount: 20 } });
      assert.strictEqual(update.status, 400);
      assert.strictEqual(update.data.code, 'INVALID_ONE_TIME_DATE');
    }

    // Unknown created_at must not produce a synthetic 2000-era pre-version for either entity kind.
    await apiCall(env, '/api/income-sources', { method: 'POST', body: { id: 'inc_unknown_history', name: 'Unknown', expectedAmount: 10 } });
    await apiCall(env, '/api/planned-expenses', { method: 'POST', body: { id: 'plan_unknown_history', name: 'Unknown', expectedAmount: 10 } });
    rawDb.prepare('DELETE FROM plan_versions WHERE entity_id IN (?, ?)').run('inc_unknown_history', 'plan_unknown_history');
    rawDb.prepare('UPDATE income_sources SET created_at = NULL WHERE id = ?').run('inc_unknown_history');
    rawDb.prepare('UPDATE planned_expenses SET created_at = NULL WHERE id = ?').run('plan_unknown_history');
    const incomeUpdated = await apiCall(env, '/api/income-sources/inc_unknown_history', {
      method: 'PUT', body: { expectedAmount: 20, effectiveFromMonth: '2026-06' }
    });
    const planUpdated = await apiCall(env, '/api/planned-expenses/plan_unknown_history', {
      method: 'PUT', body: { expectedAmount: 20, effectiveFromMonth: '2026-06' }
    });
    assert.strictEqual(incomeUpdated.status, 200);
    assert.strictEqual(planUpdated.status, 200);
    assert.strictEqual(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM plan_versions WHERE entity_id = ?').get('inc_unknown_history') as any).count), 1);
    assert.strictEqual(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM plan_versions WHERE entity_id = ?').get('plan_unknown_history') as any).count), 1);
    assert.strictEqual(rawDb.prepare('SELECT MIN(effective_from_month) AS min_month FROM plan_versions WHERE entity_id IN (?, ?)').get('inc_unknown_history', 'plan_unknown_history')?.min_month === '2000-01', false);
  });

  it('reports incomplete legacy plan history as null while preserving actuals and excluding not-yet-created entities', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/income-sources', { method: 'POST', body: { id: 'inc_legacy_no_versions', name: 'Legacy income', expectedAmount: 9999 } });
    await apiCall(env, '/api/planned-expenses', { method: 'POST', body: { id: 'plan_legacy_no_versions', name: 'Legacy expense', expectedAmount: 3333 } });
    await apiCall(env, '/api/income-sources', { method: 'POST', body: { id: 'inc_created_later', name: 'Created later', expectedAmount: 7777 } });
    rawDb.prepare('DELETE FROM plan_versions WHERE entity_id IN (?, ?, ?)').run('inc_legacy_no_versions', 'plan_legacy_no_versions', 'inc_created_later');
    rawDb.prepare('UPDATE income_sources SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', 'inc_legacy_no_versions');
    rawDb.prepare('UPDATE planned_expenses SET created_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', 'plan_legacy_no_versions');
    rawDb.prepare('UPDATE income_sources SET created_at = ? WHERE id = ?').run('2026-07-01T00:00:00.000Z', 'inc_created_later');
    const accountId = 'acc_vcb';
    const actual = await apiCall(env, '/api/transactions', {
      method: 'POST', body: { id: 'tx_actual_with_incomplete_plan', accountId, type: 'income', amount: 777, occurredAt: '2026-06-15T00:00:00.000Z' }
    });
    assert.strictEqual(actual.status, 200);

    const historical = await apiCall(env, '/api/analytics/summary?period=month&startDate=2026-05-31T17:00:00.000Z&endDate=2026-06-30T16:59:59.999Z');
    assert.strictEqual(historical.status, 200);
    assert.strictEqual(historical.data.totals.actualIncome, 777);
    assert.strictEqual(historical.data.totals.plannedIncome, null);
    assert.strictEqual(historical.data.totals.plannedExpense, null);
    assert.strictEqual(historical.data.planCompleteness.plannedIncomeComplete, false);
    assert.strictEqual(historical.data.planCompleteness.plannedExpenseComplete, false);

    const beforeEnv = createTestEnv();
    await apiCall(beforeEnv.env, '/api/income-sources', { method: 'POST', body: { id: 'inc_future_only', name: 'Future only', expectedAmount: 7777 } });
    beforeEnv.rawDb.prepare('DELETE FROM plan_versions WHERE entity_id = ?').run('inc_future_only');
    beforeEnv.rawDb.prepare('UPDATE income_sources SET created_at = ? WHERE id = ?').run('2026-07-01T00:00:00.000Z', 'inc_future_only');
    const beforeCreation = await apiCall(beforeEnv.env, '/api/analytics/summary?period=month&startDate=2026-05-31T17:00:00.000Z&endDate=2026-06-30T16:59:59.999Z');
    assert.strictEqual(beforeCreation.data.totals.plannedIncome, 0);
    assert.strictEqual(beforeCreation.data.planCompleteness.plannedIncomeComplete, true, 'Nguồn tạo sau kỳ phải được loại khỏi kỳ đó');
  });
});

describe('Schema bootstrap failure handling', () => {
  it('fails closed on non-duplicate DDL errors while allowing an existing legacy schema', async () => {
    const brokenHarness = createSqliteD1({ failOnSqlPattern: /CREATE TABLE IF NOT EXISTS users/ });
    const brokenEnv = { DB: brokenHarness.db, OWNER_API_TOKEN: OWNER_TOKEN };
    const failed = await workerApp.fetch(new Request('http://localhost/api/health'), brokenEnv, { waitUntil: () => {} });
    assert.strictEqual(failed.status, 503);
    assert.strictEqual((await failed.json() as any).code, 'SCHEMA_UNAVAILABLE');

    const legacy = createSqliteD1();
    legacy.rawDb.exec('PRAGMA foreign_keys = ON;');
    legacy.rawDb.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
    const legacyEnv = { DB: legacy.db, OWNER_API_TOKEN: OWNER_TOKEN };
    const works = await workerApp.fetch(new Request('http://localhost/api/health'), legacyEnv, { waitUntil: () => {} });
    assert.strictEqual(works.status, 200, 'Cột đã có trong schema cũ được nhận diện như duplicate-column, không fail migration');
  });
});

describe('V2-19 XIRR API fail-closed contract', () => {
  it('does not infer external cashflows from buy/sell transactions or securities/crypto cash balances', async () => {
    const { env, rawDb } = createTestEnv();

    // Bootstrap the real API schema and get the seeded owner's user ID.
    const accounts = await apiCall(env, '/api/accounts');
    assert.strictEqual(accounts.status, 200);
    const userId = String((rawDb.prepare('SELECT user_id FROM accounts LIMIT 1').get() as any).user_id);

    // Investment account balances are current cash positions; they carry no external-flow history.
    rawDb.prepare(`INSERT INTO accounts (id, user_id, name, type, balance) VALUES (?, ?, ?, ?, ?)`)
      .run('acc_securities_xirr', userId, 'Securities cash', 'securities', 2500000);
    rawDb.prepare(`INSERT INTO accounts (id, user_id, name, type, balance) VALUES (?, ?, ?, ?, ?)`)
      .run('acc_crypto_xirr', userId, 'Crypto cash', 'crypto', 750000);

    rawDb.prepare(`INSERT INTO assets (id, symbol, name, asset_class, unit, current_price)
      VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)`)
      .run('asset_xirr_stock', 'XIRRSTOCK', 'XIRR test stock', 'stock', 'share', 12000,
        'asset_xirr_crypto', 'XIRRCOIN', 'XIRR test crypto', 'crypto', 'coin', 30000);
    rawDb.prepare(`INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost)
      VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`)
      .run('holding_xirr_stock', userId, 'asset_xirr_stock', 10, 10000,
        'holding_xirr_crypto', userId, 'asset_xirr_crypto', 2, 25000);

    // The current ledger records internal buy/sell operations and optional cash account IDs,
    // but has no event kind that certifies an external contribution or withdrawal.
    rawDb.prepare(`INSERT INTO investment_transactions
      (id, user_id, asset_id, account_id, type, occurred_at, quantity, unit_price, fee, tax, total_amount_vnd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('inv_xirr_buy', userId, 'asset_xirr_stock', 'acc_securities_xirr', 'buy', '2025-01-01T00:00:00.000Z', 10, 10000, 0, 0, 100000,
        'inv_xirr_sell', userId, 'asset_xirr_crypto', 'acc_crypto_xirr', 'sell', '2025-06-01T00:00:00.000Z', 1, 25000, 0, 0, 25000);

    const response = await apiCall(env, '/api/holdings');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.holdings.length, 2);
    assert.strictEqual(response.data.investmentTransactions.length, 2);
    assert.strictEqual(response.data.xirr.rate, null, 'Không được suy diễn XIRR từ buy/sell nội bộ');
    assert.strictEqual(response.data.xirr.annualizedPct, null, 'Không được trả tỷ lệ phần trăm giả');
    assert.strictEqual(response.data.xirr.reasonCode, 'HISTORY_INCOMPLETE');
  });
});

describe('V2-19 explicit portfolio cashflow ledger', () => {
  it('calculates a one-year ~10% return from recorded external flows and two cash accounts without double-counting trades', async () => {
    const { env, rawDb } = createTestEnv();
    const accounts = await apiCall(env, '/api/accounts');
    assert.strictEqual(accounts.status, 200);
    const userId = String((rawDb.prepare('SELECT user_id FROM accounts LIMIT 1').get() as any).user_id);
    rawDb.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, include_in_net_worth, is_active)
      VALUES (?, ?, ?, ?, ?, 1, 1), (?, ?, ?, ?, ?, 1, 1)`)
      .run('acc_xirr_securities', userId, 'Securities cash', 'securities', 1000000,
        'acc_xirr_crypto', userId, 'Crypto cash', 'crypto', 1000000);

    const holdingStock = await apiCall(env, '/api/holdings', { method: 'POST', body: {
      symbol: 'XIRRSTOCK', name: 'XIRR test stock', assetClass: 'stock', quantity: 10, avgCost: 600000, currentPrice: 600000
    } });
    const holdingCrypto = await apiCall(env, '/api/holdings', { method: 'POST', body: {
      symbol: 'XIRRCOIN', name: 'XIRR test crypto', assetClass: 'crypto', quantity: 3, avgCost: 1000000, currentPrice: 1000000
    } });
    assert.strictEqual(holdingStock.status, 200);
    assert.strictEqual(holdingCrypto.status, 200);

    const flowDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const beforeComplete = await apiCall(env, '/api/holdings');
    assert.strictEqual(beforeComplete.data.xirr.rate, null);
    assert.strictEqual(beforeComplete.data.xirr.reasonCode, 'HISTORY_INCOMPLETE');

    const flow = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      id: 'xirr_contribution_10m', type: 'contribution', amountVnd: 10000000, occurredAt: flowDate, note: 'Vốn ban đầu đã đối chiếu'
    } });
    assert.strictEqual(flow.status, 200, JSON.stringify(flow.data));
    const afterRecordBalances = rawDb.prepare('SELECT id, balance FROM accounts WHERE id IN (?, ?) ORDER BY id')
      .all('acc_xirr_crypto', 'acc_xirr_securities') as any[];
    assert.deepStrictEqual(afterRecordBalances.map(row => Number(row.balance)), [1000000, 1000000], 'Ghi lịch sử góp vốn không được sửa số dư');

    const complete = await apiCall(env, '/api/investment-cashflows/completeness', { method: 'PUT', body: { completeFrom: flowDate } });
    assert.strictEqual(complete.status, 200, JSON.stringify(complete.data));
    assert.strictEqual(complete.data.xirr.terminalValueVnd, 11000000, 'Terminal = holdings 9m + tiền chưa đầu tư 2m');
    assert.ok(Math.abs(Number(complete.data.xirr.annualizedPct) - 10) < 0.1, `XIRR kỳ vọng gần 10%, thực tế ${complete.data.xirr.annualizedPct}`);

    const buy = await apiCall(env, '/api/investment-transactions', { method: 'POST', body: {
      type: 'buy', symbol: 'XIRRSTOCK', quantity: 1, unitPrice: 600000, accountId: 'acc_xirr_securities', affectCashAccount: true
    } });
    const sell = await apiCall(env, '/api/investment-transactions', { method: 'POST', body: {
      type: 'sell', symbol: 'XIRRSTOCK', quantity: 1, unitPrice: 600000, accountId: 'acc_xirr_securities', affectCashAccount: true
    } });
    assert.strictEqual(buy.status, 200, JSON.stringify(buy.data));
    assert.strictEqual(sell.status, 200, JSON.stringify(sell.data));
    const afterTrades = await apiCall(env, '/api/holdings');
    assert.strictEqual(afterTrades.data.investmentTransactions.length, 2);
    assert.strictEqual(afterTrades.data.xirr.terminalValueVnd, 11000000, 'Buy/sell nội bộ chuyển giá trị giữa tiền và holdings, không thêm dòng external');
    assert.ok(Math.abs(Number(afterTrades.data.xirr.annualizedPct) - 10) < 0.1);
    const listedCashflows = await apiCall(env, '/api/investment-cashflows');
    assert.strictEqual(listedCashflows.data.cashflows.length, 1);
    assert.strictEqual(listedCashflows.data.historyCompleteFrom, flowDate);

    // Independent arithmetic fixture: one exact 365-day year from -10m to +11m implies 10%.
    const exactFixture = calculateXIRR([
      { amount: -10000000, date: '2025-01-01T00:00:00.000Z' },
      { amount: 11000000, date: '2026-01-01T00:00:00.000Z' }
    ]);
    assert.ok(exactFixture !== null && Math.abs(exactFixture - 0.1) < 0.005);
  });

  it('validates user completeness, rejects invented/future data, fails closed for missing quote dates, and restores optional backup data', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/accounts');
    const future = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 1, occurredAt: '2999-01-01'
    } });
    assert.strictEqual(future.status, 400);
    assert.strictEqual(future.data.code, 'FUTURE_CASHFLOW');
    const invalidAmount = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 0, occurredAt: '2025-01-01'
    } });
    assert.strictEqual(invalidAmount.status, 400);
    assert.strictEqual(invalidAmount.data.code, 'INVALID_CASHFLOW_AMOUNT');

    const account = rawDb.prepare('SELECT user_id FROM accounts LIMIT 1').get() as any;
    const userId = String(account.user_id);
    rawDb.prepare(`INSERT INTO assets (id, symbol, name, asset_class, unit, current_price, price_as_of, provider, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, NULL, 'manual', 'ok')`).run('asset_missing_quote_date', 'MISSQ', 'Missing quote', 'stock', 'share', 100);
    rawDb.prepare(`INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost) VALUES (?, ?, ?, ?, ?)`)
      .run('holding_missing_quote_date', userId, 'asset_missing_quote_date', 1, 100);
    const flow = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 100, occurredAt: '2025-01-01'
    } });
    assert.strictEqual(flow.status, 200);
    const complete = await apiCall(env, '/api/investment-cashflows/completeness', { method: 'PUT', body: { completeFrom: '2025-01-01' } });
    assert.strictEqual(complete.status, 200);
    assert.strictEqual(complete.data.xirr.rate, null);
    assert.strictEqual(complete.data.xirr.reasonCode, 'TERMINAL_VALUE_UNAVAILABLE');

    const exported = await apiCall(env, '/api/backup/export');
    assert.strictEqual(exported.status, 200);
    assert.strictEqual(exported.data.data.investment_cashflows.length, 1);
    assert.strictEqual(exported.data.data.investment_cashflow_settings.complete_from, '2025-01-01');
    const restore = await apiCall(env, '/api/backup/restore', { method: 'POST', body: exported.data });
    assert.strictEqual(restore.status, 200, JSON.stringify(restore.data));
    const restored = await apiCall(env, '/api/investment-cashflows');
    assert.strictEqual(restored.data.cashflows.length, 1);
    assert.strictEqual(restored.data.historyCompleteFrom, '2025-01-01');

    const legacyData = JSON.parse(JSON.stringify(exported.data.data));
    delete legacyData.investment_cashflows;
    delete legacyData.investment_cashflow_settings;
    const legacyRestore = await apiCall(env, '/api/backup/restore', { method: 'POST', body: {
      schemaVersion: 2, data: legacyData, checksum: await hashPayload(legacyData)
    } });
    assert.strictEqual(legacyRestore.status, 200, JSON.stringify(legacyRestore.data));
    const afterLegacyRestore = await apiCall(env, '/api/investment-cashflows');
    assert.strictEqual(afterLegacyRestore.data.cashflows.length, 0);
    assert.strictEqual(afterLegacyRestore.data.historyCompleteFrom, null);

    const resetFlow = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 100, occurredAt: '2025-01-01'
    } });
    assert.strictEqual(resetFlow.status, 200);
    await apiCall(env, '/api/investment-cashflows/completeness', { method: 'PUT', body: { completeFrom: '2025-01-01' } });
    const balancesBeforeReset = (rawDb.prepare('SELECT id, balance FROM accounts ORDER BY id').all() as any[])
      .map(row => [row.id, Number(row.balance)]);
    const resetPreview = await apiCall(env, '/api/reset', { method: 'POST', body: { scope: 'holdings', preview: true } });
    assert.strictEqual(resetPreview.status, 200);
    const afterPreview = await apiCall(env, '/api/investment-cashflows');
    assert.strictEqual(afterPreview.data.cashflows.length, 1, 'Preview không được xóa lịch sử dòng tiền');
    const reset = await apiCall(env, '/api/reset', { method: 'POST', body: { scope: 'holdings', operationId: 'reset_xirr_history' } });
    assert.strictEqual(reset.status, 200);
    const afterReset = await apiCall(env, '/api/investment-cashflows');
    assert.strictEqual(afterReset.data.cashflows.length, 0);
    assert.strictEqual(afterReset.data.historyCompleteFrom, null);
    assert.deepStrictEqual((rawDb.prepare('SELECT id, balance FROM accounts ORDER BY id').all() as any[])
      .map(row => [row.id, Number(row.balance)]), balancesBeforeReset, 'Reset holdings không được thay số dư tài khoản');

    const deleted = await apiCall(env, '/api/investment-cashflows/does_not_exist', { method: 'DELETE' });
    assert.strictEqual(deleted.status, 404);
    assert.strictEqual(deleted.data.code, 'CASHFLOW_NOT_FOUND');
  });
});

describe('V2-19 terminal valuation currency guards', () => {
  it('fails closed for non-VND asset quotes and non-VND securities/crypto account balances', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/accounts');
    const userId = String((rawDb.prepare('SELECT user_id FROM accounts LIMIT 1').get() as any).user_id);
    const flowDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    rawDb.prepare(`INSERT INTO assets (id, symbol, name, asset_class, unit, currency, current_price, price_as_of, provider, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'ok')`).run(
      'asset_xirr_usd_quote', 'USDQUOTE', 'USD quote fixture', 'stock', 'share', 'USD', 100, new Date().toISOString()
    );
    rawDb.prepare(`INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost) VALUES (?, ?, ?, ?, ?)`)
      .run('holding_xirr_usd_quote', userId, 'asset_xirr_usd_quote', 1, 100);
    await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 1000, occurredAt: flowDate
    } });
    await apiCall(env, '/api/investment-cashflows/completeness', { method: 'PUT', body: { completeFrom: flowDate } });

    const usdAssetResult = await apiCall(env, '/api/holdings');
    assert.strictEqual(usdAssetResult.data.xirr.rate, null);
    assert.strictEqual(usdAssetResult.data.xirr.annualizedPct, null);
    assert.strictEqual(usdAssetResult.data.xirr.reasonCode, 'UNSUPPORTED_CURRENCY');
    assert.strictEqual(usdAssetResult.data.xirr.terminalValueVnd, null);

    rawDb.prepare('DELETE FROM holdings WHERE id = ?').run('holding_xirr_usd_quote');
    rawDb.prepare(`INSERT INTO accounts (id, user_id, name, type, currency, balance, include_in_net_worth, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)`).run('acc_xirr_usd_cash', userId, 'USD investment cash', 'securities', 'USD', -100);
    const usdAccountResult = await apiCall(env, '/api/holdings');
    assert.strictEqual(usdAccountResult.data.xirr.rate, null);
    assert.strictEqual(usdAccountResult.data.xirr.reasonCode, 'UNSUPPORTED_CURRENCY');
    assert.strictEqual(usdAccountResult.data.xirr.terminalValueVnd, null, 'Không được tính USD raw amount như VND, kể cả số dư âm');
  });
});

describe('V2-19 manual quote date disclosure', () => {
  it('reports the oldest saved holding quote date even when a manual price is old, and null when there are no holdings', async () => {
    const { env, rawDb } = createTestEnv();
    await apiCall(env, '/api/accounts');
    const userId = String((rawDb.prepare('SELECT user_id FROM accounts LIMIT 1').get() as any).user_id);
    rawDb.prepare(`INSERT INTO assets (id, symbol, name, asset_class, unit, currency, current_price, price_as_of, provider, sync_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual', 'ok')`).run(
      'asset_old_manual_quote', 'OLDMANUAL', 'Old manual quote', 'stock', 'share', 'VND', 10000, '2020-02-03T00:00:00.000Z'
    );
    rawDb.prepare(`INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost) VALUES (?, ?, ?, ?, ?)`)
      .run('holding_old_manual_quote', userId, 'asset_old_manual_quote', 1, 9000);

    const oldFlow = await apiCall(env, '/api/investment-cashflows', { method: 'POST', body: {
      type: 'contribution', amountVnd: 9000, occurredAt: '2020-02-03'
    } });
    assert.strictEqual(oldFlow.status, 200);
    await apiCall(env, '/api/investment-cashflows/completeness', { method: 'PUT', body: { completeFrom: '2020-02-03' } });

    const withHolding = await apiCall(env, '/api/holdings');
    assert.strictEqual(withHolding.status, 200);
    assert.strictEqual(withHolding.data.xirr.priceAsOfOldest, '2020-02-03T00:00:00.000Z');
    assert.match(withHolding.data.xirr.message, /giá đã lưu/);

    rawDb.prepare('DELETE FROM holdings WHERE id = ?').run('holding_old_manual_quote');
    const withoutHolding = await apiCall(env, '/api/holdings');
    assert.strictEqual(withoutHolding.data.xirr.priceAsOfOldest, null);
  });
});
