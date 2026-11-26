import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const dist = resolve(import.meta.dirname, '../dist');
async function fixture({ androidVersion, latestApkVersion = '2.0.3', reviewScenario = false, fundScenario = false, buyScenario = false, losePurchaseReply = false, bankFundScenario = '', loseBankFundReply = false, landDebtScenario = false, regionalLandScenario = false, loanScenario = false, existingLoans = false, swipeScenario = false, assetVisibilityScenario = false, ownerChangeScenario = false, loseOwnerChangeReply = false, rejectUnauthorized = false, slowTransactionDelayMs = 0, failTransactionId = '' } = {}) {
  const transactions = ['expense', 'income'].map((type, index) => ({
    id: `note-${type}`, account_id: 'test-bank', account_name: 'Test bank', bank_code: 'VCB', type,
    amount: index ? 100000 : 50000, description: `Original ${type}`, status: 'pending', occurred_at: '2026-11-09T01:23:45Z',
    jar_id: type === 'expense' ? 'test-jar' : null, revision: 1, source: landDebtScenario || loanScenario ? 'notification' : undefined
  }));
  if (swipeScenario) {
    for (let index = 2; index < 160; index++) transactions.push({
      ...transactions[index % 2], id: 'swipe-' + index, description: 'Giao dịch chờ duyệt ' + index
    });
  }
  if (reviewScenario) {
    transactions[0].review = { type: null, accountId: 'test-bank', bankCode: 'COOPBANK' };
    transactions[1].account_id = 'acc_unassigned';
    transactions[1].needs_account_review = 1;
    transactions[1].review = { type: 'income', accountId: 'other-bank', bankCode: 'HDB' };
  }
  if (bankFundScenario) {
    transactions[0].description = `Chuyen tien mua ${bankFundScenario === 'new' ? 'DCDS' : 'VESAF'}`;
    transactions[0].amount = 812506;
  }
  const saved = [];
  const savedHoldings = [];
  const purchaseRequests = [];
  const purchaseResults = new Map();
  const bankFundRequests = [];
  const bankFundResults = new Map();
  const landSurveys = [];
  const debts = existingLoans ? [
    { id: 'sample-debt', name: 'Cho vay có sẵn', creditor: 'Anh B', kind: 'receivable', principal_vnd: 400000, charges_vnd: 0, revision: 1 }
  ] : [];
  const debtPayments = [];
  const repayments = [];
  const ownerChangeRequests = [];
  const ownerChangeResults = new Map();
  let bankBalance = 1000000;
  const fundHoldings = buyScenario || bankFundScenario === 'owned' ? [{
    id: 'existing-fund', symbol: 'VESAF', asset_name: 'Quỹ đang nắm giữ', asset_class: 'fund', provider: 'fmarket',
    quantity: 100, avg_cost: 30000.25, current_price: 35000, holding_unit: 'CCQ', price_as_of: '2026-11-09', revision: 1
  }] : [];
  if (assetVisibilityScenario) {
    for (const [assetClass, price] of [['fund', 3000000], ['gold', 4000000], ['silver', 5000000], ['land', 6000000]]) {
      fundHoldings.push({ id: 'visibility-' + assetClass, symbol: assetClass.toUpperCase(), asset_name: 'Tài sản ' + assetClass,
        asset_class: assetClass, quantity: 1, avg_cost: price, current_price: price, revision: 1 });
    }
    debts.push(
      { id: 'visibility-loan', name: 'Khoản cho vay', kind: 'receivable', principal_vnd: 300000, charges_vnd: 0, revision: 1 },
      { id: 'visibility-debt', name: 'Nợ phải trả', kind: 'payable', principal_vnd: 100000, charges_vnd: 0, revision: 1 }
    );
  }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      let payload;
      let responseStatus = 200;
      if (landDebtScenario && req.method === 'POST' && path === '/api/land/survey') {
        let body = ''; for await (const chunk of req) body += chunk;
        landSurveys.push(JSON.parse(body));
        payload = { sampleCount: 4, comparisons: [], valuation: { source: 'dulieu.dev', kind: 'asking', surveyedAt: '2026-11-10T03:00:00Z',
          newestSampleOn: '2026-11-09', radiusKm: 2, sampleCount: 4, lowPerM2: 19000000, medianPerM2: 20000000, highPerM2: 21000000 } };
        if (regionalLandScenario) {
          const coverage = { scope: 'ward', locationLabel: 'Xã Nhà Bè' };
          Object.assign(payload, coverage);
          Object.assign(payload.valuation, coverage);
          payload.comparisons = [{ title: 'Lô so sánh thử nghiệm', area: 100, perM2: 20000000, distanceM: null,
            source: 'nhatot.com', observedOn: '2026-11-09', url: null }];
        }
        if (landSurveys.at(-1).access === 'alley') {
          payload = { ...payload, sampleCount: 0, comparisons: [], valuation: null,
            reference: { scope: 'ward', locationLabel: 'Xã Nhà Bè',
              comparisons: [{ title: 'Tin rao tham khảo thử nghiệm', area: 40, perM2: 125000000, distanceM: null,
                source: 'nhatot.com', observedOn: '2026-11-08', url: null }] } };
        }
      } else if ((landDebtScenario || loanScenario) && req.method === 'POST' && path === '/api/debts') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        debts.push({ id: 'sample-debt', name: data.name, creditor: data.creditor, kind: data.kind, principal_vnd: data.principalVnd, charges_vnd: data.chargesVnd,
          due_on: data.dueOn, due_vnd: data.dueVnd, collateral_holding_id: data.collateralHoldingId, revision: 1 });
        payload = { success: true, id: 'sample-debt', revision: 1 };
      } else if ((landDebtScenario || loanScenario) && req.method === 'POST' && path === '/api/debts/sample-debt/repay') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body); repayments.push(data);
        debts[0].principal_vnd -= data.principalVnd;
        debts[0].charges_vnd = Math.max(0, debts[0].charges_vnd - data.chargesVnd);
        debts[0].has_payment_history = 1; debts[0].revision++;
        bankBalance += (data.type === 'income' ? 1 : -1) * (data.principalVnd + data.chargesVnd);
        transactions.find(tx => tx.id === data.transactionId).status = 'ignored';
        debtPayments.push({ id: 'repayment', debt_id: 'sample-debt', account_id: data.accountId, account_name: 'Test bank', principal_vnd: data.principalVnd,
          charges_vnd: data.chargesVnd, note: data.note, occurred_at: '2026-11-09T01:23:45Z' });
        payload = { success: true, id: 'repayment', revision: 2 };
      } else if (ownerChangeScenario && req.method === 'POST' && path === '/api/auth/login') {
        responseStatus = 429; payload = { error: 'Nhập sai quá nhiều lần.', code: 'OWNER_CODE_RATE_LIMITED' };
      } else if (ownerChangeScenario && req.method === 'POST' && path === '/api/auth/change-owner-code') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        ownerChangeRequests.push(data);
        if (data.currentCode !== 'qa-current-owner-code') {
          responseStatus = 401; payload = { error: 'Mã hiện tại không đúng.', code: 'OWNER_CODE_INCORRECT' };
        } else {
          payload = ownerChangeResults.get(data.operationId);
          if (!payload) {
            payload = { success: true };
            ownerChangeResults.set(data.operationId, payload);
            if (loseOwnerChangeReply) {
              loseOwnerChangeReply = false;
              res.writeHead(503, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Temporary response failure', code: 'TEMPORARY' }));
              return;
            }
          }
        }
      } else if (bankFundScenario && req.method === 'POST' && path === '/api/transactions/note-expense/fund-purchase') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        bankFundRequests.push(data);
        payload = bankFundResults.get(data.operationId);
        if (!payload) {
          const tx = transactions[0];
          let holding = fundHoldings.find(h => h.symbol === data.symbol);
          if (!data.alreadyRecorded) {
            if (!holding) {
              holding = { id: 'new-fund', symbol: data.symbol, asset_name: 'Quỹ mới', asset_class: 'fund', provider: 'fmarket', quantity: 0, avg_cost: 0, current_price: 91646.04, holding_unit: 'CCQ', price_as_of: '2026-11-09', revision: 0 };
              fundHoldings.push(holding);
            }
            const cost = holding.quantity * holding.avg_cost + data.quantity * data.unitPrice;
            holding.quantity += data.quantity;
            holding.avg_cost = cost / holding.quantity;
            holding.revision++;
          }
          bankBalance -= tx.amount;
          tx.status = 'confirmed';
          tx.revision++;
          tx.fundPurchase = { symbol: data.symbol, holdingId: holding.id, quantity: data.quantity, unitPrice: data.unitPrice, alreadyRecorded: data.alreadyRecorded };
          payload = { success: true, transactionId: tx.id, holdingId: holding.id, revision: tx.revision, fundPurchase: tx.fundPurchase };
          bankFundResults.set(data.operationId, payload);
          if (loseBankFundReply) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Simulated lost confirmation', code: 'FUND_PAYMENT_UNAVAILABLE' }));
            return;
          }
        }
      } else if (buyScenario && req.method === 'POST' && path === '/api/holdings/existing-fund/buy-more') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        purchaseRequests.push(data);
        payload = purchaseResults.get(data.operationId);
        if (!payload) {
          const holding = fundHoldings[0];
          const combinedCost = holding.quantity * holding.avg_cost + data.quantity * data.unitPrice;
          holding.quantity += data.quantity;
          holding.avg_cost = combinedCost / holding.quantity;
          holding.revision++;
          payload = { success: true, holding: { id: holding.id, symbol: holding.symbol, quantity: holding.quantity, avgCost: holding.avg_cost, revision: holding.revision } };
          purchaseResults.set(data.operationId, payload);
          if (losePurchaseReply) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Simulated lost confirmation', code: 'FUND_PURCHASE_UNAVAILABLE' }));
            return;
          }
        }
      } else if (req.method === 'PUT' && path.startsWith('/api/transactions/')) {
        if (rejectUnauthorized) {
          res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ error: 'Unauthorized', code: 'UNAUTHORIZED' }));
          return;
        }
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        const id = path.split('/').at(-1);
        if (slowTransactionDelayMs > 0) await delay(slowTransactionDelayMs);
        if (failTransactionId && id === failTransactionId) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Không thể duyệt giao dịch trên máy chủ' }));
          return;
        }
        saved.push({ id, ...data });
        const txn = transactions.find(t => t.id === id);
        if (data.status !== undefined) txn.status = data.status;
        if (data.type !== undefined) txn.type = data.type;
        if (data.accountId !== undefined) txn.account_id = data.accountId;
        if (data.note !== undefined) txn.note = data.note.trim() || null;
        if (data.description !== undefined) txn.description = data.description;
        txn.revision++;
        payload = { success: true, revision: txn.revision, note: txn.note };
      } else if (req.method === 'POST' && path === '/api/holdings') {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        savedHoldings.push(data);
        if (landDebtScenario) fundHoldings.push({ ...data, id: 'test-holding', revision: 1 });
        payload = { success: true, id: 'test-holding' };
      } else if (fundScenario && path.startsWith('/api/market/fmarket-funds/')) {
        const code = path.split('/').at(-1);
        if (code === 'VESAF') await delay(450);
        payload = { shortName: code, name: code === 'VESAF' ? 'Quỹ VinaCapital thử nghiệm' : 'Quỹ Dragon Capital thử nghiệm',
          nav: code === 'VESAF' ? 30733.81 : 91646.04, navDate: '2026-11-09', stale: false };
      } else {
        payload = {
          '/api/auth/session': { authenticated: true },
          '/api/accounts': { accounts: [
            { id: 'test-bank', name: 'Test bank', type: 'bank', balance: bankBalance },
            ...(assetVisibilityScenario ? [
              { id: 'visibility-cash', name: 'Tiền mặt', type: 'cash', balance: 2000000 },
              { id: 'visibility-securities', name: 'Tiền chứng khoán', type: 'securities', balance: 500000 }
            ] : []),
            ...(reviewScenario ? [{ id: 'other-bank', name: 'Tài khoản khác', bank_code: 'HDB', type: 'bank', balance: 2000000 }] : [])
          ] },
          '/api/jars': { jars: [{ id: 'test-jar', name: 'Test jar', code: 'NEC', target_percent: 100, monthly_limit: 500000, spent_this_month: 0 }] },
          '/api/holdings': { holdings: fundHoldings }, '/api/income-sources': { incomeSources: [] }, '/api/planned-expenses': { plannedExpenses: [] }, '/api/debts': { debts, payments: debtPayments },
          '/api/user/profile': { user: { name: 'Test owner' } },
          '/api/version': { versionName: latestApkVersion, latestApkUrl: `https://example.test/qltc-v${latestApkVersion}.apk` },
          '/api/market/fmarket-funds': { quoteOnSelect: true, funds: fundScenario || bankFundScenario ? [
            { shortName: 'VESAF', name: 'Quỹ VinaCapital thử nghiệm' },
            { shortName: 'DCDS', name: 'Quỹ Dragon Capital thử nghiệm' }
          ] : [] },
          '/api/transactions': { transactions, pagination: { totalCount: transactions.length, hasMore: false, nextCursor: null, dataRevision: 0 } }
        }[path];
      }
      res.writeHead(payload ? responseStatus : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload || {})); return;
    }
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1));
    if (path.includes('..') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store',
      ...(extname(file) === '.html' ? { 'Content-Security-Policy': "frame-src 'none'; object-src 'none'" } : {}) });
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'qltc-note-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let active;
  for (let i = 0; i < 100; i++) { try { active = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); break; } catch { await delay(100); } }
  if (!active) throw new Error('Chrome did not start');
  const ws = new WebSocket(`ws://127.0.0.1:${active[0]}${active[1]}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  const mapResponses = [];
  const mapFailures = [];
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    }
    if (msg.method === 'Network.responseReceived' && msg.params.response.url.startsWith('https://tiles.openfreemap.org/')) {
      mapResponses.push({ url: msg.params.response.url, status: msg.params.response.status });
    }
    if (msg.method === 'Network.loadingFailed') mapFailures.push(msg.params.errorText);
    if (msg.method === 'Target.attachedToTarget') {
      const workerSession = msg.params.sessionId;
      // Vector tiles are fetched in the dedicated map worker, outside the page's Network events.
      void send('Network.enable', {}, workerSession)
        .finally(() => send('Runtime.runIfWaitingForDebugger', {}, workerSession))
        .catch(error => mapFailures.push(String(error)));
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  if (landDebtScenario) await page('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  await page('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*', 'https://api.github.com/*', 'https://tile.openstreetmap.org/*'] });
  await page('Emulation.setDeviceMetricsOverride', { width: landDebtScenario || loanScenario || swipeScenario || assetVisibilityScenario || ownerChangeScenario ? 375 : 412, height: 915, deviceScaleFactor: 1, mobile: true });
  if (swipeScenario) {
    await page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.swipeRenderCommits = 0;
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          supportsFiber: true,
          inject: () => 1,
          onCommitFiberRoot: () => { window.swipeRenderCommits++; },
          onCommitFiberUnmount: () => {}
        };`
    });
  }
  if (androidVersion) {
    await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.AndroidBridge = { getNativeApkVersion: () => ${JSON.stringify(androidVersion)} };`
    });
  }
  if (landDebtScenario) {
    const place = { properties: { name: 'Xã Nhà Bè', city: 'Thành phố Hồ Chí Minh', countrycode: 'VN', type: 'district' },
      geometry: { type: 'Point', coordinates: [106.7148548, 10.6953143] } };
    const invalid = { ...place, properties: { ...place.properties, name: 'Vị trí ngoài Việt Nam', countrycode: 'KH' } };
    const features = [place, place, invalid];
    await page('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        window.landSearchRequests = [];
        const fetchOriginal = window.fetch.bind(window);
        window.fetch = (input, options) => {
          const url = new URL(input instanceof Request ? input.url : input, location.href);
          if (url.origin !== 'https://photon.komoot.io' || url.pathname !== '/api') return fetchOriginal(input, options);
          window.landSearchRequests.push({ query: url.searchParams.get('q'), country: url.searchParams.get('countrycode'),
            credentials: options?.credentials, authorization: new Headers(options?.headers).has('Authorization') });
          return ${process.env.QLTC_LIVE_LAND_SEARCH === '1'} ? fetchOriginal(input, options) :
            Promise.resolve(Response.json({ features: ${JSON.stringify(features)} }));
        };
      })()`
    });
  }
  const evaluate = async expression => { const out = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text); return out.result.value; };
  const until = async (expression, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return;
      } catch (error) {
        if (!/context.*destroyed|cannot find context/i.test(String(error))) throw error;
      }
      await delay(100);
    }
    if (landDebtScenario && process.env.QLTC_LAND_MAP_SCREENSHOT) {
      writeFileSync(process.env.QLTC_LAND_MAP_SCREENSHOT, Buffer.from((await page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    throw new Error(`Timed out: ${expression}${landDebtScenario ? `; map network ${JSON.stringify({ mapResponses, mapFailures })}` : ''}`);
  };
  const reload = async () => {
    const previousDocument = await evaluate('performance.timeOrigin');
    await page('Page.reload');
    await until(`performance.timeOrigin !== ${previousDocument} && Array.from(document.querySelectorAll('nav button > span')).some(label => label.textContent.trim() === 'Giao dịch')`);
  };
  const click = async text => { const found = await evaluate(`(() => { const text=${JSON.stringify(text)}; const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===text || (b.matches('nav button') && Array.from(b.children).some(label=>label.tagName==='SPAN' && label.textContent.trim()===text))); if (!b || b.disabled) return false; b.click(); return true; })()`); assert.ok(found, `button ${text} must be available`); };
  const fill = async (selector, value) => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`document.body.textContent.includes('Đăng xuất')`);
  await until(`document.querySelectorAll('button').length > 8`);
  await click('Giao dịch');
  await until(`!!document.querySelector('#pending-note-note-expense')`);
  return { saved, savedHoldings, purchaseRequests, bankFundRequests, ownerChangeRequests, bankBalance: () => bankBalance, fundHoldings, transactions, landSurveys, debts, repayments, mapResponses, evaluate, until, click, fill, page, reload, async close() {
    await send('Browser.close').catch(() => {}); ws.close(); proc.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } };
}

test('mobile review saves the optional note, keeps it after reload, and does not approve while editing', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture();
  try {
    await b.click('Thêm ghi chú');
    const note = ('Ăn trưa cùng gia đình\nChia tiền sau\n\n' + 'Nội dung đã ghi chú nhiều dòng để đọc lại đầy đủ. '.repeat(10)).slice(0, 500);
    await b.fill('#pending-note-note-expense', note);
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'the note editor must fit the mobile viewport');
    if (process.env.QLTC_NOTE_SCREENSHOT) {
      await b.evaluate(`document.querySelector('#pending-note-note-expense').scrollIntoView({block:'center'})`);
      const screenshot = await b.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(process.env.QLTC_NOTE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
    await b.evaluate(`(() => {const input=document.querySelector('#pending-note-note-expense'); const touch=(x)=>new Touch({identifier:1,target:input,clientX:x,clientY:300}); input.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(50)]})); input.dispatchEvent(new TouchEvent('touchmove',{bubbles:true,touches:[touch(250)]})); input.dispatchEvent(new TouchEvent('touchend',{bubbles:true,changedTouches:[touch(250)]}));})()`);
    assert.equal(b.saved.length, 0, 'editing gestures must not approve the transaction');
    await b.click('Xác nhận duyệt');
    await b.until(`!!document.querySelector('#pending-note-note-income')`);
    assert.equal(b.saved[0].note, note);
    assert.equal(b.saved[0].description, undefined, 'approval must not replace bank content');
    assert.equal(await b.evaluate(`document.querySelector('#pending-note-note-income').value`), '', 'notes must not carry over to another transaction');
    await b.click('Xác nhận duyệt');
    await b.until(`document.body.textContent.includes('Tất cả giao dịch đã được duyệt!')`);
    assert.equal(b.saved[1].note, undefined, 'a note is optional');
    await b.reload();
    await b.until(`document.body.textContent.includes('Đăng xuất')`);
    await b.click('Giao dịch'); await b.click('Lịch sử (2)');
    await b.until(`!!document.querySelector('button[aria-label="Xem đầy đủ ghi chú"]')`);
    await b.evaluate(`document.querySelector('button[aria-label="Xem đầy đủ ghi chú"]').click()`);
    await b.until(`!!document.querySelector('#confirmed-note-content')`);
    assert.equal(await b.evaluate(`document.querySelector('#confirmed-note-content').textContent`), note);
    assert.equal(await b.evaluate(`getComputedStyle(document.querySelector('#confirmed-note-content')).whiteSpace`), 'pre-wrap');
    assert.equal(await b.evaluate(`!!document.querySelector('#confirmed-transaction-note')`), false);
    assert.equal(b.saved.length, 2, 'opening a saved note must be read-only');
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    if (process.env.QLTC_NOTE_DETAILS_SCREENSHOT) {
      writeFileSync(process.env.QLTC_NOTE_DETAILS_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await b.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.until(`!document.querySelector('#confirmed-note-content')`);
    await b.evaluate(`Array.from(document.querySelectorAll('div')).find(row=>row.textContent==='Original expense').click()`);
    await b.until(`!!document.querySelector('#confirmed-transaction-note')`);
    assert.equal(await b.evaluate(`document.querySelector('#confirmed-transaction-note').value`), note);
    await b.fill('#confirmed-transaction-note', ''); await b.click('Lưu thay đổi');
    await b.until(`!document.querySelector('#confirmed-transaction-note')`);
    assert.equal(b.saved.at(-1).note, '');
    assert.equal(b.saved.at(-1).occurredAt, undefined, 'editing a note must not change the bank transaction timestamp');
  } finally { await b.close(); }
});

test('list and bulk approval retain separate optional notes for each transaction', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture();
  try {
    await b.click('Danh sách (2)');
    await b.until(`!!document.querySelector('#list-note-note-income')`);
    await b.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Thêm ghi chú').click()`);
    await b.fill('#list-note-note-expense', 'Ghi chú khoản chi');
    await b.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Thêm ghi chú').click()`);
    await b.fill('#list-note-note-income', 'Ghi chú khoản thu');
    const bulkLabel = await b.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Duyệt tất cả'))?.textContent.trim()`);
    assert.ok(bulkLabel); await b.click(bulkLabel);
    await b.until(`!!document.querySelector('[role="dialog"]')`);
    await b.click('Duyệt 2 khoản');
    await b.until(`document.body.textContent.includes('Tất cả giao dịch đã được duyệt!')`);
    assert.equal(b.saved.find(t=>t.id==='note-expense').note, 'Ghi chú khoản chi');
    assert.equal(b.saved.find(t=>t.id==='note-income').note, 'Ghi chú khoản thu');
    await b.click('Lịch sử (2)');
    for (const note of ['Ghi chú khoản chi', 'Ghi chú khoản thu']) {
      await b.evaluate(`Array.from(document.querySelectorAll('button[aria-label="Xem đầy đủ ghi chú"]')).find(button=>button.textContent.includes(${JSON.stringify(note)})).click()`);
      await b.until(`!!document.querySelector('#confirmed-note-content')`);
      assert.equal(await b.evaluate(`document.querySelector('#confirmed-note-content').textContent`), note);
      await b.evaluate(`document.querySelector('button[aria-label="Đóng ghi chú"]').click()`);
    }
    await b.evaluate(`document.querySelector('button[title="Ẩn số tiền"]').click()`);
    await b.evaluate(`document.querySelector('button[aria-label="Xem đầy đủ ghi chú"]').click()`);
    await b.until(`!!document.querySelector('#confirmed-note-content')`);
    assert.equal(await b.evaluate(`document.querySelector('#confirmed-note-content').textContent`), '••••••');
    assert.equal(b.saved.length, 2);
  } finally { await b.close(); }
});

test('shows the interface release once and keeps it visible in Settings when the APK is already current', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ androidVersion: '2.0.4', latestApkVersion: '2.0.4' });
  try {
    await b.until(`document.body.textContent.includes('Giao diện đã cập nhật')`);
    assert.ok(await b.evaluate(`document.body.textContent.includes('Đổi mã chủ tài khoản')`));

    await b.reload();
    await b.until(`document.body.textContent.includes('Test owner')`);
    assert.equal(await b.evaluate(`document.body.textContent.includes('Giao diện đã cập nhật')`), false);
    await b.evaluate(`document.querySelector('button[title="Tài khoản & Cài đặt"]').click()`);
    await b.click('Hệ thống');
    await b.until(`document.body.textContent.includes('Phiên bản v2.0.4')`);
    await b.until(`document.body.textContent.includes('Điện thoại đang dùng APK v2.0.4. Chưa có APK mới hơn.')`);
    await b.click('Kiểm tra APK');
    await b.until(`document.body.textContent.includes('Điện thoại đang dùng APK v2.0.4. Chưa có APK mới hơn.')`);
    assert.ok(await b.evaluate(`document.querySelector('section[aria-labelledby="interface-update-title"]').textContent.includes('Đổi mã chủ tài khoản')`));
    assert.equal(await b.evaluate(`document.body.textContent.includes('Tải & Cài đặt')`), false);
    if (process.env.QLTC_UPDATE_SCREENSHOT) {
      await delay(400);
      const screenshot = await b.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(process.env.QLTC_UPDATE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
  } finally { await b.close(); }
});

test('review asks for a direction when unclear and sends the chosen direction and account on approval', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ reviewScenario: true });
  try {
    assert.ok(await b.evaluate(`document.body.textContent.includes('Chưa rõ Thu/Chi')`));
    assert.ok(await b.evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Xác nhận duyệt').disabled`));
    await b.evaluate(`(() => {
      const [kind, account] = document.querySelectorAll('select');
      kind.value = 'income'; kind.dispatchEvent(new Event('change', { bubbles: true }));
      account.value = 'other-bank'; account.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await b.click('Xác nhận duyệt');
    await b.until(`!!document.querySelector('#pending-note-note-income')`);
    assert.equal(b.saved[0].type, 'income');
    assert.equal(b.saved[0].accountId, 'other-bank');
    assert.equal(b.saved[0].jarId, null);
    assert.equal(await b.evaluate(`document.querySelectorAll('select')[1].value`), 'other-bank', 'use the receiving account from the parsed notification');
    await b.evaluate(`(() => {
      const [kind, account] = document.querySelectorAll('select');
      kind.value = 'expense'; kind.dispatchEvent(new Event('change', { bubbles: true }));
      account.value = 'test-bank'; account.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await b.click('Xác nhận duyệt');
    await b.until(`document.body.textContent.includes('Tất cả giao dịch đã được duyệt!')`);
    assert.equal(b.saved[1].type, 'expense');
    assert.equal(b.saved[1].accountId, 'test-bank');
    assert.equal(b.saved[1].incomeSourceId, null);
  } finally { await b.close(); }
});

test('Fmarket selection fills name and dated NAV for the chosen code and preserves the entered purchase price and quantity', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ fundScenario: true });
  try {
    await b.click('Đầu tư');
    await b.click('Quỹ Fmarket');
    await b.click('+ Thêm Quỹ Fmarket');
    const pick = async code => b.evaluate(`Array.from(document.querySelectorAll('button[aria-pressed]')).find(button => button.firstElementChild?.textContent === '${code}').click()`);
    await b.until(`document.querySelectorAll('button[aria-pressed]').length >= 2`);
    await pick('VESAF');
    await pick('DCDS');
    const summary = `document.querySelector('section[aria-label="Thông tin quỹ đã chọn"]')`;
    await b.until(`${summary}?.textContent.includes('91.646,04')`);
    assert.ok(await b.evaluate(`${summary}.textContent.includes('Quỹ Dragon Capital thử nghiệm') && ${summary}.textContent.includes('09/11/2026')`));
    const priceInput = `document.querySelector('#fmarket-purchase-price')`;
    assert.equal(await b.evaluate(`${priceInput}.value`), '');
    await b.evaluate(`${priceInput}.focus()`);
    for (const text of '29800,') await b.page('Input.insertText', { text });
    assert.equal(await b.evaluate(`${priceInput}.value`), '29.800,');
    for (const text of '25') await b.page('Input.insertText', { text });
    assert.equal(await b.evaluate(`${priceInput}.value`), '29.800,25');
    await b.evaluate(`${priceInput}.select()`);
    for (const text of ['29800', '.', '25']) await b.page('Input.insertText', { text });
    assert.equal(await b.evaluate(`${priceInput}.value`), '29.800,25', 'a decimal keyboard dot is accepted as a comma');
    await b.evaluate(`(() => {
      const input = ${priceInput};
      input.select();
      const clipboard = new DataTransfer();
      clipboard.setData('text/plain', '29.800,2512');
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
    })()`);
    assert.equal(await b.evaluate(`${priceInput}.value`), '29.800,2512');
    await b.evaluate(`(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const input = document.getElementById('holding-quantity');
      setValue.call(input, '12.5');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await pick('VESAF');
    await b.until(`${summary}?.textContent.includes('30.733,81')`);
    await b.click('+ Lưu vào danh mục tài sản');
    await b.until(`document.body.textContent.includes('Đã lưu tài sản "VESAF"')`);
    assert.equal(b.savedHoldings[0].symbol, 'VESAF');
    assert.equal(b.savedHoldings[0].name, 'Quỹ VinaCapital thử nghiệm');
    assert.equal(b.savedHoldings[0].avgCost, 29800.2512);
    assert.equal(b.savedHoldings[0].quantity, 12.5);
    assert.equal(b.savedHoldings[0].currentPrice, 30733.81);
    assert.equal(b.savedHoldings[0].provider, 'fmarket');
    assert.equal(b.savedHoldings[0].priceAsOf, '2026-11-09');
    await b.until(`!${priceInput}`);
    await b.evaluate(`Array.from(document.querySelectorAll('p')).find(p => p.textContent.startsWith('NAV ngày')).click()`);
    await b.until(`!!${priceInput}`);
    assert.equal(await b.evaluate(`${priceInput}.value`), '29.800,2512', 'editing the saved holding displays the same amount');
  } finally { await b.close(); }
});

async function enterExtraFundPurchase(browser) {
  await browser.click('Đầu tư');
  await browser.until(`!!document.querySelector('button[aria-label="Mua thêm VESAF"]')`);
  await browser.evaluate(`document.querySelector('button[aria-label="Mua thêm VESAF"]').click()`);
  await browser.until(`!!document.querySelector('#fund-buy-quantity')`);
  for (const [id, text] of [['fund-buy-quantity', '25,5'], ['fund-buy-price', '32500,25']]) {
    await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
    await browser.page('Input.insertText', { text });
  }
}

test('Mua thêm takes two decimal inputs, previews the result and updates the existing fund once', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ buyScenario: true });
  try {
    await enterExtraFundPurchase(b);
    const dialog = `document.querySelector('[role="dialog"][aria-label="Mua thêm VESAF"]')`;
    assert.equal(await b.evaluate(`${dialog}.querySelectorAll('input').length`), 2);
    assert.equal(await b.evaluate(`document.querySelector('#fund-buy-price').value`), '32.500,25');
    assert.ok(await b.evaluate(`${dialog}.textContent.includes('Tổng số lượng 125,5 CCQ')`));
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    if (process.env.QLTC_BUY_MORE_SCREENSHOT) {
      await b.until(`!document.body.textContent.includes('Giao diện đã cập nhật')`);
      await delay(300);
      const screenshot = await b.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(process.env.QLTC_BUY_MORE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
    await b.evaluate(`(() => {
      const button = Array.from(${dialog}.querySelectorAll('button')).find(button => button.textContent.trim() === 'Lưu lần mua');
      button.click(); button.click();
    })()`);
    await b.until(`document.body.textContent.includes('Đã ghi lần mua thêm VESAF')`);
    assert.equal(b.purchaseRequests.length, 1);
    assert.equal(b.purchaseRequests[0].quantity, 25.5);
    assert.equal(b.purchaseRequests[0].unitPrice, 32500.25);
    assert.equal(b.purchaseRequests[0].expectedRevision, 1);
    assert.equal(b.fundHoldings[0].quantity, 125.5);
    assert.equal(await b.evaluate(`localStorage.getItem('qltc_pending_fund_purchase_existing-fund')`), null);
    await b.evaluate(`document.querySelector('button[aria-label="Mua thêm VESAF"]').click()`);
    await b.until(`!!document.querySelector('#fund-buy-quantity')`);
    assert.ok(await b.evaluate(`${dialog}.textContent.includes('Đang giữ 125,5 CCQ')`));
    assert.equal(await b.evaluate(`document.querySelector('#fund-buy-quantity').value`), '');
  } finally { await b.close(); }
});

test('Mua thêm retries the same request after a lost confirmation and page reload', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ buyScenario: true, losePurchaseReply: true });
  try {
    await enterExtraFundPurchase(b);
    await b.click('Lưu lần mua');
    await b.until(`document.body.textContent.includes('Chưa xác nhận được lần mua đã lưu')`);
    assert.equal(b.fundHoldings[0].quantity, 125.5);
    const firstRequest = b.purchaseRequests[0];
    await b.click('Hủy');
    await b.reload();
    await b.until(`document.body.textContent.includes('Đăng xuất')`);
    await b.click('Đầu tư');
    await b.until(`document.body.textContent.includes('125,5 CCQ')`);
    await b.evaluate(`document.querySelector('button[aria-label="Mua thêm VESAF"]').click()`);
    await b.until(`document.body.textContent.includes('Lần mua đã bấm lưu đang chờ xác nhận')`);
    assert.equal(await b.evaluate(`document.querySelector('#fund-buy-quantity').value`), '25,5');
    assert.equal(await b.evaluate(`document.querySelector('#fund-buy-price').value`), '32.500,25');
    await b.click('Thử lưu lại');
    await b.until(`document.body.textContent.includes('Đã ghi lần mua thêm VESAF')`);
    assert.equal(b.purchaseRequests.length, 2);
    assert.deepEqual(b.purchaseRequests[1], firstRequest);
    assert.equal(b.fundHoldings[0].quantity, 125.5, 'a retry must not purchase another 25.5 CCQ');
    assert.equal(await b.evaluate(`localStorage.getItem('qltc_pending_fund_purchase_existing-fund')`), null);
  } finally { await b.close(); }
});

async function fillBankFundPurchase(browser) {
  for (const [id, text] of [['bank-fund-quantity', '25'], ['bank-fund-price', '32500,25']]) {
    await browser.evaluate(`document.getElementById(${JSON.stringify(id)}).focus()`);
    await browser.page('Input.insertText', { text });
  }
}

for (const scenario of ['owned', 'new']) {
  test(`bank notice activates ${scenario === 'owned' ? 'Mua thêm' : 'Mua mới'} and records both CCQ and bank debit after confirmation`, { skip: !existsSync(chrome), timeout: 40000 }, async () => {
    const b = await fixture({ bankFundScenario: scenario });
    try {
      const symbol = scenario === 'owned' ? 'VESAF' : 'DCDS';
      await b.until(`document.body.textContent.includes('Nhận diện quỹ ${symbol}')`);
      assert.equal(b.bankFundRequests.length, 0);
      await b.click(scenario === 'owned' ? 'Mua thêm & duyệt' : 'Mua mới & duyệt');
      await b.until(`!!document.querySelector('#bank-fund-quantity')`);
      await fillBankFundPurchase(b);
      assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
      if (process.env.QLTC_BANK_FUND_SCREENSHOT && scenario === 'new') {
        await b.until(`!document.body.textContent.includes('Giao diện đã cập nhật')`);
        await delay(300);
        const screenshot = await b.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        writeFileSync(process.env.QLTC_BANK_FUND_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
      }
      await b.evaluate(`(() => {const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='Lưu quỹ và duyệt tiền');button.click();button.click();})()`);
      await b.until(`document.body.textContent.includes('Đã ghi quỹ ${symbol} và duyệt tiền chi')`);
      assert.equal(b.bankFundRequests.length, 1);
      assert.equal(b.bankFundRequests[0].symbol, symbol);
      assert.equal(b.bankFundRequests[0].quantity, 25);
      assert.equal(b.bankFundRequests[0].unitPrice, 32500.25);
      assert.equal(b.bankFundRequests[0].expectedHoldingRevision, scenario === 'owned' ? 1 : null);
      assert.equal(b.fundHoldings[0].quantity, scenario === 'owned' ? 125 : 25);
      assert.equal(b.bankBalance(), 187494);
      assert.equal(b.saved.length, 0, 'there is no separate second expense approval');
      await b.reload();
      await b.until(`document.body.textContent.includes('Đăng xuất')`);
      await b.click('Giao dịch'); await b.click('Lịch sử (1)');
      await b.until(`document.body.textContent.includes('Đã ghi mua quỹ ${symbol}')`);
    } finally { await b.close(); }
  });
}

test('an already recorded lot can be linked and a lost confirmation can be retried without another debit', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ bankFundScenario: 'owned', loseBankFundReply: true });
  try {
    await b.until(`document.body.textContent.includes('Nhận diện quỹ VESAF')`);
    await b.click('Mua thêm & duyệt');
    await b.until(`!!document.querySelector('#bank-fund-quantity')`);
    await b.evaluate(`document.querySelector('[role="dialog"][aria-label="Ghi mua quỹ VESAF"] input[type="checkbox"]').click()`);
    await b.click('Lưu quỹ và duyệt tiền');
    await b.until(`document.body.textContent.includes('Chưa xác nhận được kết quả')`);
    assert.equal(b.fundHoldings[0].quantity, 100);
    assert.equal(b.bankBalance(), 187494);
    const first = b.bankFundRequests[0];
    await b.click('Thử lưu lại');
    await b.until(`document.body.textContent.includes('Đã ghi quỹ VESAF và duyệt tiền chi')`);
    assert.deepEqual(b.bankFundRequests[1], first);
    assert.equal(b.fundHoldings[0].quantity, 100);
    assert.equal(b.bankBalance(), 187494);
  } finally { await b.close(); }
});

test('bulk approval keeps a detected fund waiting for its CCQ and purchase price', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ bankFundScenario: 'new' });
  try {
    await b.until(`document.body.textContent.includes('Nhận diện quỹ DCDS')`);
    await b.click('Duyệt tất cả');
    await b.until(`!!document.querySelector('[role="dialog"]')`);
    await b.click('Duyệt 1 khoản');
    await b.until(`document.body.textContent.includes('Chờ duyệt (1)')`);
    assert.equal(b.bankFundRequests.length, 0);
    assert.equal(b.saved.length, 1);
    assert.equal(b.saved[0].id, 'note-income');
    assert.equal(b.fundHoldings.length, 0);
  } finally { await b.close(); }
});

test('a detected ticker still allows an explicit bank-only approval', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ bankFundScenario: 'new' });
  try {
    await b.until(`document.body.textContent.includes('Nhận diện quỹ DCDS')`);
    await b.click('Duyệt tiền chi riêng');
    await b.until(`document.body.textContent.includes('Duyệt tiền chi riêng?')`);
    await b.click('Duyệt tiền chi');
    await b.until(`document.body.textContent.includes('Chờ duyệt (1)')`);
    assert.equal(b.bankFundRequests.length, 0);
    assert.equal(b.saved.length, 1);
    assert.equal(b.saved[0].id, 'note-expense');
    assert.equal(b.fundHoldings.length, 0);
  } finally { await b.close(); }
});

test('owner changes a five-character code and safely retries after a lost response', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ ownerChangeScenario: true, loseOwnerChangeReply: true });
  const enter = async (selector, value, replace = false) => {
    await b.evaluate(`(() => { const field=document.querySelector(${JSON.stringify(selector)});field.focus();${replace ? 'field.select();' : ''} })()`);
    await b.page('Input.insertText', { text: value });
  };
  try {
    await b.evaluate(`document.querySelector('button[title="Tài khoản & Cài đặt"]').click()`);
    await b.click('Đổi mã chủ tài khoản');
    assert.equal(await b.evaluate(`document.querySelector('#owner-code-current').type`), 'password');
    await enter('#owner-code-current', 'wrong-for-test');
    await enter('#owner-code-new', 'abc1');
    await enter('#owner-code-confirm', 'abc1');
    await b.click('Lưu mã mới');
    await b.until(`document.body.textContent.includes('mã mới có ít nhất 5 ký tự')`);
    assert.equal(b.ownerChangeRequests.length, 0);
    await enter('#owner-code-new', 'Ab1!5', true);
    await b.click('Lưu mã mới');
    await b.until(`document.body.textContent.includes('Hai lần nhập mã mới chưa khớp')`);
    await enter('#owner-code-confirm', 'Ab1!5', true);
    await b.click('Hiện mã');
    assert.equal(await b.evaluate(`document.querySelector('#owner-code-new').type`), 'text');
    await b.click('Ẩn mã');
    if (process.env.QLTC_OWNER_CODE_SCREENSHOT) {
      await b.evaluate(`document.querySelector('#owner-code-current').scrollIntoView({block:'center'})`);
      writeFileSync(process.env.QLTC_OWNER_CODE_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await b.click('Lưu mã mới');
    await b.until(`document.body.textContent.includes('Mã hiện tại không đúng.')`);
    await enter('#owner-code-current', 'qa-current-owner-code', true);
    await b.click('Lưu mã mới');
    await b.until(`document.body.textContent.includes('Chưa xác nhận được kết quả.')`);
    assert.equal(await b.evaluate(`Object.keys(localStorage).some(key => (localStorage.getItem(key) || '').includes('qa-current-owner-code') || (localStorage.getItem(key) || '').includes('Ab1!5'))`), false);
    await b.click('Lưu mã mới');
    await b.until(`document.body.textContent.includes('Đã đổi mã. Các phiên đăng nhập khác cần dùng mã mới.')`);
    assert.equal(b.ownerChangeRequests.length, 3);
    assert.equal(b.ownerChangeRequests[1].operationId, b.ownerChangeRequests[2].operationId);
    assert.equal(b.ownerChangeRequests[2].newCode, 'Ab1!5');
    assert.equal(await b.evaluate(`!!document.querySelector('#owner-code-new')`), false);
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    await b.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await b.until(`!document.querySelector('[aria-label="Cài đặt"]')`);
    await b.click('Đăng xuất');
    await b.until(`!!document.querySelector('form input[type="password"]')`);
    await enter('form input[type="password"]', 'Ab1!5');
    await b.click('Đăng nhập');
    await b.until(`document.body.textContent.includes('Nhập sai quá nhiều lần. Anh thử lại sau 15 phút.')`);
  } finally { await b.close(); }
});

test('asset eye controls exclude hidden groups and retain the selection after reload', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ assetVisibilityScenario: true });
  const total = `Number(document.querySelector('output[aria-label="Tổng tài sản được tính"]').textContent.replace(/[^0-9-]/g,''))`;
  const net = `Number(document.querySelector('output[aria-label="Tài sản ròng được tính"]').textContent.replace(/[^0-9-]/g,''))`;
  const groups = [
    { id: 'land', name: 'Đất / BĐS', value: 6000000 },
    { id: 'bank', name: 'Ngân hàng & Ví', value: 1000000 },
    { id: 'cash', name: 'Tiền mặt', value: 2000000 },
    { id: 'financial', name: 'TS Tài chính (Fmarket)', value: 3500000 },
    { id: 'gold', name: 'Vàng tích trữ', value: 4000000 },
    { id: 'silver', name: 'Bạc tích trữ', value: 5000000 }
  ];
  const toggle = group => b.evaluate(`document.querySelector(${JSON.stringify('button[aria-label="Hiện và tính ' + group.name + ' vào tổng tài sản"]')}).click()`);
  try {
    await b.click('Tổng quan');
    await b.until(`${total} === 21500000 && ${net} === 21700000`);
    await toggle(groups[0]);
    await b.until(`${total} === 15500000 && ${net} === 15700000`);
    assert.equal(await b.evaluate(`document.querySelector('[data-asset-group="land"]').textContent.includes('Đã ẩn khỏi tổng')`), true);
    assert.equal(await b.evaluate(`document.querySelector('[aria-label="Phân bổ tài sản đang tính"]').children.length`), 5);
    assert.ok(await b.evaluate(`!!document.querySelector('section[aria-label="Tài sản hiện có"]')`), 'an eye button must keep the dashboard open');
    await b.reload();
    await b.until(`${total} === 15500000`);
    assert.equal(await b.evaluate(`document.querySelector('[data-asset-group="land"] button[aria-pressed]').getAttribute('aria-pressed')`), 'false');
    await b.evaluate(`document.querySelector('button[title="Ẩn số tiền"]').click()`);
    await b.until(`document.querySelector('output[aria-label="Tổng tài sản được tính"]').textContent.includes('•')`);
    await b.evaluate(`document.querySelector('button[title="Hiện số tiền"]').click()`);
    await b.until(`${total} === 15500000`);
    if (process.env.QLTC_ASSET_VISIBILITY_SCREENSHOT) {
      await b.evaluate(`document.querySelector('section[aria-label="Tài sản hiện có"]').scrollIntoView({block:'start'})`);
      writeFileSync(process.env.QLTC_ASSET_VISIBILITY_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    let expected = 15500000;
    for (const group of groups.slice(1)) {
      await toggle(group);
      expected -= group.value;
      await b.until(`${total} === ${expected} && ${net} === ${expected + 200000}`);
      assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="Cập nhật số dư tài khoản"]')`), false);
    }
    assert.equal(await b.evaluate(`!!document.querySelector('[aria-label="Phân bổ tài sản đang tính"]')`), false);
    for (const group of groups) {
      await toggle(group);
      expected += group.value;
      await b.until(`${total} === ${expected}`);
    }
    assert.equal(expected, 21500000);
    assert.equal(b.bankBalance(), 1000000);
    assert.equal(b.saved.length + b.savedHoldings.length + b.repayments.length, 0);
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
  } finally { await b.close(); }
});

