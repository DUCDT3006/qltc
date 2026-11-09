import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import app from '../src/index';
import { createSqliteD1 } from './d1Helper';

const token = 'transaction-note-test-owner';
async function call(env: any, path: string, method = 'GET', body?: object) {
  const response = await app.fetch(new Request(`https://example.test${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() as any };
}
async function setup(legacy = true) {
  const h = createSqliteD1();
  if (legacy) h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
  const env = { DB: h.db, OWNER_API_TOKEN: token };
  assert.equal((await call(env, '/api/accounts', 'POST', { id: 'note-account', name: 'Test wallet', type: 'cash', balance: 1000000 })).status, 200);
  const created = await call(env, '/api/transactions', 'POST', { id: 'note-tx', accountId: 'note-account', type: 'expense', amount: 50000, status: 'pending', description: 'Original bank description', operationId: 'create-note-tx' });
  assert.equal(created.status, 200);
  return { ...h, env };
}
describe('optional transaction notes', () => {
  for (const legacy of [false, true]) {
    it(`saves an optional note on approval without changing the bank description (${legacy ? 'legacy' : 'fresh'} schema)`, async () => {
      const h = await setup(legacy);
      const body = { status: 'confirmed', note: '  Ăn trưa cùng gia đình\nĐã chia tiền  ', operationId: 'approve-note-tx' };
      const approved = await call(h.env, '/api/transactions/note-tx', 'PUT', body);
      assert.equal(approved.status, 200);
      const row = h.rawDb.prepare("SELECT note,description,amount,status FROM transactions WHERE id='note-tx'").get();
      assert.deepEqual({ ...row }, { note: 'Ăn trưa cùng gia đình\nĐã chia tiền', description: 'Original bank description', amount: 50000, status: 'confirmed' });
      const replay = await call(h.env, '/api/transactions/note-tx', 'PUT', body);
      assert.equal(replay.status, 200);
      assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='note-account'").get() as any).balance, 950000);
      assert.equal((h.rawDb.prepare("SELECT COUNT(*) AS n FROM ledger_postings WHERE transaction_id='note-tx'").get() as any).n, 1);
      const listed = await call(h.env, '/api/transactions');
      assert.equal(listed.data.transactions[0].note, 'Ăn trưa cùng gia đình\nĐã chia tiền');
      const changedReplay = await call(h.env, '/api/transactions/note-tx', 'PUT', { ...body, note: 'Changed note' });
      assert.equal(changedReplay.status, 409);
    });
  }

  it('accepts no note and a blank note for either an income or an expense', async () => {
    const h = await setup();
    assert.equal((await call(h.env, '/api/transactions/note-tx', 'PUT', { status: 'confirmed', operationId: 'approve-without-note' })).status, 200);
    const income = await call(h.env, '/api/transactions', 'POST', { accountId: 'note-account', type: 'income', amount: 100000, status: 'pending', description: 'Original income', operationId: 'create-income' });
    assert.equal(income.status, 200);
    assert.equal((await call(h.env, `/api/transactions/${income.data.id}`, 'PUT', { status: 'confirmed', note: '   ', operationId: 'approve-blank-note' })).status, 200);
    assert.equal((h.rawDb.prepare('SELECT note FROM transactions WHERE id=?').get(income.data.id) as any).note, null);
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='note-account'").get() as any).balance, 1050000);
  });

  it('retains the note through undo, editing, clearing and backup/restore without another ledger effect', async () => {
    const h = await setup();
    await call(h.env, '/api/transactions/note-tx', 'PUT', { status: 'confirmed', note: 'Original note', operationId: 'approve-before-edit' });
    await call(h.env, '/api/transactions/note-tx', 'PUT', { status: 'pending', operationId: 'undo-note' });
    assert.equal((h.rawDb.prepare("SELECT note FROM transactions WHERE id='note-tx'").get() as any).note, 'Original note');
    await call(h.env, '/api/transactions/note-tx', 'PUT', { status: 'confirmed', operationId: 'reapprove-note' });
    const before = (h.rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings').get() as any).n;
    assert.equal((await call(h.env, '/api/transactions/note-tx', 'PUT', { note: 'Updated note', operationId: 'edit-note' })).status, 200);
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings').get() as any).n, before);
    const backup = await call(h.env, '/api/backup/export');
    assert.equal(backup.status, 200);
    const restored = await call(h.env, '/api/backup/restore', 'POST', backup.data);
    assert.equal(restored.status, 200, restored.data.error);
    assert.equal((h.rawDb.prepare("SELECT note FROM transactions WHERE id='note-tx'").get() as any).note, 'Updated note');
    assert.equal((await call(h.env, '/api/transactions/note-tx', 'PUT', { note: '', operationId: 'clear-note' })).status, 200);
    assert.equal((h.rawDb.prepare("SELECT note FROM transactions WHERE id='note-tx'").get() as any).note, null);
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='note-account'").get() as any).balance, 950000);
  });

  it('rejects invalid or oversized notes before approving or changing a balance', async () => {
    const h = await setup();
    for (const note of ['x'.repeat(501), 123, {}]) {
      const response = await call(h.env, '/api/transactions/note-tx', 'PUT', { note, status: 'confirmed', operationId: `invalid-note-${typeof note}` });
      assert.equal(response.status, 400);
      assert.equal(response.data.code, 'INVALID_TRANSACTION_NOTE');
    }
    assert.equal((h.rawDb.prepare("SELECT status FROM transactions WHERE id='note-tx'").get() as any).status, 'pending');
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='note-account'").get() as any).balance, 1000000);
  });
});
