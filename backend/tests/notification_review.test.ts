import assert from 'node:assert/strict';
import { it } from 'node:test';
import app from '../src/index';
import { matchAccountForNotification } from '../src/services/accountMatcher';
import { parseBankNotification } from '../src/services/parser';
import { createSqliteD1 } from './d1Helper';

const hdb = {
  packageName: 'com.vnpay.hdbank', title: 'Thông báo HDBank',
  text: '09/11/2026 07:15:22 TK 012345678901234(VND)\n+50,000,000\nSD 55,000,000\nSD KHA DUNG 55,000,000\nND VCB.1234567890. Chuyen tien'
};
const coop = {
  packageName: 'com.vnpay.coopbank', title: 'Thông báo Co-opBank',
  text: 'SO TK: 3210001234567890\nP/S: 500,000 VND, 09/11/2026 08:45:00\nSDTT: 1,500,000 VND\nSDKD: 1,500,000 VND\nND: Chuyen tien'
};

it('matches the full receiving HDBank account even with another bank in the transfer memo', () => {
  const parsed = parseBankNotification(hdb.packageName, hdb.title, hdb.text)!;
  assert.equal(parsed.bankCode, 'HDB');
  assert.equal(parsed.accountNumber, '012345678901234');
  assert.equal(parsed.type, 'income');
  assert.equal(parsed.amount, 50_000_000);
  const wallets = [
    { id: 'same-suffix', name: 'Another HDBank', bankCode: 'HDBank', accountNumber: '112345678901234' },
    { id: 'recipient', name: 'Receiving HDBank', bankCode: 'HDBank', accountNumber: '012345678901234' }
  ];
  assert.equal(matchAccountForNotification(wallets, parsed).accountId, 'recipient');
  assert.equal(matchAccountForNotification(wallets.slice(0, 1), parsed).accountId, null, 'a shared suffix cannot override a conflicting full number');
  assert.equal(matchAccountForNotification([...wallets, { ...wallets[1], id: 'duplicate' }], parsed).accountId, null);
});

it('uses explicit credit and debit evidence and leaves an unsigned movement for review', () => {
  const ambiguous = parseBankNotification(coop.packageName, coop.title, coop.text)!;
  assert.equal(ambiguous.bankCode, 'COOPBANK');
  assert.equal(ambiguous.amount, 500_000);
  assert.equal(ambiguous.reasonCode, 'DIRECTION_UNKNOWN');
  assert.equal(ambiguous.needsTypeReview, true);
  assert.equal(parseBankNotification(coop.packageName, 'Báo có Co-opBank', coop.text)?.type, 'income');
  assert.equal(parseBankNotification(coop.packageName, coop.title, coop.text.replace('P/S: 500', 'P/S: −500'))?.type, 'expense');
  assert.equal(parseBankNotification(coop.packageName, 'Báo nợ Co-opBank', coop.text.replace('P/S: 500', 'P/S: +500'))?.needsTypeReview, true);
  const incoming = parseBankNotification('sms', 'Báo có', 'Từ TK 1111111111 VCB đến TK nhận 2222222222 HDBank. Số tiền: 500.000 ₫. ND: Thanh toán');
  assert.equal(incoming?.type, 'income');
  assert.equal(incoming?.accountNumber, '2222222222');
  assert.equal(incoming?.needsTypeReview, false);
  assert.equal(parseBankNotification(coop.packageName, coop.title, 'SO TK: 3210001234567890. SDTT: 500.000 VND. SDKD: 500.000 VND'), null);
});

it('reads Techcombank amounts with currency before the number and excludes the account balance', () => {
  const accountNumber = '19001234567890';
  const text = 'Tài khoản: ' + accountNumber + '\nSố dư: VND 1,546,163\nNguoi gui chuyen tien';
  for (const [title, type] of [['+ VND 354,000', 'income'], ['− VND 354,000', 'expense']]) {
    const parsed = parseBankNotification('vn.com.techcombank.bb.app', title, text, '2026-11-11T12:49:56.000Z');
    assert.ok(parsed);
    assert.equal(parsed.bankCode, 'TCB');
    assert.equal(parsed.amount, 354000);
    assert.equal(parsed.balanceAfter, 1546163);
    assert.equal(parsed.type, type);
    assert.equal(parsed.needsTypeReview, false);
    assert.equal(parsed.accountNumber, accountNumber);
  }
  assert.equal(parseBankNotification('vn.com.techcombank.bb.app', 'Techcombank',
    'Tài khoản: ' + accountNumber + '\nSố dư: VND 1,546,163'), null);
});

