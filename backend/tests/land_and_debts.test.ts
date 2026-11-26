import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import app from '../src/index';
import { hashPayload } from '../src/services/ledger';
import { createSqliteD1 } from './d1Helper';

async function setup(legacy = false, key?: string, existingDebts = false) {
  const h = createSqliteD1();
  if (legacy) h.rawDb.exec(readFileSync(new URL('./fixtures/legacy_v1_schema.sql', import.meta.url), 'utf8'));
  if (existingDebts) {
    const ddl = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
      .match(/CREATE TABLE IF NOT EXISTS debts \([\s\S]*?\n\);/)?.[0];
    assert.ok(ddl);
    h.rawDb.exec(ddl.replace(/^\s*kind TEXT [^\r\n]+\r?\n/m, ''));
    h.rawDb.exec("INSERT INTO debts (id,user_id,name,principal_vnd) VALUES ('old-debt','previous-owner','Nợ trước cập nhật',40000)");
  }
  const env = { DB: h.db, OWNER_API_TOKEN: 'land-debt-owner-test', LAND_PRICE_API_KEY: key };
  async function call(path: string, method = 'GET', body?: object) {
    const response = await app.fetch(new Request(`https://test.local${path}`, {
      method, headers: { Authorization: 'Bearer land-debt-owner-test', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    }), env, { waitUntil() {} });
    return { status: response.status, data: await response.json() as any };
  }
  const account = await call('/api/accounts', 'POST', { id: 'sample-wallet', name: 'Test VCB', type: 'bank', bankCode: 'VCB', accountNumber: '0123456789', balance: 1000000 });
  assert.equal(account.status, 200, JSON.stringify(account.data));
  return { ...h, call, balance: () => h.rawDb.prepare("SELECT balance FROM accounts WHERE id='sample-wallet'").get()?.balance };
}

const position = { lat: 21.028511, lng: 105.834211 };
const query = { ...position, area: 100, radiusKm: 2, landUse: 'residential', access: 'frontage' };
const parcel = { ...position, address: 'Địa chỉ thử nghiệm', parcel: '12/5', landUse: 'residential', access: 'frontage', valuation: null };
const holding = { symbol: 'LAND1', name: 'Lô mẫu', assetClass: 'land', quantity: 100, unit: 'm²', avgCost: 18000000, currentPrice: 20000000,
  landDetails: parcel, operationId: 'land-test-create' };
const debtFields = { expectedRevision: null, name: 'Nợ mua đất mẫu', principalVnd: 700000, chargesVnd: 15000,
  dueOn: '2026-11-28', dueVnd: 150000, operationId: 'debt-test-create' };

it('surveys real land asking price inputs by coordinates and excludes duplicates, incompatible and stale listings', async () => {
  const h = await setup(false, 'not-a-real-key');
  const original = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const row = { listing_id: 'a', transaction: 'ban', property_type: 'dat', title: 'Đất thổ cư mặt tiền', source: 'nhatot.com',
    lat: position.lat + 0.001, lng: position.lng, price_value: 1900000000, price_unit: 'total', area: 100, date: today };
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    assert.equal(init?.redirect, 'manual', 'Workers rejects redirect:error before sending provider requests');
    assert.equal(url.origin + url.pathname, 'https://dulieu.dev/api/realestate/nearby');
    assert.equal(url.searchParams.get('lat'), '21.0285');
    assert.equal(url.searchParams.get('lng'), '105.8342');
    assert.equal(url.searchParams.get('transaction'), 'ban');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer not-a-real-key');
    return Response.json({ data: [row, { ...row, listing_id: 'duplicate', source: 'guland.vn' },
      { ...row, listing_id: 'b', lat: position.lat + 0.002, price_value: 20000000, price_unit: 'per_m2' },
      { ...row, listing_id: 'c', lat: position.lat + 0.003, price_value: 2100000000 },
      { ...row, listing_id: 'house', property_type: 'nha-rieng', price_value: 20000000000 },
      { ...row, listing_id: 'rent', transaction: 'cho-thue' },
      { ...row, listing_id: 'far', lat: position.lat + 0.1 },
      { ...row, listing_id: 'old', date: '2020-01-01' },
      { ...row, listing_id: 'alley', title: 'Đất trong hẻm' },
      { ...row, listing_id: 'missing-unit', price_unit: null }
    ] });
  }) as typeof fetch;
  try {
    const result = await h.call('/api/land/survey', 'POST', query);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.valuation.kind, 'asking');
    assert.equal(result.data.valuation.sampleCount, 3);
    assert.equal(result.data.valuation.lowPerM2, 19500000);
    assert.equal(result.data.valuation.medianPerM2, 20000000);
    assert.equal(result.data.valuation.highPerM2, 20500000);
    assert.equal(result.data.comparisons.length, 3);
    assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM holdings').get()?.n, 0, 'surveying must not change a value');
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('reports an unconfigured land price source and never fabricates a quote', async () => {
  const h = await setup();
  assert.equal((await h.call('/api/land/survey', 'POST', { ...query, lat: 90 })).status, 400);
  const unavailable = await h.call('/api/land/survey', 'POST', query);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.data.code, 'LAND_PRICE_NOT_CONFIGURED');
  h.rawDb.close();
});

