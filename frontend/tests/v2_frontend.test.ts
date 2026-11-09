import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  allocateVndExact,
  formatPrivacyVND,
  formatPrivacyText
} from '../src/utils/financeMath';

import { calculateXIRR } from '../src/utils/xirr';
import { isTxnInPeriod, periodBoundsUtc } from '../src/utils/dateUtils';
import {
  API_BASE,
  checkAuthSession,
  checkAuthSessionWithTimeout,
  getAuthToken,
  getDraftOutbox,
  fetchAllTransactions,
  isTrustedApiUrl,
  replayDraftOutbox,
  saveDraftToOutbox,
  setAuthToken,
  apiRequestJson
} from '../src/services/apiClient';
import { getBackupPreviewCounts, isVerifiedBackupDryRun } from '../src/utils/backupPreview';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readServerCollection } from '../src/utils/serverCollections';
import { hasVerifiedPriceUpdates } from '../src/utils/marketSync';
import { resolvePlannedValue } from '../src/utils/plannedSummary';
import { applyResetScope } from '../src/utils/resetState';
import { fetchFmarketFunds, parseFmarketFundsResponse } from '../src/utils/fmarketFunds';
import { addInvestmentCashflow, deleteInvestmentCashflow, getInvestmentCashflows, parseInvestmentCashflowsResponse, setInvestmentHistoryCompleteFrom } from '../src/utils/investmentCashflows';
import frontendWorker from '../src/worker';

describe('Auth session startup check', () => {
  it('distinguishes signed-out responses from temporary server failures', async () => {
    assert.strictEqual(await checkAuthSession(async () => new Response(null, { status: 200 })), 'signedIn');
    assert.strictEqual(await checkAuthSession(async () => new Response(null, { status: 401 })), 'signedOut');
    assert.strictEqual(await checkAuthSession(async () => new Response(null, { status: 403 })), 'signedOut');
    assert.strictEqual(await checkAuthSession(async () => new Response(null, { status: 503 })), 'unavailable');
  });

  it('passes the abort signal to the injectable fetch and leaves network errors visible to the caller', async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const state = await checkAuthSession(async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      return new Response(null, { status: 200 });
    }, controller.signal);
    assert.strictEqual(state, 'signedIn');
    assert.strictEqual(observedSignal, controller.signal);
    await assert.rejects(() => checkAuthSession(async () => { throw new Error('offline'); }), /offline/);
  });

  it('clears its timeout after a fast response so it cannot abort the completed request later', async () => {
    let observedSignal: AbortSignal | undefined;
    const check = checkAuthSessionWithTimeout(async (_input, init) => {
      observedSignal = init?.signal as AbortSignal;
      return new Response(null, { status: 200 });
    }, 20);

    assert.strictEqual(await check.promise, 'signedIn');
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.strictEqual(observedSignal?.aborted, false);
    check.cancel();
  });
});

describe('Fmarket fund catalog', () => {
  it('parses the production endpoint shape and only exposes a fresh verified NAV as selectable', () => {
    const result = parseFmarketFundsResponse({
      source: 'FireAnt Fmarket',
      stale: false,
      funds: [
        { shortName: 'VESAF', name: 'Vietcombank Equity', nav: 24567.89, navDate: '2026-11-08T00:00:00.000Z', updatedAt: 1794096000000, stale: false },
        { shortName: 'OLD', name: 'Old Fund', nav: 12000, navDate: '2026-10-01T00:00:00.000Z', stale: true },
        { shortName: 'NO-NAV', name: 'No NAV', nav: null, navDate: null, stale: false }
      ]
    });
    assert.strictEqual(result.funds[0].shortName, 'VESAF');
    assert.strictEqual(result.funds[0].nav, 24567.89);
    assert.strictEqual(result.funds[0].navDate, '2026-11-08T00:00:00.000Z');
    assert.strictEqual(result.funds[0].navAvailable, true);
    assert.strictEqual(result.funds[1].navAvailable, false);
    assert.strictEqual(result.funds[2].nav, null);
    assert.strictEqual(result.status, 'stale');
  });

  it('fetches same-origin endpoint with same-origin cookies and reports unavailable on HTTP/network errors', async () => {
    let observedUrl = '';
    let observedCredentials = '';
    const ok = await fetchFmarketFunds(async (input, init) => {
      observedUrl = String(input);
      observedCredentials = String(init?.credentials);
      return new Response(JSON.stringify({ stale: false, funds: [{ shortName: 'ABC', nav: 100, navDate: '2026-11-08', stale: false }] }), { status: 200 });
    });
    assert.strictEqual(observedUrl, '/api/market/fmarket-funds');
    assert.strictEqual(observedCredentials, 'same-origin');
    assert.strictEqual(ok.funds[0].navAvailable, true);

    const unavailable = await fetchFmarketFunds(async () => new Response(JSON.stringify({ funds: [], stale: true }), { status: 503 }));
    assert.strictEqual(unavailable.status, 'unavailable');
    const networkError = await fetchFmarketFunds(async () => { throw new Error('offline'); });
    assert.strictEqual(networkError.status, 'unavailable');
    assert.deepStrictEqual(networkError.funds, []);
  });
});

