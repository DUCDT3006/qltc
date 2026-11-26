import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import app from '../src/index';
import { createSqliteD1 } from './d1Helper';

const amount = 812506;
const request = {
  symbol: 'VESAF', type: 'expense', accountId: 'bank-wallet', quantity: 25, unitPrice: 32500.25,
  expectedTransactionRevision: 1, expectedHoldingRevision: 1, operationId: 'bank-fund-one',
  alreadyRecorded: false, confirmAmountDifference: false, note: 'Ghi quỹ từ thông báo'
};

async function setup(legacy = false, owned = true, notification?: object) {
  const h = createSqliteD1();
  if (legacy) h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
  const env = { DB: h.db, OWNER_API_TOKEN: 'bank-fund-test-owner' };
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method, headers: { Authorization: 'Bearer bank-fund-test-owner', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  }
  assert.equal((await call('/api/accounts', 'POST', {
    id: 'bank-wallet', name: 'Test VCB', type: 'bank', bankCode: 'VCB', accountNumber: '0123456789', balance: 1000000
  })).status, 200);
  if (owned) h.rawDb.exec(`INSERT INTO assets (id,symbol,name,asset_class,unit,currency,current_price,provider,price_as_of)
    VALUES ('owned-asset','VESAF','Existing fund','fund','CCQ','VND',35000,'fmarket','2026-11-09');
    INSERT INTO holdings (id,user_id,asset_id,quantity,avg_cost,revision) VALUES ('owned-holding','user_default','owned-asset',100,30000.25,1);`);
  const ingested = await call('/api/notifications/ingest', 'POST', notification ?? {
    eventId: 'fund-bank-event', packageName: 'com.VCB', title: 'VCB',
    text: 'TK 0123456789 -812,506 VND. SD: 187,494 VND. ND: Mua VESAF', occurredAt: Date.now()
  });
  assert.equal(ingested.status, 200, ingested.data.error);
  const txId = ingested.data.transactionId;
  assert.ok(txId);
  const submit = (body: object = request) => call(`/api/transactions/${txId}/fund-purchase`, 'POST', body);
  const balance = () => h.rawDb.prepare("SELECT balance FROM accounts WHERE id='bank-wallet'").get()?.balance;
  const holding = () => h.rawDb.prepare("SELECT h.* FROM holdings h JOIN assets a ON a.id=h.asset_id WHERE a.symbol='VESAF' AND h.user_id='user_default'").get() as any;
  const tx = () => h.rawDb.prepare('SELECT * FROM transactions WHERE id=?').get(txId) as any;
  return { ...h, call, txId, submit, balance, holding, tx };
}

async function withQuote(run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/products/filter')) {
      return Response.json({ data: { total: 1, rows: [{ id: 23, shortName: 'VESAF', name: 'Official fund', status: 'PRODUCT_ACTIVE' }] } });
    }
    assert.ok(String(url).endsWith('/product/get-nav-history'));
    return Response.json({ data: [{ productId: 23, nav: 35000.125, navDate: new Date().toISOString().slice(0, 10) }] });
  }) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}

