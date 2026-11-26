import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import app from '../src/index';
import { createSqliteD1 } from './d1Helper';

async function setup(legacy = false) {
  const harness = createSqliteD1();
  if (legacy) harness.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
  const env = { DB: harness.db, OWNER_API_TOKEN: 'buy-more-test-owner' };
  async function call(path: string, method = 'GET', body?: unknown) {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method,
      headers: { Authorization: 'Bearer buy-more-test-owner', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  }
  assert.equal((await call('/api/accounts', 'POST', { id: 'cash', name: 'Test wallet', type: 'cash', balance: 1000000 })).status, 200);
  harness.rawDb.exec(`INSERT INTO assets (id,symbol,name,asset_class,unit,currency,current_price,provider,price_as_of)
    VALUES ('fund-asset','VESAF','Test fund','fund','CCQ','VND',35000,'fmarket','2026-11-09');
    INSERT INTO holdings (id,user_id,asset_id,quantity,avg_cost,revision) VALUES ('holding-fund','user_default','fund-asset',100,30000.25,1);`);
  const buy = (body: object) => call('/api/holdings/holding-fund/buy-more', 'POST', body);
  const current = () => harness.rawDb.prepare("SELECT quantity,avg_cost,revision FROM holdings WHERE id='holding-fund'").get() as any;
  return { ...harness, call, buy, current };
}

const purchase = { quantity: 25, unitPrice: 32500.25, expectedRevision: 1, operationId: 'buy-one' };

describe('buy more of an existing fund', () => {
  for (const legacy of [false, true]) {
    it(`adds quantity and weights the cost on ${legacy ? 'legacy' : 'fresh'} storage`, async () => {
      const h = await setup(legacy);
      const response = await h.buy(purchase);
      assert.equal(response.status, 200, response.data.error);
      assert.deepEqual({ ...h.current() }, { quantity: 125, avg_cost: 30500.25, revision: 2 });
      assert.equal(response.data.holding.id, 'holding-fund');
      assert.equal(response.data.holding.avgCost, 30500.25);
      const holdings = await h.call('/api/holdings');
      assert.equal(holdings.status, 200);
      const fund = holdings.data.holdings[0];
      assert.equal(fund.marketValueVnd, 4375000);
      assert.equal(fund.costBasisVnd, 3812531);
      assert.equal(fund.unrealizedPnlVnd, 562469);
      assert.equal(fund.current_price, 35000);
      assert.equal(fund.price_as_of, '2026-11-09');
      assert.equal(h.rawDb.prepare("SELECT balance FROM accounts WHERE id='cash'").get()?.balance, 1000000);
      assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM investment_cashflows').get()?.n, 0);
    });
  }

  it('keeps fractional units and purchase prices when calculating average cost', async () => {
    const h = await setup();
    h.rawDb.exec("UPDATE holdings SET quantity=0.1, avg_cost=12345.6789 WHERE id='holding-fund'");
    const result = await h.buy({ ...purchase, quantity: 0.2, unitPrice: 9876.54321 });
    assert.equal(result.status, 200);
    const expected = (0.1 * 12345.6789 + 0.2 * 9876.54321) / 0.3;
    assert.ok(Math.abs(h.current().quantity - 0.3) < 1e-12);
    assert.ok(Math.abs(h.current().avg_cost - expected) < 1e-9);
  });

  it('returns the saved result for concurrent retries and rejects a changed purchase with the same ID', async () => {
    const h = await setup();
    const results = await Promise.all(Array.from({ length: 12 }, () => h.buy(purchase)));
    assert.ok(results.every(result => result.status === 200));
    assert.ok(results.every(result => result.data.holding.quantity === 125));
    assert.equal(h.current().quantity, 125);
    assert.equal((await h.buy({ ...purchase, quantity: 50 })).status, 409);
    assert.equal(h.current().revision, 2);
  });

  it('prevents concurrent distinct purchases from overwriting each other and allows a deliberate retry after refresh', async () => {
    const h = await setup();
    const requests = [purchase, { ...purchase, operationId: 'buy-two' }];
    const results = await Promise.all(requests.map(request => h.buy(request)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.equal(h.current().quantity, 125);
    const failed = requests[results.findIndex(result => result.status === 409)];
    assert.equal((await h.buy({ ...failed, expectedRevision: 2 })).status, 200);
    assert.equal(h.current().quantity, 150);
    assert.ok(Math.abs(h.current().avg_cost - ((100 * 30000.25 + 50 * 32500.25) / 150)) < 1e-9);
  });

  it('rolls back the purchase receipt when the holding update fails', async () => {
    const h = await setup();
    h.setFailOnSqlPattern('UPDATE holdings SET quantity');
    assert.equal((await h.buy(purchase)).status, 503);
    assert.deepEqual({ ...h.current() }, { quantity: 100, avg_cost: 30000.25, revision: 1 });
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM mutation_receipts WHERE operation_id='buy-one'").get()?.n, 0);
    h.setFailOnSqlPattern(null);
    assert.equal((await h.buy(purchase)).status, 200);
    assert.equal(h.current().quantity, 125);
  });

  it('rejects invalid inputs and a fund without a known existing cost before any update', async () => {
    const h = await setup();
    for (const patch of [{ quantity: 0 }, { quantity: -2 }, { quantity: '25' }, { unitPrice: 0 }, { unitPrice: null }, { quantity: 1e20 }, { expectedRevision: 0 }, { operationId: '' }]) {
      assert.equal((await h.buy({ ...purchase, ...patch })).status, 400);
    }
    assert.equal((await h.call('/api/holdings/not-owned/buy-more', 'POST', purchase)).status, 404);
    h.rawDb.exec("UPDATE holdings SET avg_cost=0 WHERE id='holding-fund'");
    assert.equal((await h.buy(purchase)).status, 409);
    assert.equal(h.current().quantity, 100);
  });
});
