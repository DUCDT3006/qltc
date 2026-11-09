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

it('AT2-32: Fmarket NAV comes from upstream with date; failure reports unavailable', async () => {
  const { db } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (url: string | URL | Request) => {
      assert.equal(String(url), 'https://api.fireant.vn/fmarket/markets/filter-products');
      return new Response(JSON.stringify({ items: [
        { short_name: 'TESTFUND', name: 'Test Fund', nav: 12_345.67, nav_date: new Date().toISOString() },
        { short_name: 'OLDFUND', name: 'Old Fund', nav: 10_000, nav_date: '2020-01-01' }
      ] }), { status: 200 });
    }) as typeof fetch;
    const result = await call(env, '/api/market/fmarket-funds');
    assert.equal(result.status, 200);
    assert.equal(result.data.funds[0].shortName, 'TESTFUND');
    assert.equal(result.data.funds[0].nav, 12_345.67);
    assert.equal(result.data.funds[0].stale, false);
    assert.equal(result.data.funds[1].stale, true);

    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    const unavailable = await call(env, '/api/market/fmarket-funds');
    assert.equal(unavailable.status, 503);
    assert.deepEqual(unavailable.data.funds, []);
    assert.equal(unavailable.data.stale, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