it('reprocesses only the selected missing Techcombank receipt and leaves balances for user approval', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: 'test-tcb-recovery-owner' };
  const call = async (path: string, method = 'GET', body?: object) => {
    const response = await app.fetch(new Request('https://test.local' + path, {
      method, headers: { Authorization: 'Bearer test-tcb-recovery-owner', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    assert.equal((await call('/api/accounts', 'POST', { id: 'tcb-recovery-account', name: 'Techcombank', type: 'bank',
      bankCode: 'TCB', accountNumber: '19001234567890', balance: 1000000 })).status, 200);
    const insert = rawDb.prepare("INSERT INTO raw_notifications (id,user_id,app_package,title,text,original_time_value,parse_status,parse_error) VALUES (?,'user_default','vn.com.techcombank.bb.app',?,?,?,'ignored','Could not extract amount/type')");
    const text = 'Tài khoản: 19001234567890\nSố dư: VND 1,546,163\nNguoi gui chuyen tien';
    insert.run('raw-tcb-recover', '+ VND 354,000', text, '2026-11-11T12:49:56.000Z');
    insert.run('raw-tcb-untouched', '+ VND 777,000', text, '2026-11-11T13:49:56.000Z');
    const recovery = { rawNotificationIds: ['raw-tcb-recover'] };
    assert.equal((await call('/api/notifications/reprocess', 'POST', { rawNotificationIds: [] })).status, 400);
    const recovered = await call('/api/notifications/reprocess', 'POST', recovery);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.count, 1);
    const tx = rawDb.prepare("SELECT * FROM transactions WHERE raw_notification_id='raw-tcb-recover'").get();
    assert.ok(tx);
    assert.equal(tx.type, 'income');
    assert.equal(tx.amount, 354000);
    assert.equal(tx.status, 'pending');
    assert.equal(tx.account_id, 'tcb-recovery-account');
    assert.equal(tx.occurred_at, '2026-11-11T12:49:56.000Z');
    assert.equal(rawDb.prepare("SELECT COUNT(*) AS n FROM transactions WHERE raw_notification_id='raw-tcb-untouched'").get()?.n, 0);
    assert.equal((await call('/api/notifications/reprocess', 'POST', recovery)).data.count, 0);
    assert.equal(rawDb.prepare("SELECT balance FROM accounts WHERE id='tcb-recovery-account'").get()?.balance, 1000000);
  } finally { rawDb.close(); }
});

it('skips Fmarket mail before storage and on reprocess while retaining bank payments to Fmarket', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: 'test-fund-mail-owner' };
  const call = async (path: string, body?: object) => {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer test-fund-mail-owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }), env, { waitUntil() {} });
    assert.equal(response.status, 200);
    return await response.json() as any;
  };

  const mail = { packageName: 'com.google.android.gm', title: 'Fmarket', text: 'Xác nhận mua VESAF. Số tiền giao dịch: 500.000 VND.', occurredAt: Date.now() };
  assert.equal((await call('/api/notifications/ingest', { ...mail, eventId: 'fmarket-email' })).status, 'ignored_fmarket_email');
  assert.equal((await call('/api/notifications/ingest', {
    ...mail, eventId: 'fmarket-mail-sender', packageName: 'COM.SAMSUNG.ANDROID.EMAIL.PROVIDER', title: 'Xác nhận lệnh mua',
    bigText: 'Từ: thongbao@fmarket.vn\nXác nhận mua VESAF. Số tiền giao dịch: 500.000 VND.'
  })).status, 'ignored_fmarket_email');
  assert.equal(rawDb.prepare('SELECT COUNT(*) AS n FROM raw_notifications').get()?.n, 0);
  assert.equal(rawDb.prepare('SELECT COUNT(*) AS n FROM transactions').get()?.n, 0);

  rawDb.prepare(`INSERT INTO raw_notifications (id,user_id,app_package,title,text,parse_status,original_time_value)
    VALUES ('legacy-fund-email','user_default',?,?,?,'failed',?)`).run(mail.packageName, mail.title, mail.text, new Date(mail.occurredAt).toISOString());
  assert.equal((await call('/api/notifications/recent')).notifications.length, 0);
  assert.equal((await call('/api/notifications/reprocess', {})).count, 0);
  assert.equal(rawDb.prepare("SELECT parse_status FROM raw_notifications WHERE id='legacy-fund-email'").get()?.parse_status, 'ignored_fmarket_email');

  const payment = { title: 'VCB Digibank', text: 'TK 0123456789 -500,000 VND. SD: 700,000 VND. ND: Mua VESAF qua FMARKET', occurredAt: mail.occurredAt };
  const bank = await call('/api/notifications/ingest', { ...payment, packageName: 'com.VCB', eventId: 'bank-fund-payment' });
  assert.equal(bank.status, 'created');
  const saved = rawDb.prepare('SELECT type,amount,description FROM transactions WHERE id=?').get(bank.transactionId);
  assert.equal(saved?.type, 'expense');
  assert.equal(saved?.amount, 500_000);
  assert.match(String(saved?.description), /VESAF/);
  const bankEmail = await call('/api/notifications/ingest', { ...payment, text: payment.text.replace('-500,000', '-600,000'), packageName: mail.packageName, eventId: 'bank-email-memo' });
  assert.equal(bankEmail.status, 'created', 'a bank alert whose payment memo mentions Fmarket is still a bank alert');
  assert.equal((await call('/api/notifications/recent')).notifications.length, 2);
  rawDb.close();
});

