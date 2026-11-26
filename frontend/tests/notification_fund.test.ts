import { it } from 'node:test';
import assert from 'node:assert/strict';
import { detectNotificationFund } from '../src/utils/notificationFund';
import type { FmarketFund, Holding, Transaction } from '../src/types';

const catalog: FmarketFund[] = [
  { shortName: 'VESAF', name: 'Quỹ VinaCapital', nav: null },
  { shortName: 'DCDS', name: 'Quỹ Dragon Capital', nav: null },
  { shortName: 'VCBF-BCF', name: 'Quỹ VCBF', nav: null }
];
const base: Transaction = {
  id: 't', type: 'expense', amount: 1000000, description: 'Chuyen tien - vesaf -', bankCode: 'VCB', accountName: 'Bank', accountMask: '',
  suggestedCategory: 'Chi tiêu', suggestedJarCode: '', occurredAt: '', status: 'pending'
};
const owned: Holding = { id: 'h', symbol: 'VESAF', name: 'Owned fund', assetClass: 'fund', quantity: 100, avgCost: 30000, currentPrice: 35000, unit: 'CCQ' };

it('detects the complete known ticker and distinguishes an owned fund from a first purchase', () => {
  assert.equal(detectNotificationFund(base, catalog, [owned])?.holding?.id, 'h');
  assert.equal(detectNotificationFund({ ...base, description: 'DCDS - mua chung chi quy' }, catalog, [owned])?.symbol, 'DCDS');
  assert.equal(detectNotificationFund({ ...base, description: 'DCDS - mua chung chi quy' }, catalog, [owned])?.holding, undefined);
  assert.equal(detectNotificationFund({ ...base, description: 'Mua VCBF-BCF' }, catalog, [])?.symbol, 'VCBF-BCF');
  assert.equal(detectNotificationFund(base, [], [owned])?.holding?.id, 'h', 'owned symbols remain recognizable if the catalog is unavailable');
});

it('does not auto-allocate incoming refunds, partial tickers, ambiguous symbols, or an already linked purchase', () => {
  assert.equal(detectNotificationFund({ ...base, type: 'income' }, catalog, [owned]), null);
  assert.equal(detectNotificationFund({ ...base, description: 'VESAF123456' }, catalog, [owned]), null);
  assert.equal(detectNotificationFund({ ...base, description: 'XVESAF' }, catalog, [owned]), null);
  assert.equal(detectNotificationFund({ ...base, description: 'Mua VESAF va DCDS' }, catalog, [owned]), null);
  assert.equal(detectNotificationFund({ ...base, fundPurchase: { symbol: 'VESAF', holdingId: 'h', quantity: 1, unitPrice: 30000, alreadyRecorded: false } }, catalog, [owned]), null);
  assert.equal(detectNotificationFund(base, catalog, [owned, { ...owned, id: 'another' }]), null);
});