describe('Investment XIRR API response', () => {
  it('uses only the backend cashflow and XIRR contract, preserving an explicit incomplete result', () => {
    const result = parseInvestmentCashflowsResponse({
      cashflows: [
        { id: 'cf-1', type: 'contribution', amount_vnd: 1000000, occurred_at: '2026-01-02', note: 'Vốn ban đầu' },
        { id: 'cf-2', type: 'withdrawal', amount_vnd: 200000, occurred_at: '2026-05-03' }
      ],
      historyCompleteFrom: null,
      xirr: { rate: null, annualizedPct: null, reasonCode: 'INCOMPLETE_HISTORY', message: 'Xác nhận mốc đầy đủ lịch sử', terminalValueVnd: null, valuationDate: null, priceAsOfOldest: '2026-11-01T00:00:00.000Z' }
    });
    assert.strictEqual(result.cashflows.length, 2);
    assert.strictEqual(result.cashflows[0].amountVnd, 1000000);
    assert.strictEqual(result.historyCompleteFrom, null);
    assert.strictEqual(result.xirr?.annualizedPct, null);
    assert.strictEqual(result.xirr?.message, 'Xác nhận mốc đầy đủ lịch sử');
    assert.strictEqual(result.xirr?.priceAsOfOldest, '2026-11-01T00:00:00.000Z');
    const unsupportedCurrency = parseInvestmentCashflowsResponse({ cashflows: [], historyCompleteFrom: '2026-01-01', xirr: { rate: null, annualizedPct: null, reasonCode: 'UNSUPPORTED_CURRENCY', message: 'Không có quy đổi FX được xác minh', priceAsOfOldest: null } });
    assert.strictEqual(unsupportedCurrency.xirr?.reasonCode, 'UNSUPPORTED_CURRENCY');
    assert.strictEqual(unsupportedCurrency.xirr?.annualizedPct, null);
    assert.strictEqual(unsupportedCurrency.xirr?.priceAsOfOldest, null);
  });

  it('rejects malformed top-level responses instead of rendering fabricated empty history', () => {
    assert.throws(() => parseInvestmentCashflowsResponse({ error: 'offline' }), /danh sách dòng tiền hợp lệ/);
    assert.throws(() => parseInvestmentCashflowsResponse(null), /không hợp lệ/);
    assert.throws(() => parseInvestmentCashflowsResponse({ cashflows: [{ id: 'bad', type: 'unknown' }], historyCompleteFrom: null, xirr: null }), /dòng lịch sử không hợp lệ/);
  });

  it('calls the real same-origin GET/POST/PUT/DELETE paths with their documented payloads', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; method: string; credentials: RequestCredentials | undefined; body?: unknown }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), method: init?.method || 'GET', credentials: init?.credentials, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ cashflows: [], historyCompleteFrom: null, xirr: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await getInvestmentCashflows();
      await addInvestmentCashflow({ type: 'contribution', amountVnd: 5000, occurredAt: '2026-11-08', note: 'Test' });
      await setInvestmentHistoryCompleteFrom('2026-01-01');
      await deleteInvestmentCashflow('id/1');
      assert.deepStrictEqual(requests.map(({ url, method }) => [url, method]), [
        ['/api/investment-cashflows', 'GET'],
        ['/api/investment-cashflows', 'POST'],
        ['/api/investment-cashflows/completeness', 'PUT'],
        ['/api/investment-cashflows/id%2F1', 'DELETE']
      ]);
      assert.ok(requests.every(request => request.credentials === 'same-origin'));
      assert.deepStrictEqual(requests[1].body, { type: 'contribution', amountVnd: 5000, occurredAt: '2026-11-08', note: 'Test' });
      assert.deepStrictEqual(requests[2].body, { completeFrom: '2026-01-01' });
    } finally { globalThis.fetch = originalFetch; }
  });
});