it('recognizes the Fmarket app confirmation amount in đồng and ignores incomplete or cancelled orders', () => {
  const source = 'com.fincorp.fmarket';
  const confirmation = 'Lệnh mua 3,600,001đ quỹ DCDS đã được xác nhận';
  const purchase = parseBankNotification(source, 'Fmarket', confirmation);
  assert.equal(purchase?.amount, 3_600_001);
  assert.equal(purchase?.type, 'expense');
  assert.equal(purchase?.bankCode, 'FMARKET');
  assert.match(purchase?.description || '', /\bDCDS\b/);
  assert.equal(parseBankNotification(source, 'Lệnh mua 3.600.001 ₫', 'quỹ DCDS đã được xác nhận')?.amount, 3_600_001);
  for (const message of [
    'Lệnh mua 3,600,001đ quỹ DCDS đang chờ thanh toán',
    `${confirmation} hủy`,
    confirmation.replace('Lệnh mua', 'Lệnh bán'),
    'Giá NAV quỹ DCDS: 32.500 VND'
  ]) assert.equal(parseBankNotification(source, 'Fmarket', message), null);
});

it('reviews old pending rows in place and posts the corrected type and chosen account exactly once', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: 'test-review-owner' };
  const call = async (path: string, method = 'GET', body?: object) => {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method,
      headers: { Authorization: 'Bearer test-review-owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  };
  const wallet = async (id: string, bankCode: string, accountNumber: string) => {
    assert.equal((await call('/api/accounts', 'POST', { id, name: id, type: 'bank', bankCode, accountNumber, balance: 1_000_000 })).status, 200);
  };
  await wallet('hdb', 'HDBank', '012345678901234');
  await wallet('coop', 'COOPBANK', '3210001234567890');
  await wallet('chosen', 'VCB', '1234500000');
  rawDb.exec(`INSERT INTO accounts (id,user_id,name,type,balance,is_active) VALUES
    ('acc_unassigned','user_default','Unassigned','unassigned',0,0), ('archived','user_default','Archived','bank',0,0);`);
  const insertRaw = rawDb.prepare('INSERT INTO raw_notifications (id,user_id,app_package,title,text) VALUES (?,\'user_default\',?,?,?)');
  insertRaw.run('raw-hdb', hdb.packageName, hdb.title, hdb.text);
  insertRaw.run('raw-coop', coop.packageName, coop.title, coop.text);
  rawDb.exec(`INSERT INTO transactions (id,user_id,account_id,type,amount,status,occurred_at,description,raw_notification_id,needs_account_review)
    VALUES ('legacy-hdb','user_default','acc_unassigned','income',50000000,'pending','2026-11-09T00:15:22Z','Bank content 1','raw-hdb',1),
      ('legacy-coop','user_default','coop','expense',500000,'pending','2026-11-09T01:45:00Z','Bank content 2','raw-coop',0);`);
  const balance = (id: string) => rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get(id)?.balance;
  const list = await call('/api/transactions?status=pending');
  assert.equal(list.status, 200);
  assert.equal(list.data.transactions.length, 2);
  const fundTransfer = list.data.transactions.find((tx: any) => tx.id === 'legacy-hdb');
  const unsigned = list.data.transactions.find((tx: any) => tx.id === 'legacy-coop');
  assert.deepEqual(fundTransfer.review, { type: 'income', accountId: 'hdb', bankCode: 'HDB' });
  assert.deepEqual(unsigned.review, { type: null, accountId: 'coop', bankCode: 'COOPBANK' });
  assert.equal(unsigned.review_text, undefined, 'the raw bank notification is not included in the suggestion');
  assert.equal(balance('hdb'), 1_000_000);
  assert.equal(balance('coop'), 1_000_000);

  const noChoice = await call('/api/transactions/legacy-coop', 'PUT', { status: 'confirmed', accountId: 'coop' });
  assert.equal(noChoice.status, 400);
  assert.equal(noChoice.data.code, 'TYPE_REVIEW_REQUIRED');
  for (const accountId of ['archived', 'missing']) {
    const rejected = await call('/api/transactions/legacy-coop', 'PUT', { status: 'confirmed', type: 'income', accountId });
    assert.equal(rejected.status, 400);
  }
  const approve = { operationId: 'correct-unsigned', status: 'confirmed', type: 'income', accountId: 'coop', note: 'Đã đối chiếu', expectedRevision: 1 };
  assert.equal((await call('/api/transactions/legacy-coop', 'PUT', approve)).status, 200);
  assert.equal((await call('/api/transactions/legacy-coop', 'PUT', approve)).status, 200);
  assert.equal(balance('coop'), 1_500_000);
  assert.equal((await call('/api/transactions/legacy-hdb', 'PUT', { status: 'confirmed', type: 'income', accountId: 'chosen', expectedRevision: 1 })).status, 200);
  assert.equal(balance('chosen'), 51_000_000);
  assert.equal(balance('hdb'), 1_000_000);
  assert.equal((await call('/api/transactions/legacy-coop', 'PUT', { status: 'pending', expectedRevision: 2 })).status, 200);
  assert.equal(balance('coop'), 1_000_000);
  const undone = (await call('/api/transactions?status=pending')).data.transactions[0];
  assert.equal(undone.type, 'income');
  assert.equal(undone.account_id, 'coop');
  assert.equal(undone.note, 'Đã đối chiếu');
  assert.equal(undone.review, undefined, 'an approved direction survives undo and refresh');
  rawDb.close();
});

