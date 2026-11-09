import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import workerApp from '../src/index';
import { hashPayload } from '../src/services/ledger';
import { createSqliteD1 } from './d1Helper';

const ownerToken = 'test_owner_secret_token_v2_2026';

async function call(env: any, path: string, method = 'GET', body?: any) {
  const response = await workerApp.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() as any };
}

it('round-trips opt-in raw notifications and owner profile under real SQLite foreign keys without exporting credentials', async () => {
  const { db, rawDb } = createSqliteD1();
  rawDb.exec('PRAGMA foreign_keys = ON;');
  rawDb.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const createdAccount = await call(env, '/api/accounts', 'POST', { id: 'acc_backup_fk', name: 'Backup test', type: 'cash', balance: 0 });
  assert.equal(createdAccount.status, 200);
  const accountId = 'acc_backup_fk';
  const ownerId = (rawDb.prepare('SELECT user_id FROM accounts WHERE id = ?').get(accountId) as any).user_id;

  const profileUpdate = await call(env, '/api/user/profile', 'PUT', {
    name: 'Backup Owner', email: 'backup-owner@qltc.local', phone: '+84901234567', avatar: 'data:image/png;base64,TEST'
  });
  assert.equal(profileUpdate.status, 200);
  rawDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run('private-password-hash', ownerId);
  rawDb.prepare(`INSERT INTO devices (id, user_id, device_name, token_hash) VALUES (?, ?, ?, ?)`).run(
    'device_secret', ownerId, 'Test phone', 'private-device-token-hash'
  );
  rawDb.prepare(`INSERT INTO raw_notifications (id, user_id, app_package, title, text, parse_status)
    VALUES (?, ?, ?, ?, ?, 'parsed')`).run('raw_roundtrip', ownerId, 'com.bank.app', 'Bank', 'Received 1000 VND');
  rawDb.prepare(`INSERT INTO transactions (id, user_id, occurred_at, type, amount, account_id, raw_notification_id, status, source)
    VALUES (?, ?, ?, 'income', 1000, ?, ?, 'confirmed', 'notification')`).run(
    'tx_raw_roundtrip', ownerId, '2026-11-08T00:00:00.000Z', accountId, 'raw_roundtrip'
  );

  const defaultBackup = await call(env, '/api/backup/export');
  assert.equal(defaultBackup.status, 200);
  assert.equal(Object.hasOwn(defaultBackup.data.data, 'raw_notifications'), false);
  assert.equal(defaultBackup.data.data.transactions[0].raw_notification_id, null);
  assert.equal(rawDb.prepare('SELECT raw_notification_id FROM transactions WHERE id = ?').get('tx_raw_roundtrip')?.raw_notification_id, 'raw_roundtrip');
  assert.deepEqual(defaultBackup.data.data.profile, {
    id: ownerId,
    email: 'backup-owner@qltc.local',
    name: 'Backup Owner',
    phone: '+84901234567',
    avatar: 'data:image/png;base64,TEST',
    created_at: defaultBackup.data.data.profile.created_at
  });
  assert.equal('password_hash' in defaultBackup.data.data.profile, false);
  assert.equal('devices' in defaultBackup.data.data, false);

  const fullBackup = await call(env, '/api/backup/export?includeRawNotifications=1');
  assert.equal(fullBackup.status, 200);
  assert.equal(fullBackup.data.data.raw_notifications.length, 1);
  assert.equal(fullBackup.data.data.transactions[0].raw_notification_id, 'raw_roundtrip');
  assert.equal('password_hash' in fullBackup.data.data.profile, false);

  const missingPlaceholderData = {
    accounts: [],
    transactions: [{ id: 'tx_missing_placeholder', occurred_at: '2026-11-08T00:00:00.000Z', type: 'expense', amount: 1, account_id: 'acc_unassigned' }]
  };
  const missingPlaceholderBackup = { schemaVersion: 2, data: missingPlaceholderData, checksum: await hashPayload(missingPlaceholderData) };
  for (const dryRun of [true, false]) {
    const rejected = await call(env, '/api/backup/restore', 'POST', { ...missingPlaceholderBackup, dryRun });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.data.code, 'BROKEN_FOREIGN_KEY');
    assert.equal(rawDb.prepare('SELECT id FROM transactions WHERE id = ?').get('tx_raw_roundtrip')?.id, 'tx_raw_roundtrip');
  }

  // A backup's user IDs never select or create the restore owner; the authenticated user is the target.
  fullBackup.data.userId = 'foreign_owner';
  fullBackup.data.data.profile.id = 'foreign_owner';
  fullBackup.data.checksum = await hashPayload(fullBackup.data.data);
  const missingRawBackup = JSON.parse(JSON.stringify(fullBackup.data));
  missingRawBackup.data.raw_notifications = [];
  missingRawBackup.checksum = await hashPayload(missingRawBackup.data);
  for (const dryRun of [true, false]) {
    const invalidRestore = await call(env, '/api/backup/restore', 'POST', { ...missingRawBackup, dryRun });
    assert.equal(invalidRestore.status, 400);
    assert.equal(invalidRestore.data.code, 'BROKEN_FOREIGN_KEY');
    assert.equal(rawDb.prepare('SELECT raw_notification_id FROM transactions WHERE id = ?').get('tx_raw_roundtrip')?.raw_notification_id, 'raw_roundtrip');
  }

  const fullRestore = await call(env, '/api/backup/restore', 'POST', fullBackup.data);
  assert.equal(fullRestore.status, 200, JSON.stringify(fullRestore.data));
  assert.equal(Number(rawDb.prepare('PRAGMA foreign_keys').get()?.foreign_keys), 1);
  assert.equal(rawDb.prepare('SELECT raw_notification_id FROM transactions WHERE id = ?').get('tx_raw_roundtrip')?.raw_notification_id, 'raw_roundtrip');
  assert.equal(rawDb.prepare('SELECT id FROM users WHERE id = ?').get(ownerId)?.id, ownerId);
  assert.equal(rawDb.prepare('SELECT id FROM users WHERE id = ?').get('foreign_owner'), undefined);
  assert.equal(rawDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(ownerId)?.password_hash, 'private-password-hash');
  assert.equal(rawDb.prepare('SELECT token_hash FROM devices WHERE id = ?').get('device_secret')?.token_hash, 'private-device-token-hash');
  assert.equal(rawDb.prepare('SELECT id FROM raw_notifications WHERE id = ?').get('raw_roundtrip')?.id, 'raw_roundtrip');

  const noRawRestore = await call(env, '/api/backup/restore', 'POST', defaultBackup.data);
  assert.equal(noRawRestore.status, 200, JSON.stringify(noRawRestore.data));
  assert.equal(rawDb.prepare('SELECT raw_notification_id FROM transactions WHERE id = ?').get('tx_raw_roundtrip')?.raw_notification_id, null);
  assert.equal(rawDb.prepare('SELECT id FROM raw_notifications WHERE id = ?').get('raw_roundtrip')?.id, 'raw_roundtrip');
});
