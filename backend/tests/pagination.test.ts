import { it } from 'node:test';
import assert from 'node:assert/strict';
import workerApp from '../src/index';
import { createSqliteD1 } from './d1Helper';

const ownerToken = 'test_owner_secret_token_v2_2026';

async function call(env: any, path: string) {
  const response = await workerApp.fetch(new Request(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() as any };
}

it('uses stable cursor pages for 501+ rows, preserves explicit offset, and rejects same-count mutations as stale', async () => {
  const { db, rawDb } = createSqliteD1();
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const accountResult = await workerApp.fetch(new Request('http://localhost/api/accounts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'acc_pagination_fixture', name: 'Pagination fixture', type: 'cash', balance: 0 })
  }), env, { waitUntil() {} });
  assert.equal(accountResult.status, 200, 'Pagination fixture creates its own required account explicitly');
  const accountId = 'acc_pagination_fixture';
  const userId = (rawDb.prepare('SELECT user_id FROM accounts WHERE id = ?').get(accountId) as any).user_id as string;
  const insertTx = rawDb.prepare(`INSERT INTO transactions
    (id, user_id, occurred_at, type, amount, account_id, status, source)
    VALUES (?, ?, ?, 'expense', 1, ?, 'confirmed', 'manual')`);
  for (let index = 0; index < 501; index++) {
    insertTx.run(`tx_page_${String(index).padStart(3, '0')}`, userId, '2026-11-08T00:00:00.000Z', accountId);
  }

  const allIds: string[] = [];
  let page = await call(env, '/api/transactions?limit=250');
  assert.equal(page.status, 200);
  const firstRevision = page.data.pagination.dataRevision;
  assert.equal(typeof firstRevision, 'number');
  while (true) {
    allIds.push(...page.data.transactions.map((tx: any) => tx.id));
    if (!page.data.pagination.hasMore) break;
    assert.equal(typeof page.data.pagination.nextCursor, 'string');
    page = await call(env, `/api/transactions?limit=250&cursor=${encodeURIComponent(page.data.pagination.nextCursor)}`);
    assert.equal(page.status, 200);
    assert.equal(page.data.pagination.dataRevision, firstRevision);
  }
  assert.equal(allIds.length, 501);
  assert.equal(new Set(allIds).size, 501, 'Cursor pages must not repeat rows');
  assert.deepEqual(allIds, Array.from({ length: 501 }, (_, index) => `tx_page_${String(index).padStart(3, '0')}`).sort().reverse());

  const legacyFirst = await call(env, '/api/transactions?limit=10&offset=0');
  assert.equal(legacyFirst.status, 200);
  assert.equal(typeof legacyFirst.data.pagination.nextCursor, 'number');
  const legacySecond = await call(env, `/api/transactions?limit=10&offset=${legacyFirst.data.pagination.nextCursor}`);
  assert.equal(legacySecond.status, 200);
  assert.equal(legacySecond.data.pagination.offset, 10);

  const staleStart = await call(env, '/api/transactions?limit=250');
  assert.equal(staleStart.status, 200);
  const staleCursor = staleStart.data.pagination.nextCursor;
  const beforeCount = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(userId) as any).count);
  insertTx.run('tx_page_new', userId, '2026-11-09T00:00:00.000Z', accountId);
  rawDb.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run('tx_page_000', userId);
  const afterCount = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM transactions WHERE user_id = ?').get(userId) as any).count);
  assert.equal(afterCount, beforeCount, 'Mutation fixture keeps the row count unchanged');

  const stalePage = await call(env, `/api/transactions?limit=250&cursor=${encodeURIComponent(staleCursor)}`);
  assert.equal(stalePage.status, 409);
  assert.equal(stalePage.data.code, 'STALE_CURSOR');
  assert.notEqual(stalePage.data.dataRevision, staleStart.data.pagination.dataRevision);

  const planCursorStart = await call(env, '/api/transactions?limit=250');
  assert.equal(planCursorStart.status, 200);
  const beforePlanRevision = Number((rawDb.prepare('SELECT plan_revision FROM user_data_revisions WHERE user_id = ?').get(userId) as any).plan_revision);
  const createPlan = await workerApp.fetch(new Request('http://localhost/api/income-sources', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'inc_cursor_revision', name: 'Cursor revision', expectedAmount: 100, effectiveFromMonth: '2026-11' })
  }), env, { waitUntil() {} });
  assert.equal(createPlan.status, 200);
  assert.ok(Number((rawDb.prepare('SELECT plan_revision FROM user_data_revisions WHERE user_id = ?').get(userId) as any).plan_revision) > beforePlanRevision);
  const stalePlanCursor = await call(env, `/api/transactions?limit=250&cursor=${encodeURIComponent(planCursorStart.data.pagination.nextCursor)}`);
  assert.equal(stalePlanCursor.status, 409);
  assert.equal(stalePlanCursor.data.code, 'STALE_CURSOR');
});
