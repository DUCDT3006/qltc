import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import workerApp, { ensureDatabaseSchema, resetSchemaEnsureCache } from '../src/index';
import { migrateLegacyStorage } from '../src/services/legacyStorage';
import { createSqliteD1 } from './d1Helper';

const token = 'legacy-storage-test-owner';
const owner = { Authorization: `Bearer ${token}` };
async function request(env: any, path: string, body?: object, method = body ? 'POST' : 'GET') {
  const response = await workerApp.fetch(new Request(`https://example.test${path}`, {
    method, headers: { ...owner, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json().catch(() => null) as any };
}
async function legacySetup() {
  const h = createSqliteD1();
  h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
  const env = { DB: h.db, OWNER_API_TOKEN: token };
  assert.equal((await request(env, '/api/health')).status, 200);
  h.rawDb.exec(`INSERT INTO accounts (id,user_id,name,type,balance,bank_code,account_number_mask) VALUES ('legacy-bank','user_default','Test bank','bank',1000000,'VCB','4567');
    INSERT INTO jars (id,user_id,code,name,target_percent,monthly_limit) VALUES ('jar_nec','user_default','NEC','Test jar',100,500000);`);
  return { ...h, env };
}

describe('legacy installation notification and refresh compatibility', () => {
  it('preserves legacy notification content, baseline values, plan cadence and existing receipts on repeated upgrades', async () => {
    const h = createSqliteD1();
    h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
    h.rawDb.exec(`INSERT INTO jars (id,user_id,code,name,rollover) VALUES ('legacy-jar','user_default','NEC','Existing jar',1);
      INSERT INTO raw_notifications (id,user_id,package_name,raw_body,is_parsed) VALUES ('legacy-raw','user_default','test.bank','retained notification',1);
      INSERT INTO ledger_baselines (user_id,account_id,baseline_balance,cutover_at) VALUES ('user_default','legacy-bank',123456,'2026-01-01');
      INSERT INTO mutation_receipts (user_id,operation_id,payload_hash,ack_json) VALUES ('user_default','old-op','old-hash','{"success":true}');
      INSERT INTO income_sources (id,user_id,name,recurrence,default_account_id,expected_amount) VALUES ('old-income','user_default','Weekly plan','weekly','legacy-bank',321000);
      INSERT INTO planned_expenses (id,user_id,name,jar_code,recurrence) VALUES ('old-plan','user_default','Quarterly plan','NEC','Hàng quý');`);
    await ensureDatabaseSchema(h.db);
    resetSchemaEnsureCache();
    await ensureDatabaseSchema(h.db);
    assert.equal((h.rawDb.prepare("SELECT text FROM raw_notifications WHERE id='legacy-raw'").get() as any).text, 'retained notification');
    assert.equal((h.rawDb.prepare("SELECT app_package FROM raw_notifications WHERE id='legacy-raw'").get() as any).app_package, 'test.bank');
    assert.equal((h.rawDb.prepare("SELECT baseline_amount_vnd FROM ledger_baselines WHERE account_id='legacy-bank'").get() as any).baseline_amount_vnd, 123456);
    assert.equal((h.rawDb.prepare("SELECT response_json FROM mutation_receipts WHERE operation_id='old-op'").get() as any).response_json, '{"success":true}');
    assert.deepEqual({ ...h.rawDb.prepare("SELECT cadence,account_id,expected_amount FROM income_sources WHERE id='old-income'").get() }, { cadence: 'weekly', account_id: 'legacy-bank', expected_amount: 321000 });
    assert.deepEqual({ ...h.rawDb.prepare("SELECT cadence,jar_id FROM planned_expenses WHERE id='old-plan'").get() }, { cadence: 'quarterly', jar_id: 'legacy-jar' });
    assert.equal((h.rawDb.prepare("SELECT rollover_enabled FROM jars WHERE id='legacy-jar'").get() as any).rollover_enabled, 1);
  });

  it('rolls back all schema renames and additions if an upgrade statement fails', async () => {
    const h = createSqliteD1();
    h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
    h.setFailOnSqlPattern('ALTER TABLE transactions ADD COLUMN source');
    await assert.rejects(() => migrateLegacyStorage(h.db), /Injected D1 failure/);
    const rawColumns = h.rawDb.prepare('PRAGMA table_info(raw_notifications)').all().map(row => row.name);
    assert.ok(rawColumns.includes('package_name') && rawColumns.includes('raw_body'));
    assert.ok(!rawColumns.includes('app_package') && !rawColumns.includes('text'));
    assert.ok(!h.rawDb.prepare('PRAGMA table_info(jars)').all().some(row => row.name === 'icon'));
  });

  it('loads all primary sync endpoints against the old schema', async () => {
    const h = await legacySetup();
    for (const path of ['/api/accounts','/api/jars','/api/transactions','/api/holdings','/api/income-sources','/api/planned-expenses','/api/user/profile']) {
      const response = await request(h.env, path);
      assert.equal(response.status, 200, `${path}: ${response.data?.error}`);
    }
  });

  it('receives a retried notification exactly once and changes balance only after approval', async () => {
    const h = await legacySetup();
    const notification = { eventId: 'legacy-notification-1', packageName: 'com.VCB', title: 'VCB', text: 'SD TK 0011001234567 -50,000VND. SD: 950,000VND. ND: Mua cafe', occurredAt: Date.now() };
    const received = await request(h.env, '/api/notifications/ingest', notification);
    assert.equal(received.status, 200, received.data?.error);
    assert.equal(received.data.status, 'created');
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='legacy-bank'").get() as any).balance, 1000000);
    const retry = await request(h.env, '/api/notifications/ingest', notification);
    assert.equal(retry.status, 200);
    assert.equal(retry.data.status, 'duplicate_event');
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM raw_notifications').get() as any).n, 1);
    const pending = await request(h.env, '/api/transactions?status=pending');
    assert.equal(pending.status, 200, pending.data?.error);
    assert.equal(pending.data.transactions.length, 1);
    const approval = { status: 'confirmed', jarId: 'jar_nec', operationId: 'legacy-approval-1' };
    const approved = await request(h.env, `/api/transactions/${received.data.transactionId}`, approval, 'PUT');
    assert.equal(approved.status, 200, approved.data?.error);
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='legacy-bank'").get() as any).balance, 950000);
    const repeated = await request(h.env, `/api/transactions/${received.data.transactionId}`, approval, 'PUT');
    assert.equal(repeated.status, 200, repeated.data?.error);
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='legacy-bank'").get() as any).balance, 950000);
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM ledger_postings').get() as any).n, 1);
  });

  it('can create another jar while retaining the required legacy jar code', async () => {
    const h = await legacySetup();
    const created = await request(h.env, '/api/jars', { name: 'New jar', code: 'CUSTOM', targetPercent: 0 });
    assert.equal(created.status, 200, created.data?.error);
    assert.equal((h.rawDb.prepare('SELECT code FROM jars WHERE id=?').get(created.data.id) as any).code, 'CUSTOM');
  });

  it('finishes a saved pending notification on retry after processing failed instead of acknowledging it without a transaction', async () => {
    const h = await legacySetup();
    const notification = { eventId: 'interrupted-ingest', packageName: 'com.VCB', title: 'VCB', text: 'SD TK 0011001234567 -50,000VND. SD: 950,000VND. ND: Mua cafe', occurredAt: Date.now() };
    h.setFailOnSqlPattern('INSERT INTO transactions');
    const interrupted = await request(h.env, '/api/notifications/ingest', notification);
    assert.equal(interrupted.status, 500);
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM raw_notifications').get() as any).n, 1);
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n, 0);
    h.setFailOnSqlPattern(null);
    const retried = await request(h.env, '/api/notifications/ingest', { ...notification, text: 'retry payload must not replace the stored notification' });
    assert.equal(retried.status, 200, retried.data?.error);
    assert.ok(retried.data.transactionId, 'do not drop the phone outbox item while its saved notification is still unprocessed');
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM transactions').get() as any).n, 1);
    assert.equal((h.rawDb.prepare('SELECT COUNT(*) AS n FROM raw_notifications').get() as any).n, 1);
    assert.equal((h.rawDb.prepare("SELECT balance FROM accounts WHERE id='legacy-bank'").get() as any).balance, 1000000);
  });
});