describe('record fund purchases while approving bank payments', () => {
  it('uses a direct Fmarket confirmation as one pending expense and posts only to the account selected on approval', async () => {
    const notification = {
      eventId: 'app-fmarket-order-first', packageName: 'com.fincorp.fmarket', title: 'Fmarket',
      text: 'Lệnh mua 812,506đ quỹ VESAF đã được xác nhận. Mã lệnh: TEST-FM-1234', occurredAt: Date.now() - 20 * 60_000
    };
    const h = await setup(false, true, notification);
    assert.equal(h.tx().status, 'pending');
    assert.equal(h.tx().amount, amount);
    assert.equal(h.tx().needs_account_review, 1);
    assert.equal(h.balance(), 1000000);

    const replay = await h.call('/api/notifications/ingest', 'POST', { ...notification, eventId: 'app-fmarket-order-repeated', occurredAt: Date.now() });
    assert.equal(replay.data.status, 'duplicate');
    assert.equal(replay.data.transactionId, h.txId);
    const pending = await h.call('/api/transactions?status=pending');
    assert.equal(pending.data.transactions.length, 1);
    assert.deepEqual(pending.data.transactions[0].review, { type: 'expense', accountId: null, bankCode: 'FMARKET' });

    assert.equal((await h.submit({ ...request, accountId: 'acc_unassigned' })).status, 400);
    assert.equal(h.balance(), 1000000);
    assert.equal((await h.submit()).status, 200);
    assert.equal((await h.submit()).status, 200);
    assert.equal(h.holding().quantity, 125);
    assert.equal(h.balance(), 1000000 - amount);
    assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings WHERE transaction_id=?').get(h.txId)?.n, 1);
  });

  for (const legacy of [false, true]) {
    it(`buys more and debits the bank exactly once on ${legacy ? 'legacy' : 'fresh'} storage`, async () => {
      const h = await setup(legacy);
      const results = await Promise.all(Array.from({ length: 8 }, () => h.submit()));
      assert.ok(results.every(result => result.status === 200), JSON.stringify(results));
      assert.equal(h.holding().quantity, 125);
      assert.equal(h.holding().avg_cost, 30500.25);
      assert.equal(h.balance(), 1000000 - amount);
      assert.equal(h.tx().status, 'confirmed');
      assert.equal(h.tx().note, request.note);
      assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings WHERE transaction_id=?').get(h.txId)?.n, 1);
      assert.equal((await h.submit({ ...request, operationId: 'different-retry' })).status, 409);
      assert.equal((await h.submit({ ...request, quantity: 26 })).status, 409);
      assert.equal(h.holding().quantity, 125);
      assert.equal(h.balance(), 1000000 - amount);
    });
  }

  it('creates a first holding with a verified NAV and the entered purchase cost', async () => withQuote(async () => {
    const h = await setup(true, false);
    const result = await h.submit({ ...request, expectedHoldingRevision: null });
    assert.equal(result.status, 200, result.data.error);
    assert.equal(h.holding().quantity, 25);
    assert.equal(h.holding().avg_cost, 32500.25);
    assert.equal(h.balance(), 1000000 - amount);
    const asset = h.rawDb.prepare("SELECT name,current_price,provider,price_as_of FROM assets WHERE symbol='VESAF'").get();
    assert.equal(asset?.name, 'Official fund');
    assert.equal(asset?.current_price, 35000.125);
    assert.equal(asset?.provider, 'fmarket');
    assert.equal(asset?.price_as_of, new Date().toISOString().slice(0, 10));
  }));

  it('can approve a payment for CCQ recorded earlier without buying another lot', async () => {
    const h = await setup();
    const result = await h.submit({ ...request, alreadyRecorded: true, quantity: null, unitPrice: null });
    assert.equal(result.status, 200);
    assert.equal(h.holding().quantity, 100);
    assert.equal(h.holding().avg_cost, 30000.25);
    assert.equal(h.holding().revision, 1);
    assert.equal(h.balance(), 1000000 - amount);
    assert.equal(JSON.parse(h.tx().fund_purchase_json).alreadyRecorded, true);
  });

  it('advances a nullable legacy holding revision so another purchase cannot use the stale snapshot', async () => {
    const h = await setup(true);
    h.rawDb.exec("UPDATE holdings SET revision=NULL WHERE id='owned-holding'");
    assert.equal((await h.submit()).status, 200);
    assert.equal(h.holding().revision, 2);
  });

  it('rolls back new assets, bank debit and purchase receipt if payment approval fails', async () => withQuote(async () => {
    const h = await setup(true, false);
    h.setFailOnSqlPattern("UPDATE transactions SET status='confirmed'");
    const body = { ...request, expectedHoldingRevision: null };
    assert.equal((await h.submit(body)).status, 503);
    assert.equal(h.holding(), undefined);
    assert.equal(h.balance(), 1000000);
    assert.equal(h.tx().status, 'pending');
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM assets WHERE symbol='VESAF'").get()?.n, 0);
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM mutation_receipts WHERE operation_id='bank-fund-one'").get()?.n, 0);
    h.setFailOnSqlPattern(null);
    assert.equal((await h.submit(body)).status, 200);
    assert.equal(h.holding().quantity, 25);
  }));

  it('requires explicit confirmation for the amount difference and keeps the actual bank amount', async () => {
    const h = await setup();
    const body = { ...request, quantity: 20 };
    const blocked = await h.submit(body);
    assert.equal(blocked.status, 400);
    assert.equal(blocked.data.code, 'FUND_AMOUNT_DIFFERENCE');
    assert.equal(h.balance(), 1000000);
    assert.equal((await h.submit({ ...body, confirmAmountDifference: true })).status, 200);
    assert.equal(h.holding().quantity, 120);
    assert.equal(h.tx().amount, amount);
    assert.equal(h.balance(), 1000000 - amount);
  });

  it('validates account and current holding revision before any financial effect', async () => {
    const h = await setup();
    for (const patch of [{ accountId: 'missing' }, { quantity: 0 }, { type: 'income' }]) {
      assert.equal((await h.submit({ ...request, ...patch })).status, 400);
    }
    assert.equal((await h.submit({ ...request, expectedHoldingRevision: null })).status, 409);
    assert.equal((await h.submit({ ...request, expectedTransactionRevision: 2 })).status, 409);
    assert.equal(h.holding().quantity, 100);
    assert.equal(h.balance(), 1000000);
    assert.equal(h.tx().status, 'pending');
  });

  it('keeps the fund link through backup and bank undo so a payment retry does not buy CCQ again', async () => {
    const h = await setup();
    assert.equal((await h.submit()).status, 200);
    const backup = await h.call('/api/backup/export');
    assert.equal(backup.status, 200);
    assert.equal((await h.call('/api/backup/restore', 'POST', backup.data)).status, 200);
    const listed = await h.call('/api/transactions');
    assert.equal(listed.data.transactions[0].fundPurchase.symbol, 'VESAF');
    assert.equal((await h.call(`/api/transactions/${h.txId}`, 'PUT', { note: 'New note' })).status, 200);
    assert.equal((await h.call(`/api/transactions/${h.txId}`, 'PUT', { type: 'income' })).status, 400);
    assert.equal((await h.call(`/api/transactions/${h.txId}/pair-transfer`, 'POST', { toAccountId: 'x' })).status, 400);
    assert.equal((await h.call(`/api/transactions/${h.txId}`, 'PUT', { status: 'pending' })).status, 200);
    assert.equal(h.balance(), 1000000);
    assert.equal(h.holding().quantity, 125);
    assert.equal((await h.submit({ ...request, operationId: 'purchase-after-undo', expectedTransactionRevision: h.tx().revision, expectedHoldingRevision: 2 })).status, 409);
    assert.equal((await h.call(`/api/transactions/${h.txId}`, 'PUT', { status: 'confirmed', type: 'expense', accountId: 'bank-wallet' })).status, 200);
    assert.equal(h.balance(), 1000000 - amount);
    assert.equal(h.holding().quantity, 125);
  });
});
