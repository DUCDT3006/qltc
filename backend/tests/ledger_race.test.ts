import { it } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../src/index';
import { createSqliteD1 } from './d1Helper';

const ownerToken = 'race-test-owner-token';

async function call(env: any, path: string, method = 'GET', body?: unknown) {
  const response = await workerApp.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${ownerToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() as any };
}

it('AT2-04/05: 20 reads before one receipt claim produce exactly one ledger effect', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const account = await call(env, '/api/accounts', 'POST', {
    id: 'race_account', name: 'Race', type: 'cash', balance: 1_000_000
  });
  assert.equal(account.status, 200);

  const originalPrepare = db.prepare.bind(db);
  let initialReads = 0;
  let release!: () => void;
  const allReadsReached = new Promise<void>((resolve) => { release = resolve; });
  (db as any).prepare = (sql: string) => {
    const statement = originalPrepare(sql);
    if (!sql.includes('FROM mutation_receipts WHERE operation_id')) return statement;
    const originalBind = statement.bind.bind(statement);
    return {
      ...statement,
      bind(...values: unknown[]) {
        const bound = originalBind(...values);
        return {
          ...bound,
          async first() {
            if (initialReads < 20) {
              initialReads++;
              if (initialReads === 20) release();
              await allReadsReached;
            }
            return bound.first();
          }
        };
      }
    };
  };

  const body = {
    operationId: 'same-operation', accountId: 'race_account',
    type: 'expense', amount: 20_000, description: 'one expense'
  };
  const responses = await Promise.all(Array.from({ length: 20 }, () => call(env, '/api/transactions', 'POST', body)));
  assert.equal(initialReads, 20);
  assert.ok(responses.every((result) => result.status === 200), JSON.stringify(responses));
  assert.equal(new Set(responses.map((result) => result.data.id)).size, 1);
  assert.equal((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('race_account') as any).balance, 980_000);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ?').get('race_account') as any).n, 1);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings WHERE operation_id = ?').get('same-operation') as any).n, 1);
  assert.equal((rawDb.prepare('SELECT COUNT(*) AS n FROM mutation_receipts WHERE operation_id = ?').get('same-operation') as any).n, 1);

  const conflict = await call(env, '/api/transactions', 'POST', { ...body, amount: 30_000 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, 'IDEMPOTENCY_CONFLICT');
});

it('AT2-41: restore rejects missing checksum before changing any data', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  await call(env, '/api/accounts', 'POST', { id: 'protected_account', name: 'Saved', type: 'cash', balance: 123_456 });
  const result = await call(env, '/api/backup/restore', 'POST', {
    schemaVersion: 2, data: { accounts: [] }
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.code, 'CHECKSUM_REQUIRED');
  assert.equal((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('protected_account') as any).balance, 123_456);
});

it('V2-01: CORS permits only configured web origins and leaves native requests usable', async () => {
  const { db } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken, ALLOWED_ORIGINS: 'http://localhost:5173' };
  const approved = await workerApp.fetch(new Request('http://localhost/api/health', {
    method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' }
  }), env, { waitUntil() {} });
  assert.equal(approved.status, 204);
  assert.equal(approved.headers.get('Access-Control-Allow-Origin'), 'http://localhost:5173');
  const denied = await workerApp.fetch(new Request('http://localhost/api/health', {
    method: 'OPTIONS', headers: { Origin: 'https://attacker.example' }
  }), env, { waitUntil() {} });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  const native = await call(env, '/api/health');
  assert.equal(native.status, 200);
});

it('AT2-29/45: server analytics counts one-time once and annual remainder exactly', async () => {
  const { db } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const annual = await call(env, '/api/income-sources', 'POST', {
    id: 'annual_ten', name: 'Annual ten', cadence: 'annual', expectedAmount: 10,
    effectiveFromMonth: '2026-01'
  });
  const oneTime = await call(env, '/api/income-sources', 'POST', {
    id: 'one_time', name: 'One time', cadence: 'one_time', expectedAmount: 12_000_000,
    oneTimeDate: '2026-09-15', effectiveFromMonth: '2026-01'
  });
  assert.equal(annual.status, 200);
  assert.equal(oneTime.status, 200);
  const year = await call(env, '/api/analytics/summary?period=year&startDate=2025-12-31T17:00:00.000Z&endDate=2026-12-31T16:59:59.999Z');
  assert.equal(year.status, 200);
  assert.equal(year.data.totals.plannedIncome, 12_000_010);
  const september = await call(env, '/api/analytics/summary?period=month&startDate=2026-08-31T17:00:00.000Z&endDate=2026-09-30T16:59:59.999Z');
  assert.equal(september.data.totals.plannedIncome, 12_000_001);
  const october = await call(env, '/api/analytics/summary?period=month&startDate=2026-09-30T17:00:00.000Z&endDate=2026-10-31T16:59:59.999Z');
  assert.equal(october.data.totals.plannedIncome, 1);
});