test('swipe stays responsive with a long queue and only commits deliberate horizontal actions', { skip: !existsSync(chrome), timeout: 60000 }, async () => {
  const b = await fixture({ swipeScenario: true });
  const card = `document.querySelector('[id^="pending-note-"]').closest('.bg-gradient-to-br')`;
  const nextFrame = () => b.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const start = async (selector = card) => {
    await b.evaluate(`${selector}.scrollIntoView({block:'center'})`);
    const point = await b.evaluate(`(() => {const r=${selector}.getBoundingClientRect();return {x:r.left+r.width/2,y:Math.max(70,r.top+30)};})()`);
    await b.page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x, y: point.y }] });
    return point;
  };
  const move = (point, x, y = 0) => b.page('Input.dispatchTouchEvent', {
    type: 'touchMove', touchPoints: [{ id: 1, x: point.x + x, y: point.y + y }]
  });
  const end = (cancel = false) => b.page('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  const offset = () => b.evaluate(`new DOMMatrixReadOnly(getComputedStyle(${card}).transform).m41`);
  try {
    await b.until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim()==='Xác nhận duyệt' && !button.disabled)`);
    await b.page('Emulation.setCPUThrottlingRate', { rate: 4 });
    let point = await start();
    await nextFrame();
    const commits = await b.evaluate('window.swipeRenderCommits');
    assert.ok(commits > 0, 'the React commit counter must observe the mounted application');
    for (const x of [12, 24, 36, 48, 60, 72, 80]) await move(point, x);
    await nextFrame();
    assert.ok(Math.abs(await offset() - 80) < 1, 'the card follows the latest finger position');
    assert.equal(await b.evaluate('window.swipeRenderCommits'), commits, 'dragging must not rerender the transaction queue');
    assert.equal(b.saved.length, 0);
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'dragging must fit the mobile viewport');
    if (process.env.QLTC_SWIPE_SCREENSHOT) {
      writeFileSync(process.env.QLTC_SWIPE_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await end();
    await b.until(`Math.abs(new DOMMatrixReadOnly(getComputedStyle(${card}).transform).m41) < 0.1`);
    assert.equal(b.saved.length, 0, 'a short swipe returns to the center');

    point = await start();
    await move(point, 2, 35);
    await move(point, 125, 100);
    await end();
    assert.equal(b.saved.length, 0, 'scrolling vertically must not approve a transaction');

    point = await start();
    await move(point, 120);
    await end(true);
    await nextFrame();
    assert.equal(b.saved.length, 0, 'a cancelled gesture must not approve a transaction');

    point = await start();
    await move(point, 60);
    await b.page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [
      { id: 1, x: point.x + 60, y: point.y }, { id: 2, x: point.x, y: point.y + 20 }
    ] });
    await end();
    assert.equal(b.saved.length, 0, 'a multi-touch gesture must not approve a transaction');

    await b.click('Thêm ghi chú');
    point = await start("document.querySelector('#pending-note-note-expense')");
    await move(point, 120);
    await end();
    assert.equal(b.saved.length, 0, 'editing controls must not start a card swipe');

    point = await start();
    await move(point, 35);
    await move(point, 125);
    await end();
    await b.until(`!!document.querySelector('#pending-note-note-income')`);
    assert.equal(b.saved.length, 1);
    assert.equal(b.saved[0].id, 'note-expense');
    assert.equal(b.saved[0].status, 'confirmed');

    point = await start();
    await move(point, -35);
    await move(point, -125);
    await end();
    await b.until(`!document.querySelector('#pending-note-note-income')`);
    assert.equal(b.saved.length, 2);
    assert.equal(b.saved[1].id, 'note-income');
    assert.equal(b.saved[1].status, 'rejected');
  } finally { await b.close(); }
});

test('a pending receipt can create, select and reduce a loan without regular income approval', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ loanScenario: true });
  try {
    await b.click('Danh sách (2)');
    await b.until(`!!document.querySelector('#list-note-note-income')`);
    await b.fill('#list-note-note-income', 'Thu gốc lần một');
    await b.click('Thu nợ');
    await b.click('Thêm khoản cho vay');
    await b.evaluate(`document.querySelector('input[placeholder="Ví dụ cho vay mua xe"]').focus()`);
    await b.page('Input.insertText', { text: 'Cho vay mua xe mẫu' });
    await b.evaluate(`document.querySelector('#debt-principal').focus()`);
    await b.page('Input.insertText', { text: '300000' });
    await b.click('Lưu khoản cho vay');
    await b.until(`document.querySelector('#loan-receipt-choice')?.options.length === 2`);
    assert.equal(b.bankBalance(), 1000000);
    assert.equal(b.debts[0].kind, 'receivable');
    await b.evaluate(`(() => {const choice=document.querySelector('#loan-receipt-choice'); choice.value='sample-debt'; choice.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await b.until(`Array.from(document.querySelectorAll('p')).some(p=>p.textContent.includes('Gốc còn lại sau khi thu') && p.textContent.includes('200.000'))`);
    assert.equal(await b.evaluate(`document.querySelector('#loan-receipt-account').value`), 'test-bank');
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'));
    await b.click('Xác nhận thu nợ');
    await b.until(`document.body.textContent.includes('Lịch sử thu nợ (1)')`);
    assert.equal(b.repayments[0].type, 'income');
    assert.equal(b.repayments[0].transactionId, 'note-income');
    assert.equal(b.repayments[0].note, 'Thu gốc lần một');
    assert.equal(b.bankBalance(), 1100000);
    assert.equal(b.debts[0].principal_vnd, 200000);
    assert.equal(b.saved.length, 0);
    assert.equal(b.transactions.find(tx => tx.id === 'note-income').status, 'ignored');
    await b.evaluate(`document.querySelector('button[aria-label="Đóng quản lý nợ"]').click()`);
    await b.click('Tổng quan');
    await b.until(`document.querySelector('[aria-label="Nợ phải trả, khoản cho vay và tài sản ròng"]').textContent.includes('1.300.000')`);
  } finally { await b.close(); }
});