describe('V2-17 & AT2-31: Frontend Largest Remainder Allocation', () => {
  it('1.000.001 VND chia 33/33/34 tổng đúng chính xác 1.000.001 VND', () => {
    const weights = [33, 33, 34];
    const allocated = allocateVndExact(1000001, weights);
    const sum = allocated.reduce((acc, it) => acc + it, 0);

    assert.strictEqual(sum, 1000001);
    assert.strictEqual(allocated[2], 340001);
  });
});

describe('V2-23 & AT2-37: Chế Độ Riêng Tư & Che Dữ Liệu Nhạy Cảm', () => {
  it('formatPrivacyVND che dấu số tiền khi isPrivateMode = true', () => {
    const hidden = formatPrivacyVND(50000000, true);
    assert.strictEqual(hidden, '•••••• ₫');

    const visible = formatPrivacyVND(50000000, false);
    assert.ok(visible.includes('50.000.000'));
  });

  it('formatPrivacyText che nội dung văn bản khi isPrivateMode = true', () => {
    const hidden = formatPrivacyText('0912345678', true);
    assert.strictEqual(hidden, '••••••');

    const visible = formatPrivacyText('0912345678', false);
    assert.strictEqual(visible, '0912345678');
  });
});

describe('V2-19 & AT2-42: Frontend XIRR Solver', () => {
  it('Dòng tiền -10M và +11M sau 1 năm cho XIRR ~ 10%', () => {
    const cfs = [
      { date: '2025-01-01', amount: -10000000 },
      { date: '2026-01-01', amount: 11000000 }
    ];
    const rate = calculateXIRR(cfs);
    assert.ok(rate !== null);
    assert.ok(Math.abs(rate! - 0.10) < 0.005);
  });
});

describe('V2-15 & AT2-28: Bộ Lọc Kỳ Giao Dịch', () => {
  it('Giao dịch tháng 9/2026 nhận đúng khi lọc theo tháng 9', () => {
    const inSep = isTxnInPeriod('2026-09-15T10:00:00Z', 'month', { year: 2026, month: 9 });
    assert.strictEqual(inSep, true);

    const inOct = isTxnInPeriod('2026-09-15T10:00:00Z', 'month', { year: 2026, month: 10 });
    assert.strictEqual(inOct, false);
  });

  it('Lọc Tất cả (all) luôn trả về true', () => {
    assert.strictEqual(isTxnInPeriod('2026-01-01T00:00:00Z', 'all'), true);
  });

  it('Ranh giới tháng Việt Nam là khoảng [from, to) đúng đầu tháng kế tiếp', () => {
    const bounds = periodBoundsUtc('month', { year: 2026, month: 12 });
    assert.strictEqual(bounds.fromInclusiveUtc, '2026-11-30T17:00:00.000Z');
    assert.strictEqual(bounds.toExclusiveUtc, '2026-12-31T17:00:00.000Z');
  });
});