it('ignores carrier promotional SMS and allows rejecting and undoing unassigned pending notifications', async () => {
  const promo = parseBankNotification(
    'com.samsung.android.messaging',
    '199',
    'lúc 22:30 ngày 23/11. Giảm ngay 30% cước tháng đầu tiên gói VSport (chỉ còn 24.500đ), gia hạn 35.000đ/tháng từ tháng thứ 2. Soạn DK SP gửi 1331. Từ chối QC: TC4 gửi 199.'
  );
  assert.equal(promo, null);

  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: 'test-reject-owner' };
  const call = async (path: string, method = 'GET', body?: object) => {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method,
      headers: { Authorization: 'Bearer test-reject-owner', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  };
  try {
    assert.equal((await call('/api/accounts', 'POST', { id: 'real-bank', name: 'VCB', type: 'bank', bankCode: 'VCB', accountNumber: '1234500000', balance: 1_000_000 })).status, 200);
    rawDb.exec(`INSERT INTO accounts (id,user_id,name,type,balance,is_active,include_in_net_worth) VALUES
      ('acc_unassigned','user_default','Chưa xác định','unassigned',0,0,0);
      INSERT INTO transactions (id,user_id,account_id,type,amount,status,occurred_at,description,needs_account_review)
      VALUES ('tx-ambig','user_default','acc_unassigned','expense',24500,'pending','2026-11-23T07:46:08.908Z','Promo or unclear alert',1),
             ('tx-broken-xfer','user_default','real-bank','transfer',50000,'pending','2026-11-23T08:00:00.000Z','Broken transfer',0);`);

    const rejected = await call('/api/transactions/tx-ambig', 'PUT', {
      operationId: 'reject-ambig-1', expectedRevision: 1, status: 'rejected'
    });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.data.status, 'rejected');
    assert.equal(rejected.data.revision, 2);

    const rejectedBrokenTransfer = await call('/api/transactions/tx-broken-xfer', 'PUT', {
      operationId: 'reject-xfer-1', expectedRevision: 1, status: 'rejected'
    });
    assert.equal(rejectedBrokenTransfer.status, 200);

    const undone = await call('/api/transactions/tx-ambig', 'PUT', {
      operationId: 'undo-reject-ambig-1', expectedRevision: 2, status: 'pending'
    });
    assert.equal(undone.status, 200);
    assert.equal(undone.data.status, 'pending');
    assert.equal(undone.data.revision, 3);
  } finally { rawDb.close(); }
});