it('uses explicitly labeled ward comparisons when the radius API is unavailable without inventing coordinates', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  const row = { source: 'nhatot.com', title: 'Đất thổ cư mặt tiền A', ward: 'X. Nhà Bè mới', area: 100, price_per_m2: 19000000, date: today };
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/nearby')) return new Response('', { status: 503 });
    if (url.pathname === '/api/geo/resolve') {
      assert.match(url.searchParams.get('q') || '', /21\.0285,105\.8342/);
      return Response.json({ data: [{ ...position, province_key: 'ho-chi-minh', ward: 'Xã Nhà Bè', district: null, confidence: 'medium' }] });
    }
    if (url.pathname === '/api/realestate/suggest') {
      return Response.json({ data: [{ type: 'ward', name: 'X. Nhà Bè mới', province: 'ho-chi-minh', district: 'H. Nhà Bè' }] });
    }
    if (url.pathname === '/api/realestate') return new Response('', { status: 503 });
    assert.equal(url.pathname, '/api/realestate/estimate');
    assert.equal(url.searchParams.get('ward'), 'Nhà Bè');
    assert.equal(url.searchParams.get('type'), 'land');
    return Response.json({ data: [{ used_tier: { tier: 'ward', n: 999 }, comps: [row,
      { ...row, title: 'Đất thổ cư mặt tiền B', price_per_m2: 20000000 },
      { ...row, title: 'Đất thổ cư mặt tiền C', price_per_m2: 21000000 },
      { ...row, title: 'Đất thổ cư mặt tiền ngoài khu vực', ward: 'Bến Thành', price_per_m2: 100000000 },
      { ...row, title: 'Đất thổ cư mặt tiền quá lớn', area: 1000 }
    ] }] });
  }) as typeof fetch;
  try {
    const response = await h.call('/api/land/survey', 'POST', { ...query, allowRegion: true });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.scope, 'ward');
    assert.equal(response.data.locationLabel, 'Xã Nhà Bè');
    assert.equal(response.data.valuation.medianPerM2, 20000000);
    assert.equal(response.data.valuation.sampleCount, 3);
    assert.ok(response.data.comparisons.every((comparison: any) => comparison.distanceM === null));
    const saved = await h.call('/api/holdings', 'POST', { ...holding, landDetails: { ...parcel, valuation: response.data.valuation } });
    assert.equal(saved.status, 200);
    const backup = await h.call('/api/backup/export');
    assert.equal((await h.call('/api/backup/restore', 'POST', backup.data)).status, 200);
    const restored = (await h.call('/api/holdings')).data.holdings[0];
    assert.equal(restored.landDetails.valuation.scope, 'ward');
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('resolves a mislabeled commune to its listing district without a slow keyword search', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  const row = { province: 'ha-noi', district: 'H. Thanh Trì', ward: 'X. Ngọc Hồi mới', transaction: 'ban', property_type: 'dat',
    title: 'Bán đất thổ cư trong ngõ A', area: 100, price_unit: 'total', price_value: 1900000000 };
  const paths: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    paths.push(url.pathname);
    if (url.pathname === '/api/realestate/nearby') return new Response('', { status: 503 });
    if (url.pathname === '/api/geo/resolve') {
      return Response.json({ data: [{ ...position, province_key: 'ha-noi', district: 'Ngọc Hồi', ward: null, confidence: 'high' }] });
    }
    if (url.pathname === '/api/realestate/suggest') {
      assert.equal(url.searchParams.get('q'), 'Ngọc Hồi');
      return Response.json({ data: [
        { type: 'district', name: 'Ngọc Hồi', province: 'kon-tum', district: 'Ngọc Hồi' },
        { type: 'ward', name: 'X. Ngọc Hồi mới', province: 'ha-noi', district: 'H. Thanh Trì' },
        { type: 'ward', name: 'Xã Ngọc Hồi', province: 'ha-noi', district: 'Huyện Thanh Trì' }
      ] });
    }
    assert.equal(url.pathname, '/api/realestate');
    assert.equal(url.searchParams.get('q'), null);
    assert.equal(url.searchParams.get('district'), 'Thanh Trì');
    assert.equal(url.searchParams.get('province'), 'ha-noi');
    assert.equal(url.searchParams.get('type'), 'dat');
    assert.equal(url.searchParams.get('limit'), '150');
    assert.equal(url.searchParams.get('date'), null);
    return Response.json({ data: [row,
      { ...row, title: 'Đất ở trong ngõ B', price_value: 2000000000 },
      { ...row, title: 'Đất thổ cư trong ngách C', price_unit: 'per_m2', price_value: 21000000 },
      { ...row, title: 'Đất thổ cư ngõ ngoài xã', ward: 'Xã Nam Phù', price_value: 9000000000 },
      { ...row, title: 'Đất ở trong ngõ ngoài huyện', district: 'H. Thanh Oai', price_value: 9000000000 },
      { ...row, title: 'Đất ở trong ngõ ngoài tỉnh', province: 'bac-ninh', price_value: 9000000000 },
      { ...row, title: 'Đất ở trong ngõ diện tích lớn', area: 300, price_value: 9000000000 },
      { ...row, title: 'Đất thổ cư mặt tiền', price_value: 9000000000 },
      { ...row, title: 'Đất nông nghiệp trong ngõ', price_value: 9000000000 }
    ] });
  }) as typeof fetch;
  try {
    const response = await h.call('/api/land/survey', 'POST', { ...query, access: 'alley', allowRegion: true });
    assert.equal(response.status, 200);
    assert.equal(response.data.scope, 'ward');
    assert.equal(response.data.locationLabel, 'Ngọc Hồi');
    assert.equal(response.data.valuation?.medianPerM2, 20000000);
    assert.equal(response.data.sampleCount, 3);
    assert.deepEqual(paths, ['/api/realestate/nearby', '/api/geo/resolve', '/api/realestate/suggest', '/api/realestate']);
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('uses distinct recent listings and separates reference prices from comparable land', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  const days = [0, 7, 14].map(daysAgo => new Date(Date.now() + 7 * 3600_000 - daysAgo * 86_400_000).toISOString().slice(0, 10));
  const dates: (string | null)[] = [];
  let compatible = false;
  const listing = (id: string, area: number, price: number, date: string) => ({
    source: 'nhatot.com', source_id: 'nhatot.com:' + id, province: 'ha-noi', district: 'H. Thanh Trì', ward: 'X. Ngọc Hồi mới',
    transaction: 'ban', property_type: 'dat', title: (compatible ? 'Đất thổ cư trong ngõ ' : 'Bán đất lô ') + id,
    area, price_unit: 'per_m2', price_value: price, date,
    fetched_at: new Date(Date.parse(date) - 3600_000).toISOString()
  });
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/nearby')) return new Response('', { status: 503 });
    if (url.pathname === '/api/geo/resolve') {
      return Response.json({ data: [{ ...position, province_key: 'ha-noi', ward: 'Xã Ngọc Hồi', district: 'Huyện Thanh Trì', confidence: 'high' }] });
    }
    assert.equal(url.pathname, '/api/realestate');
    const date = url.searchParams.get('date');
    dates.push(date);
    if (!date) return Response.json({ data: [
      listing('a', 40, 120000000, days[0]),
      { ...listing('auction', 39, 1000000, days[0]), title: 'Đấu giá đất, giá khởi điểm 39 triệu' },
      { ...listing('outside', 39, 900000000, days[0]), ward: 'Xã Nam Phù', title: 'Tin ở xã khác' }
    ] });
    if (date === days[1]) return Response.json({ data: [
      { ...listing('a', 40, 1000000, date), title: 'Đất thổ cư trong ngõ, giá cũ' },
      listing('b', 41, 124000000, date)
    ] });
    assert.equal(date, days[2]);
    return Response.json({ data: [listing('c', 45, 126000000, date), listing('larger', 90, 140000000, date)] });
  }) as typeof fetch;
  try {
    const input = { ...query, area: 39, access: 'alley', allowRegion: true };
    const result = await h.call('/api/land/survey', 'POST', input);
    assert.equal(result.status, 200);
    assert.deepEqual(dates, [null, days[1], days[2]]);
    assert.equal(result.data.valuation, null);
    assert.equal(result.data.sampleCount, 0);
    assert.equal(result.data.reference.locationLabel, 'Xã Ngọc Hồi');
    assert.deepEqual(result.data.reference.comparisons.map((row: any) => [row.area, row.perM2]),
      [[40, 120000000], [41, 124000000], [45, 126000000], [90, 140000000]]);
    assert.equal(result.data.reference.comparisons[0].observedOn, days[0]);
    assert.equal(result.data.reference.valuation, undefined);
    compatible = true;
    const comparable = await h.call('/api/land/survey', 'POST', input);
    assert.equal(comparable.data.sampleCount, 3);
    assert.equal(comparable.data.valuation.medianPerM2, 124000000);
    assert.equal(comparable.data.reference, undefined);
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('distinguishes a provider timeout from a successful search with too few matches', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  let listingAvailable = true;
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    if (path === '/api/realestate/nearby') return new Response('', { status: 503 });
    if (path === '/api/geo/resolve') {
      return Response.json({ data: [{ ...position, province_key: 'ha-noi', ward: 'Xã Ngọc Hồi', district: 'Huyện Thanh Trì', confidence: 'high' }] });
    }
    if (path === '/api/realestate' && listingAvailable) return Response.json({ data: [] });
    throw new DOMException('Simulated timeout', 'AbortError');
  }) as typeof fetch;
  try {
    const input = { ...query, allowRegion: true };
    const empty = await h.call('/api/land/survey', 'POST', input);
    assert.equal(empty.status, 200);
    assert.equal(empty.data.sampleCount, 0);
    assert.equal(empty.data.valuation, null);
    listingAvailable = false;
    const unavailable = await h.call('/api/land/survey', 'POST', input);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.data.code, 'LAND_PRICE_TIMEOUT');
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('never uses a province-wide estimate as the price of the chosen plot', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/nearby')) return Response.json({ data: [] });
    if (url.pathname === '/api/geo/resolve') return Response.json({ data: [{ ...position, province_key: 'ha-noi', ward: 'Phường mẫu', district: 'Quận mẫu', confidence: 'high' }] });
    if (url.pathname === '/api/realestate') return new Response('', { status: 503 });
    assert.equal(url.pathname, '/api/realestate/estimate');
    return Response.json({ data: [{ used_tier: { tier: 'province', n: 1000 }, median_ppm2: 99999999, comps: [] }] });
  }) as typeof fetch;
  try {
    const response = await h.call('/api/land/survey', 'POST', { ...query, allowRegion: true });
    assert.equal(response.status, 200);
    assert.equal(response.data.valuation, null);
    assert.equal(response.data.sampleCount, 0);
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('keeps older interfaces radius-only until they support regional coverage', async () => {
  const h = await setup(false, 'provider-test-key');
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/api/realestate/nearby');
    return Response.json({ data: [] });
  }) as typeof fetch;
  try {
    const response = await h.call('/api/land/survey', 'POST', query);
    assert.equal(response.status, 200);
    assert.equal(response.data.scope, undefined);
    assert.equal(response.data.valuation, null);
  } finally { globalThis.fetch = original; h.rawDb.close(); }
});