it('V2-16: weekly, quarterly and semiannual plans preserve their annual totals', async () => {
  const { db } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  for (const [id, cadence, expectedAmount] of [
    ['weekly', 'weekly', 10],
    ['quarterly', 'quarterly', 1_000_001],
    ['semiannual', 'semiannual', 10]
  ] as const) {
    const result = await call(env, '/api/planned-expenses', 'POST', {
      id, name: cadence, cadence, expectedAmount, effectiveFromMonth: '2026-01'
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  const year = await call(env, '/api/analytics/summary?period=year&startDate=2025-12-31T17:00:00.000Z&endDate=2026-12-31T16:59:59.999Z');
  assert.equal(year.status, 200);
  assert.equal(year.data.totals.plannedExpense, 52 * 10 + 4 * 1_000_001 + 2 * 10);
});

it('AT2-32: Fmarket selection uses the published dated NAV and preserves purchase inputs', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const originalFetch = globalThis.fetch;
  const day = new Date().toISOString().slice(0, 10);
  let nav = 12_345.67;
  try {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(init?.method, 'POST');
      if (String(url) === 'https://api.fmarket.vn/res/products/filter') {
        return Response.json({ data: { total: 2, rows: [
          { id: 23, shortName: 'TESTFUND', name: 'Official test fund', nav: 1, status: 'PRODUCT_ACTIVE' },
          { id: 24, shortName: 'OLDFUND', name: 'Old fund', status: 'PRODUCT_ACTIVE' }
        ] } });
      }
      assert.equal(String(url), 'https://api.fmarket.vn/res/product/get-nav-history');
      const { productId } = JSON.parse(String(init?.body));
      return Response.json({ data: productId === 24 ? [{ productId, nav: 10_000, navDate: '2020-01-01' }] : [
        { productId, nav: 10, navDate: '2020-01-01' },
        { productId, nav, navDate: day },
        { productId, nav: 1, navDate: '2099-12-31' },
        { productId: 24, nav: 1, navDate: day }
      ] });
    }) as typeof fetch;
    const result = await call(env, '/api/market/fmarket-funds');
    assert.equal(result.status, 200);
    assert.equal(result.data.quoteOnSelect, true);
    assert.ok(result.data.funds.some((fund: any) => fund.shortName === 'TESTFUND' && fund.name === 'Official test fund'));
    const quote = await call(env, '/api/market/fmarket-funds/TESTFUND');
    assert.equal(quote.data.nav, 12_345.67);
    assert.equal(quote.data.navDate, day);
    assert.equal(quote.data.stale, false);
    assert.equal((await call(env, '/api/market/fmarket-funds/OLDFUND')).data.stale, true);

    const body = { symbol: 'TESTFUND', name: 'Client guess', assetClass: 'fund', provider: 'fmarket', quantity: 12.5, avgCost: 11_222.34, currentPrice: 1 };
    const saved = await call(env, '/api/holdings', 'POST', body);
    assert.equal(saved.status, 200, saved.data.error);
    assert.equal(saved.data.holding.name, 'Official test fund');
    assert.equal(saved.data.holding.avg_cost, 11_222.34);
    assert.equal(saved.data.holding.quantity, 12.5);
    assert.equal(saved.data.holding.current_price, 12_345.67);
    assert.equal(saved.data.holding.price_as_of, day);
    assert.equal((await call(env, '/api/holdings', 'POST', body)).data.id, saved.data.id);
    assert.equal(rawDb.prepare('SELECT COUNT(*) AS n FROM holdings').get()?.n, 1);
    assert.equal((await call(env, '/api/holdings', 'POST', { ...body, symbol: 'OLDFUND' })).status, 503);

    nav = 12_456.78;
    const refresh = await call(env, '/api/market/sync-prices', 'POST', {});
    assert.equal(refresh.status, 200);
    assert.equal(refresh.data.updated.TESTFUND, nav);
    assert.equal(rawDb.prepare('SELECT current_price FROM assets WHERE symbol = ?').get('TESTFUND')?.current_price, nav);
    assert.equal(rawDb.prepare('SELECT avg_cost FROM holdings WHERE id = ?').get(saved.data.id)?.avg_cost, 11_222.34);

    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    const unavailable = await call(env, '/api/market/fmarket-funds');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.data.funds, []);
    assert.equal((await call(env, '/api/market/fmarket-funds/TESTFUND')).status, 503);
    assert.equal((await call(env, '/api/holdings', 'POST', { ...body, quantity: 100 })).status, 503);
    assert.equal(rawDb.prepare('SELECT quantity FROM holdings WHERE id = ?').get(saved.data.id)?.quantity, 12.5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