describe('V2-01 / V2-07: API origin allowlist and durable operation retry', () => {
  it('proxies same-origin API requests through BACKEND and fails closed without the binding', async () => {
    let seen: Request | undefined;
    const request = new Request('https://qltc-app.dtd-store.workers.dev/api/auth/session', {
      headers: { Cookie: '__Secure-qltc_session=opaque-session', Origin: 'https://qltc-app.dtd-store.workers.dev' }
    });
    const proxied = await frontendWorker.fetch(request, {
      ASSETS: { fetch: async () => new Response('assets') },
      BACKEND: { fetch: async (forwarded) => { seen = forwarded; return new Response('backend', { status: 200 }); } }
    });
    assert.strictEqual(proxied.status, 200);
    assert.strictEqual(seen?.headers.get('Cookie'), '__Secure-qltc_session=opaque-session');
    assert.strictEqual(seen?.url, request.url);
    const unavailable = await frontendWorker.fetch(request, { ASSETS: { fetch: async () => new Response('assets') } });
    assert.strictEqual(unavailable.status, 503);
  });

  it('serves the app shell with frame and object embedding disabled', async () => {
    const response = await frontendWorker.fetch(new Request('https://qltc-app.dtd-store.workers.dev/'), {
      ASSETS: { fetch: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) }
    });
    assert.strictEqual(response.headers.get('Content-Security-Policy'), "frame-src 'none'; object-src 'none'");
    assert.match(response.headers.get('Cache-Control') || '', /no-store/);
  });

  it('never reads or persists owner credentials and removes any legacy localStorage copy', () => {
    const values = new Map<string, string>([['qltc_owner_token', 'legacy-secret']]);
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    try {
      assert.strictEqual(getAuthToken(), '');
      assert.strictEqual(values.has('qltc_owner_token'), false);
      setAuthToken('  current-secret  ');
      assert.strictEqual(getAuthToken(), '');
      assert.strictEqual(values.has('qltc_owner_token'), false);
      setAuthToken('');
      assert.strictEqual(getAuthToken(), '');
    } finally {
      setAuthToken('');
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else delete (globalThis as any).localStorage;
    }
  });

  it('sends API requests with same-origin cookies and without bearer credentials', async () => {
    const originalFetch = globalThis.fetch;
    let captured: RequestInit | undefined;
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      await apiRequestJson(`${API_BASE}/auth/session`);
      assert.strictEqual(captured?.credentials, 'same-origin');
      assert.strictEqual(new Headers(captured?.headers).has('Authorization'), false);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('only trusts the configured API origin and /api path', () => {
    assert.strictEqual(isTrustedApiUrl(`${API_BASE}/transactions`), true);
    assert.strictEqual(isTrustedApiUrl('https://qltc-backend.dtd-store.workers.dev.attacker.example/api/transactions'), false);
    assert.strictEqual(isTrustedApiUrl(`${API_BASE}-attacker/transactions`), false);
    assert.strictEqual(isTrustedApiUrl('http://qltc-backend.dtd-store.workers.dev/api/transactions'), false);
  });

  it('keeps a draft after network failure and retries the same operationId and payload', async () => {
    const values = new Map<string, string>();
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalFetch = globalThis.fetch;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); }
      }
    });
    const payload = { id: 'txn_durable_1', amount: 12500, description: 'Cafe' };
    saveDraftToOutbox({ id: payload.id, operationId: 'op_stable_123', endpoint: '/transactions', method: 'POST', payload, createdAt: '2026-11-08T00:00:00.000Z' });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: new URL(String(input), 'https://qltc-app.dtd-store.workers.dev').pathname, init });
      if (requests.length === 1) throw new TypeError('network unavailable');
      return new Response(JSON.stringify({ id: payload.id }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      assert.strictEqual(await replayDraftOutbox(), 0);
      assert.strictEqual(getDraftOutbox().length, 1);
      assert.strictEqual(await replayDraftOutbox(), 1);
      assert.strictEqual(getDraftOutbox().length, 0);
      assert.strictEqual(requests.length, 2);
      for (const request of requests) {
        assert.strictEqual(request.url, `${API_BASE}/transactions`);
        assert.strictEqual(new Headers(request.init?.headers).get('X-Operation-Id'), 'op_stable_123');
        assert.deepStrictEqual(JSON.parse(String(request.init?.body)), payload);
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
      else delete (globalThis as any).localStorage;
    }
  });

  it('uses opaque keyset cursors with a fixed data revision and rejects stale pagination', async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'https://qltc-app.dtd-store.workers.dev');
      requests.push(url.toString());
      const page = url.searchParams.has('cursor')
        ? { transactions: [{ id: 't2' }], pagination: { totalCount: 2, hasMore: false, nextCursor: null, dataRevision: 'rev-7' } }
        : { transactions: [{ id: 't1' }], pagination: { totalCount: 2, hasMore: true, nextCursor: 'opaque+/cursor==', dataRevision: 'rev-7' } };
      return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      assert.deepStrictEqual(await fetchAllTransactions<{ id: string }>(), [{ id: 't1' }, { id: 't2' }]);
      assert.strictEqual(requests.length, 2);
      assert.strictEqual(new URL(requests[0]).searchParams.has('offset'), false);
      assert.strictEqual(new URL(requests[1]).searchParams.get('cursor'), 'opaque+/cursor==');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('shows a reload message when the server rejects a stale cursor', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ code: 'STALE_CURSOR', error: 'stale' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' }
    });
    try {
      await assert.rejects(fetchAllTransactions(), /Lịch sử vừa thay đổi trong lúc tải\. Hãy tải lại/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('V2-23 / V2-26: privacy helpers, restore preview gate, and PWA shell assets', () => {
  it('accepts only a positively validated server dry-run and previews actual record counts', () => {
    assert.strictEqual(isVerifiedBackupDryRun({ dryRun: true, valid: true }), true);
    assert.strictEqual(isVerifiedBackupDryRun({ dryRun: true, valid: false }), false);
    assert.strictEqual(isVerifiedBackupDryRun({ valid: true }), false);
    assert.deepStrictEqual(getBackupPreviewCounts({ accounts: [{ id: 'a' }], transactions: [{ id: 't' }, { id: 'u' }], checksum: 'x' }), [
      { key: 'accounts', count: 1 },
      { key: 'transactions', count: 2 }
    ]);
  });

  it('references existing app-shell assets from index and service worker', () => {
    const root = resolve(process.cwd());
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const sw = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
    const manifest = readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8');
    assert.match(html, /href="\/manifest\.webmanifest"/);
    assert.match(html, /href="\/icon\.svg"/);
    assert.match(sw, /'\/manifest\.webmanifest'/);
    assert.match(sw, /'\/icon\.svg'/);
    for (const asset of ['manifest.webmanifest', 'icon.svg']) {
      assert.strictEqual(existsSync(resolve(root, 'public', asset)), true, `${asset} must exist in public assets`);
    }
    assert.doesNotThrow(() => JSON.parse(manifest));
  });
});

describe('V2-09: fresh server collections do not create demo jars', () => {
  it('treats a valid empty server array as authoritative, while missing data preserves cache', () => {
    const existingCache = [{ id: 'real-jar', name: 'Nhà ở' }];
    const freshServerJars = readServerCollection({ jars: [] }, 'jars', (jar) => jar);
    const unavailableServerJars = readServerCollection({ error: 'offline' }, 'jars', (jar) => jar);

    assert.deepStrictEqual(freshServerJars, []);
    assert.strictEqual(unavailableServerJars, null);
    assert.deepStrictEqual(unavailableServerJars ?? existingCache, existingCache);
  });
});

describe('V2-18: market sync success requires a verified server update', () => {
  it('does not report fresh prices for errors, empty updates, or malformed payloads', () => {
    assert.strictEqual(hasVerifiedPriceUpdates(null), false);
    assert.strictEqual(hasVerifiedPriceUpdates({ error: 'provider unavailable' }), false);
    assert.strictEqual(hasVerifiedPriceUpdates({ updated: {} }), false);
    assert.strictEqual(hasVerifiedPriceUpdates({ updated: [] }), false);
    assert.strictEqual(hasVerifiedPriceUpdates({ updated: { FUND1: { price: 10 } } }), true);
  });
});

describe('V2-15 / V2-16: historical plan summaries do not fall back to current local plans', () => {
  it('keeps explicit server null as unavailable and only uses labeled local fallback for current month after request failure', () => {
    assert.deepStrictEqual(resolvePlannedValue(null, 'loaded', 1250000, true), { amount: null, source: 'none' });
    assert.deepStrictEqual(resolvePlannedValue(undefined, 'error', 1250000, true), { amount: 1250000, source: 'local-unsynced' });
    assert.deepStrictEqual(resolvePlannedValue(undefined, 'error', 1250000, false), { amount: null, source: 'none' });
    assert.deepStrictEqual(resolvePlannedValue(900000, 'loaded', 1250000, true), { amount: 900000, source: 'server' });
  });
});

describe('V2-09: income reset preserves planned expenses and jar settings', () => {
  it('clears only income sources for income scope and reserves broad clearing for all scope', () => {
    const current = {
      accounts: [{ id: 'a1', balance: 450000 }],
      jars: [{ id: 'j1', spentThisMonth: 125000, monthlyLimit: 900000 }],
      holdings: [{ id: 'h1' }],
      incomeSources: [{ id: 'i1' }],
      plannedExpenses: [{ id: 'p1', expectedAmount: 300000 }],
      pendingTransactions: [{ id: 't1' }],
      confirmedTransactions: [{ id: 't2' }]
    };

    const incomeReset = applyResetScope(current, 'income');
    assert.deepStrictEqual(incomeReset.incomeSources, []);
    assert.strictEqual(incomeReset.plannedExpenses, current.plannedExpenses);
    assert.strictEqual(incomeReset.jars, current.jars);
    assert.strictEqual(incomeReset.jars[0].monthlyLimit, current.jars[0].monthlyLimit);
    assert.strictEqual(incomeReset.jars[0].spentThisMonth, current.jars[0].spentThisMonth);
    assert.strictEqual(incomeReset.pendingTransactions, current.pendingTransactions);
    assert.strictEqual(incomeReset.confirmedTransactions, current.confirmedTransactions);
    assert.strictEqual(incomeReset.accounts, current.accounts);
    assert.strictEqual(incomeReset.holdings, current.holdings);

    const allReset = applyResetScope(current, 'all');
    assert.deepStrictEqual(allReset.plannedExpenses, []);
    assert.strictEqual(allReset.jars[0].monthlyLimit, 0);
    assert.strictEqual(allReset.jars[0].spentThisMonth, 0);
    assert.strictEqual(allReset.accounts[0].balance, 0);
    assert.deepStrictEqual(allReset.pendingTransactions, []);
    assert.deepStrictEqual(allReset.confirmedTransactions, []);
    assert.deepStrictEqual(allReset.holdings, []);
  });
});