it('keeps the plot and user-selected value when saving twice or reopening a backup', async () => {
  const h = await setup(true);
  const saved = await h.call('/api/holdings', 'POST', holding);
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const replay = await h.call('/api/holdings', 'POST', holding);
  assert.equal(replay.data.id, saved.data.id);
  const second = await h.call('/api/holdings', 'POST', { ...holding, operationId: 'land-second', currentPrice: 30000000, landDetails: { ...parcel, lat: parcel.lat + 0.002 } });
  assert.equal(second.status, 200);
  assert.notEqual(second.data.assetId, saved.data.assetId);
  assert.equal((await h.call('/api/holdings', 'POST', { ...holding, id: saved.data.id, revision: 2, operationId: 'land-stale' })).status, 409);
  const update = await h.call('/api/holdings', 'POST', { ...holding, id: saved.data.id, revision: 1, currentPrice: 22000000, operationId: 'land-edit' });
  assert.equal(update.status, 200, JSON.stringify(update.data));
  const backup = await h.call('/api/backup/export');
  assert.equal(backup.status, 200);
  assert.equal((await h.call('/api/backup/restore', 'POST', backup.data)).status, 200);
  const listed = (await h.call('/api/holdings')).data.holdings;
  const first = listed.find((row: any) => row.id === saved.data.id);
  assert.deepEqual(first.landDetails, parcel);
  assert.equal(first.marketValueVnd, 2200000000);
  assert.equal(listed.find((row: any) => row.id === second.data.id).current_price, 30000000);
  h.rawDb.close();
});