test('mobile land pin and debt screens save a reviewed price and link a repayment to one bank notice', { skip: !existsSync(chrome), timeout: 60000 }, async () => {
  const b = await fixture({ landDebtScenario: true, regionalLandScenario: true });
  const enter = async (selector, value, replace = false) => {
    await b.evaluate(`(() => {const field=document.querySelector(${JSON.stringify(selector)});field.focus();${replace ? 'field.select();' : ''}})()`);
    await b.page('Input.insertText', { text: value });
  };
  try {
    await b.click('Đầu tư');
    await b.click('Thêm');
    await b.click('🏡 Đất / BĐS');
    await enter('#holding-name', 'Lô thử nghiệm', true);
    await enter('#holding-quantity', '100');
    await b.click('Chọn trên bản đồ');
    await b.until(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim()==='Ghim tâm bản đồ' && !button.disabled)`, 25000);
    assert.ok(b.mapResponses.some(response => response.status === 200 && response.url.includes('/styles/bright')), 'the replacement map style must load');
    assert.ok(b.mapResponses.some(response => response.status === 200 && response.url.includes('/planet/') && response.url.endsWith('.pbf')), 'the map must receive real vector tiles while the old tile server is blocked');
    assert.ok(await b.evaluate(`!!document.querySelector('.maplibregl-canvas')`));
    await enter('#land-location-search', 'Nhà Bè, TP.HCM');
    await b.page('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await b.until(`!!document.querySelector('[aria-label="Kết quả tìm vị trí"] button')`);
    assert.deepEqual(await b.evaluate('window.landSearchRequests'),
      [{ query: 'Nhà Bè, Hồ Chí Minh', country: 'VN', credentials: 'omit', authorization: false }]);
    if (process.env.QLTC_LIVE_LAND_SEARCH !== '1') {
      assert.equal(await b.evaluate(`document.querySelectorAll('[aria-label="Kết quả tìm vị trí"] button').length`), 1);
    }
    assert.equal(b.savedHoldings.length, 0, 'Enter searches instead of submitting the investment form');
    await b.click('Xã Nhà Bè, Thành phố Hồ Chí Minh');
    assert.equal(await b.evaluate(`!!document.querySelector('.maplibregl-marker')`), false, 'an address opens the area without selecting a plot');
    await b.click('Ghim tâm bản đồ');
    await b.until(`document.body.textContent.includes('Đã ghim ')`);
    const [landLat, landLng] = await b.evaluate(`Array.from(document.querySelectorAll('section[aria-label="Vị trí và khảo giá đất"] p'))
      .find(p => p.textContent.startsWith('Đã ghim ')).textContent.replace('Đã ghim ', '').split(', ').map(Number)`);
    assert.ok(Math.abs(landLat - 10.6953143) < 0.001 && Math.abs(landLng - 106.7148548) < 0.001, 'the selected address must move the map to Nhà Bè');
    await enter('#land-location-search', '108.2, 16.05', true);
    await b.click('Tìm');
    await b.until(`document.body.textContent.includes('theo thứ tự vĩ độ, kinh độ')`);
    await enter('#land-location-search', '16.05, 108.2', true);
    await b.click('Tìm');
    await b.until(`document.body.textContent.includes('Đã ghim 16.05000, 108.20000')`);
    await enter('#land-location-search', '16,051; 108,202', true);
    await b.click('Tìm');
    await b.until(`document.body.textContent.includes('Đã ghim 16.05100, 108.20200')`);
    assert.equal(await b.evaluate('window.landSearchRequests.length'), 1, 'coordinate search stays on the device');
    const selectAccess = value => b.evaluate(`(() => {
      const field = document.querySelector('select:has(option[value="alley"])');
      field.value = ${JSON.stringify(value)};
      field.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await selectAccess('alley');
    await b.click('Khảo giá ngay');
    await b.until(`document.body.textContent.includes('Chưa tìm thấy tin bán phù hợp với diện tích và bộ lọc đã chọn.')`);
    assert.equal(b.landSurveys[0].access, 'alley');
    assert.ok(await b.evaluate(`document.querySelector('[aria-label="Giá rao tham khảo"]').textContent.includes('125.000.000')`));
    assert.equal(await b.evaluate(`document.body.textContent.includes('Dùng giá giữa')`), false);
    await selectAccess('');
    await b.click('Khảo giá ngay');
    await b.until(`document.body.textContent.includes('Giá chào bán · DuLieu.dev')`);
    assert.ok(await b.evaluate(`document.body.textContent.includes('Xã Nhà Bè') && document.body.textContent.includes('Nguồn chưa xác minh được khoảng cách từng tin tới ghim')`));
    await b.evaluate(`Array.from(document.querySelectorAll('summary')).find(row => row.textContent.trim()==='Xem các lô so sánh').click()`);
    await b.until(`document.body.textContent.includes('Lô so sánh thử nghiệm')`);
    assert.equal(b.landSurveys.length, 2);
    assert.equal(b.landSurveys[1].lat, 16.051);
    assert.equal(b.landSurveys[1].lng, 108.202);
    assert.equal(b.landSurveys[1].area, 100);
    assert.equal(b.savedHoldings.length, 0, 'survey is read-only until the price is accepted and the property is saved');
    if (process.env.QLTC_LAND_MAP_SCREENSHOT) {
      for (let i = 0; i < 150 && !b.mapResponses.some(response => response.status === 200 && /\/1[4-9]\/\d+\/\d+\.pbf$/.test(response.url)); i++) await delay(100);
      assert.ok(b.mapResponses.some(response => response.status === 200 && /\/1[4-9]\/\d+\/\d+\.pbf$/.test(response.url)), 'street-level tiles must load for a precisely pinned location');
      await b.evaluate(`document.querySelector('label[for="land-location-search"]').scrollIntoView({block:'start'})`);
      await delay(500);
      writeFileSync(process.env.QLTC_LAND_MAP_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    await b.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim().startsWith('Dùng giá giữa')).click()`);
    await b.click('+ Lưu vào danh mục tài sản');
    await b.until(`!document.querySelector('#holding-name')`);
    assert.equal(b.savedHoldings[0].currentPrice, 20000000);
    assert.equal(b.savedHoldings[0].landDetails.lat, b.landSurveys[1].lat);
    assert.equal(b.savedHoldings[0].landDetails.valuation.scope, 'ward');

    await b.click('Tổng quan');
    await b.evaluate(`Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Tổng nợ phải trả')).click()`);
    await b.click('Thêm khoản nợ');
    await enter('input[placeholder="Ví dụ vay mua lô đất"]', 'Vay mua đất mẫu');
    await enter('#debt-principal', '150000');
    await enter('#debt-charges', '10000');
    await b.evaluate(`(() => {const input=document.querySelector('[aria-label="Quản lý nợ"] select'); input.value='test-holding'; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await b.click('Lưu khoản nợ');
    await b.until(`document.body.textContent.includes('Vay mua đất mẫu') && document.body.textContent.includes('Đã lưu thông tin khoản nợ.')`);
    assert.equal(b.debts[0].collateral_holding_id, 'test-holding');
    assert.equal(b.bankBalance(), 1000000);
    await b.click('Trả nợ');
    await b.evaluate(`(() => {const input=document.querySelector('[aria-label="Quản lý nợ"] select'); input.value='note-expense'; input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await enter('#repay-principal', '40000');
    await enter('#repay-charges', '10000');
    await b.click('Ghi trả nợ');
    await b.until(`document.body.textContent.includes('Lịch sử trả nợ (1)')`);
    assert.equal(b.repayments[0].transactionId, 'note-expense');
    assert.equal(b.repayments[0].accountId, 'test-bank');
    assert.equal(b.bankBalance(), 950000);
    assert.equal(b.debts[0].principal_vnd, 110000);
    if (process.env.QLTC_DEBT_SCREENSHOT) {
      writeFileSync(process.env.QLTC_DEBT_SCREENSHOT, Buffer.from((await b.page('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    }
    const overflow = await b.evaluate(`JSON.stringify({width:document.documentElement.clientWidth, scroll:document.documentElement.scrollWidth, elements:[...document.querySelectorAll('#root *')].filter(e=>e.getBoundingClientRect().right>document.documentElement.clientWidth+1).slice(0,8).map(e=>[e.tagName,String(e.className),e.textContent.slice(0,80),e.getBoundingClientRect().right])})`);
    assert.ok(await b.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), overflow);
    await b.evaluate(`document.querySelector('button[aria-label="Đóng quản lý nợ"]').click()`);
    await b.until(`document.body.textContent.includes('2.000.840.000')`);
  } finally { await b.close(); }
});

test('existing receivable loan can be selected after dismissing a stuck debt draft and uses dark select contrast', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ loanScenario: true, existingLoans: true });
  try {
    await b.evaluate(`localStorage.setItem('qltc_draft_outbox_v2', JSON.stringify([{ operationId: 'stuck_debt_op', endpoint: '/debts', method: 'POST', payload: { kind: 'receivable' }, createdAt: '2026-11-20T00:00:00.000Z' }]))`);
    await b.click('Danh sách (2)');
    await b.until(`!!document.querySelector('#list-note-note-income')`);
    await b.click('Thu nợ');
    await b.until(`!!document.querySelector('#loan-receipt-choice')`);
    assert.equal(await b.evaluate(`document.querySelector('[aria-label="Quản lý nợ"] fieldset').disabled`), true);
    await b.click('Hủy yêu cầu chờ');
    await b.until(`!document.querySelector('[aria-label="Quản lý nợ"] fieldset').disabled`);
    const styleCheck = await b.evaluate(`(() => {
      const root = getComputedStyle(document.documentElement);
      const opt = document.querySelector('#loan-receipt-choice option[value="sample-debt"]');
      const optStyle = getComputedStyle(opt);
      return { rootScheme: root.colorScheme, optBg: optStyle.backgroundColor, optColor: optStyle.color };
    })()`);
    assert.equal(styleCheck.rootScheme, 'dark');
    assert.equal(styleCheck.optBg, 'rgb(22, 28, 30)');
    assert.equal(styleCheck.optColor, 'rgb(242, 245, 245)');
    await b.evaluate(`document.querySelector('[aria-label="Chọn nhanh khoản cho vay"] button').click()`);
    assert.equal(await b.evaluate(`document.querySelector('#loan-receipt-choice').value`), 'sample-debt');
    await b.until(`Array.from(document.querySelectorAll('p')).some(p => p.textContent.includes('Gốc còn lại sau khi thu') && p.textContent.includes('300.000'))`);
    await b.click('Xác nhận thu nợ');
    await b.until(`document.body.textContent.includes('Lịch sử thu nợ (1)')`);
    assert.equal(b.repayments[0].principalVnd, 100000);
    assert.equal(b.debts[0].principal_vnd, 300000);
  } finally { await b.close(); }
});

test('rejecting when the session expired moves to sign-in instead of sticking on a generic error', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ rejectUnauthorized: true });
  try {
    await b.click('Bỏ qua');
    await b.until(`!!document.querySelector('input[type="password"]')`);
    assert.ok(await b.evaluate(`document.body.textContent.includes('Phiên đăng nhập đã hết hạn')`));
  } finally { await b.close(); }
});

test('approving dismisses the card immediately on slow networks while gating toast on server ok and restoring on failure', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture({ slowTransactionDelayMs: 600, failTransactionId: 'note-income' });
  try {
    await b.until(`!!document.querySelector('#pending-note-note-expense')`);
    await b.click('Xác nhận duyệt');
    await b.until(`!!document.querySelector('#pending-note-note-income')`);
    assert.equal(b.saved.length, 0, 'card transitions immediately without waiting for slow PUT response');
    assert.equal(await b.evaluate(`document.body.textContent.includes('Đã duyệt:')`), false, 'V2-07 toast must stay gated until server ok');
    assert.ok(await b.evaluate(`document.body.textContent.includes('Đang đồng bộ 1 thao tác')`));

    await b.until(`document.body.textContent.includes('Đã duyệt:')`);
    assert.equal(b.saved.length, 1);
    assert.equal(b.saved[0].id, 'note-expense');

    await b.click('Xác nhận duyệt');
    await b.until(`document.body.textContent.includes('Đang đồng bộ giao dịch với máy chủ')`);
    assert.equal(await b.evaluate(`document.body.textContent.includes('Tất cả giao dịch đã được duyệt')`), false);
    await b.until(`!!document.querySelector('#pending-note-note-income') && document.body.textContent.includes('Không thể duyệt giao dịch trên máy chủ')`);
  } finally { await b.close(); }
});

test('swiping left to dismiss triggers haptic feedback only when committed', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture();
  const card = `document.querySelector('[id^="pending-note-"]').closest('.bg-gradient-to-br')`;
  const swipe = async (moves) => {
    await b.evaluate(`${card}.scrollIntoView({block:'center'})`);
    const point = await b.evaluate(`(() => {const r=${card}.getBoundingClientRect();return {x:r.left+r.width/2,y:Math.max(70,r.top+30)};})()`);
    await b.page('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: point.x, y: point.y }] });
    for (const [dx, dy] of moves) {
      await b.page('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: point.x + dx, y: point.y + dy }] });
    }
    await b.page('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await b.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  };
  try {
    await b.page('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    await b.until(`!!document.querySelector('#pending-note-note-expense')`);
    await b.evaluate(`(() => {
      window.__hapticCalls = 0;
      window.AndroidBridge = { triggerLightHaptic() { window.__hapticCalls += 1; } };
    })()`);

    await swipe([[-25, 0], [-55, 0]]);
    assert.equal(await b.evaluate(`window.__hapticCalls`), 0, 'short swipe must not vibrate');
    await swipe([[-2, 35], [-125, 100]]);
    assert.equal(await b.evaluate(`window.__hapticCalls`), 0, 'vertical scroll must not vibrate');

    await swipe([[-35, 0], [-130, 0]]);
    await b.until(`!!document.querySelector('#pending-note-note-income')`);
    assert.equal(await b.evaluate(`window.__hapticCalls`), 1);
    assert.equal(b.saved.length, 1);
    assert.equal(b.saved[0].status, 'rejected');

    await b.evaluate(`(() => {
      delete window.AndroidBridge;
      window.__vibrateArgs = [];
      navigator.vibrate = arg => { window.__vibrateArgs.push(arg); return true; };
    })()`);
    await swipe([[-35, 0], [-130, 0]]);
    await b.until(`!document.querySelector('#pending-note-note-income')`);
    assert.deepEqual(await b.evaluate(`window.__vibrateArgs`), [18]);
    assert.equal(b.saved.length, 2);
    assert.equal(b.saved[1].status, 'rejected');
  } finally { await b.close(); }
});