for (const legacy of [false, true]) {
  it(`links a bank notice to repayment once and reverses it safely on ${legacy ? 'legacy' : 'fresh'} storage`, async () => {
    const h = await setup(legacy);
    const land = await h.call('/api/holdings', 'POST', holding);
    const added = await h.call('/api/debts', 'POST', { ...debtFields, collateralHoldingId: land.data.id });
    assert.equal(added.status, 200, JSON.stringify(added.data));
    const id = added.data.id;
    assert.equal(h.balance(), 1000000, 'recording existing debt must not change cash');
    const notice = await h.call('/api/notifications/ingest', 'POST', { eventId: 'debt-test-notice', packageName: 'com.VCB', title: 'VCB',
      text: 'TK 0123456789 -150,000 VND. SD: 850,000 VND. ND: Tra no', occurredAt: Date.now() });
    assert.equal(notice.status, 200);
    const bankTx = notice.data.transactionId;
    assert.ok(bankTx);
    const payload = { accountId: 'sample-wallet', principalVnd: 130000, chargesVnd: 20000, transactionId: bankTx,
      expectedTransactionRevision: 1, expectedRevision: 1, operationId: 'debt-repay-test' };
    const url = `/api/debts/${id}/repay`;
    assert.equal((await h.call(url, 'POST', { ...payload, chargesVnd: 19999 })).status, 409);
    h.setFailOnSqlPattern('INSERT INTO ledger_postings');
    assert.equal((await h.call(url, 'POST', payload)).status, 503);
    assert.equal(h.balance(), 1000000);
    assert.equal(h.rawDb.prepare('SELECT principal_vnd FROM debts WHERE id=?').get(id)?.principal_vnd, 700000);
    assert.equal(h.rawDb.prepare('SELECT COUNT(*) AS n FROM debt_payments').get()?.n, 0);
    h.setFailOnSqlPattern(null);
    const replies = await Promise.all([h.call(url, 'POST', payload), h.call(url, 'POST', payload)]);
    assert.ok(replies.every(reply => reply.status === 200), JSON.stringify(replies));
    const paymentId = replies[0].data.id;
    assert.equal(replies[1].data.id, paymentId);
    const recorded = (await h.call('/api/debts')).data;
    assert.equal(recorded.debts[0].principal_vnd, 570000);
    assert.equal(recorded.debts[0].charges_vnd, 0);
    assert.equal(recorded.debts[0].collateral_holding_id, land.data.id);
    assert.equal(recorded.payments.length, 1);
    assert.equal(h.balance(), 850000);
    assert.equal(h.rawDb.prepare("SELECT SUM(amount) AS n FROM transactions WHERE status='confirmed' AND type='expense'").get()?.n, 20000);
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM ledger_postings WHERE reason='debt_repayment'").get()?.n, 1);
    assert.equal((await h.call(`/api/transactions/${bankTx}`, 'PUT', { status: 'confirmed' })).status, 409);

    const backup = await h.call('/api/backup/export');
    const older = structuredClone(backup.data);
    delete older.data.debts; delete older.data.debt_payments;
    older.checksum = await hashPayload(older.data);
    assert.equal((await h.call('/api/backup/restore', 'POST', older)).data.code, 'DEBT_BACKUP_REQUIRED');
    assert.equal((await h.call('/api/backup/restore', 'POST', backup.data)).status, 200);
    assert.equal((await h.call('/api/debts')).data.payments[0].id, paymentId);
    const undo = await h.call(`/api/debts/${id}/payments/${paymentId}/undo`, 'POST', { operationId: 'debt-undo-test' });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    assert.equal(h.balance(), 1000000);
    const afterUndo = (await h.call('/api/debts')).data;
    assert.equal(afterUndo.debts[0].principal_vnd, 700000);
    assert.equal(afterUndo.debts[0].charges_vnd, 15000);
    assert.equal(afterUndo.payments.length, 0);
    assert.equal(h.rawDb.prepare('SELECT status FROM transactions WHERE id=?').get(bankTx)?.status, 'pending');
    h.rawDb.close();
  });
}

it('credits a borrower repayment once and keeps loan principal, backup and undo consistent on an existing database', async () => {
  const h = await setup(true, undefined, true);
  try {
    const previous = h.rawDb.prepare("SELECT kind, principal_vnd FROM debts WHERE id='old-debt'").get();
    assert.equal(previous?.kind, 'payable');
    assert.equal(previous?.principal_vnd, 40000);
    const add = (name: string, kind: 'receivable' | 'payable', principalVnd: number, operationId: string) =>
      h.call('/api/debts', 'POST', { name, kind, principalVnd, creditor: 'Người đối chiếu', expectedRevision: null, operationId });
    const loan = await add('Khoản cho vay mẫu', 'receivable', 700000, 'add-test-loan');
    const secondLoan = await add('Khoản cho vay khác', 'receivable', 800000, 'add-other-test-loan');
    const payable = await add('Nợ phải trả mẫu', 'payable', 800000, 'add-test-payable');
    assert.equal(loan.status, 200);
    assert.equal(secondLoan.status, 200);
    assert.equal(payable.status, 200);
    assert.equal(h.balance(), 1000000);
    assert.deepEqual((await h.call('/api/debts')).data.debts.map((row: any) => row.id), [payable.data.id]);

    const notice = await h.call('/api/notifications/ingest', 'POST', { eventId: 'loan-test-notice', packageName: 'com.VCB', title: 'VCB',
      text: 'TK 0123456789 +250,000 VND. SD: 1,250,000 VND. ND: Tra no dot 1', occurredAt: Date.now() });
    const txId = notice.data.transactionId;
    assert.ok(txId);
    assert.equal(h.rawDb.prepare('SELECT type FROM transactions WHERE id=?').get(txId)?.type, 'income');
    const url = `/api/debts/${loan.data.id}/repay`;
    const body = { type: 'income', accountId: 'sample-wallet', transactionId: txId, expectedTransactionRevision: 1,
      expectedRevision: 1, principalVnd: 250000, chargesVnd: 0, note: ' Trả gốc đợt 1 ', operationId: 'loan-test-collection' };
    assert.equal((await h.call(url, 'POST', { ...body, principalVnd: 249999 })).status, 409);
    assert.equal((await h.call(url, 'POST', { ...body, principalVnd: 700001 })).data.code, 'DEBT_PRINCIPAL_TOO_HIGH');
    assert.equal((await h.call(`/api/debts/${payable.data.id}/repay`, 'POST', body)).data.code, 'INVALID_DEBT_PAYMENT_KIND');
    h.setFailOnSqlPattern('INSERT INTO ledger_postings');
    assert.equal((await h.call(url, 'POST', body)).status, 503);
    assert.equal(h.balance(), 1000000);
    assert.equal(h.rawDb.prepare('SELECT principal_vnd FROM debts WHERE id=?').get(loan.data.id)?.principal_vnd, 700000);
    h.setFailOnSqlPattern(null);

    const [approved, retry] = await Promise.all([h.call(url, 'POST', body), h.call(url, 'POST', body)]);
    assert.equal(approved.status, 200);
    assert.deepEqual(retry, approved);
    assert.equal(h.balance(), 1250000);
    assert.equal((await h.call(`/api/debts/${secondLoan.data.id}/repay`, 'POST', { ...body, operationId: 'loan-test-duplicate' })).status, 409);
    assert.equal((await h.call(`/api/transactions/${txId}`, 'PUT', { status: 'confirmed' })).status, 409);
    const snapshot = await h.call('/api/debts?includeReceivables=1');
    assert.equal(snapshot.data.debts.find((row: any) => row.id === loan.data.id).principal_vnd, 450000);
    assert.equal(snapshot.data.payments[0].note, 'Trả gốc đợt 1');
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM ledger_postings WHERE reason='loan_repayment'").get()?.n, 1);
    assert.equal(h.rawDb.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status='confirmed' AND type='income'").get()?.n, 0);

    const backup = await h.call('/api/backup/export');
    delete backup.data.data.debts.find((row: any) => row.id === payable.data.id).kind;
    backup.data.checksum = await hashPayload(backup.data.data);
    assert.equal((await h.call('/api/backup/restore', 'POST', backup.data)).status, 200);
    const restored = (await h.call('/api/debts?includeReceivables=1')).data;
    assert.equal(restored.debts.find((row: any) => row.id === loan.data.id).kind, 'receivable');
    assert.equal(restored.debts.find((row: any) => row.id === payable.data.id).kind, 'payable');
    assert.equal(restored.payments[0].note, 'Trả gốc đợt 1');

    // A review can explicitly correct an expense prediction to a receipt.
    const finalNotice = await h.call('/api/notifications/ingest', 'POST', { eventId: 'loan-test-final', packageName: 'com.VCB', title: 'VCB',
      text: 'TK 0123456789 -450,000 VND. SD: 1,700,000 VND. ND: Tra no dot 2', occurredAt: Date.now() });
    const finalTx = finalNotice.data.transactionId;
    assert.equal(h.rawDb.prepare('SELECT type FROM transactions WHERE id=?').get(finalTx)?.type, 'expense');
    const final = await h.call(url, 'POST', { ...body, transactionId: finalTx, expectedRevision: 2, principalVnd: 450000, operationId: 'loan-test-final-collection' });
    assert.equal(final.status, 200, JSON.stringify(final.data));
    assert.equal(h.balance(), 1700000);
    assert.equal(h.rawDb.prepare('SELECT principal_vnd FROM debts WHERE id=?').get(loan.data.id)?.principal_vnd, 0);
    const undo = await h.call(`/api/debts/${loan.data.id}/payments/${final.data.id}/undo`, 'POST', { operationId: 'loan-test-undo' });
    assert.equal(undo.status, 200, JSON.stringify(undo.data));
    assert.equal(h.balance(), 1250000);
    assert.equal(h.rawDb.prepare('SELECT principal_vnd FROM debts WHERE id=?').get(loan.data.id)?.principal_vnd, 450000);
    assert.equal(h.rawDb.prepare('SELECT status FROM transactions WHERE id=?').get(finalTx)?.status, 'pending');
  } finally { h.rawDb.close(); }
});
