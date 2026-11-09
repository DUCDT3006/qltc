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
async function fixture() {
  const transactions = ['expense', 'income'].map((type, index) => ({
    id: `note-${type}`, account_id: 'test-bank', account_name: 'Test bank', bank_code: 'VCB', type,
    amount: index ? 100000 : 50000, description: `Original ${type}`, status: 'pending', occurred_at: '2026-11-09T01:23:45Z',
    jar_id: type === 'expense' ? 'test-jar' : null, revision: 1
  }));
  const saved = [];
  const server = createServer(async (req, res) => {
    const path = new URL(req.url || '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      let payload;
      if (req.method === 'PUT' && path.startsWith('/api/transactions/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const data = JSON.parse(body);
        const id = path.split('/').at(-1);
        saved.push({ id, ...data });
        const txn = transactions.find(t => t.id === id);
        if (data.status !== undefined) txn.status = data.status;
        if (data.note !== undefined) txn.note = data.note.trim() || null;
        if (data.description !== undefined) txn.description = data.description;
        txn.revision++;
        payload = { success: true, revision: txn.revision, note: txn.note };
      } else {
        payload = {
          '/api/auth/session': { authenticated: true },
          '/api/accounts': { accounts: [{ id: 'test-bank', name: 'Test bank', type: 'bank', balance: 1000000 }] },
          '/api/jars': { jars: [{ id: 'test-jar', name: 'Test jar', code: 'NEC', target_percent: 100, monthly_limit: 500000, spent_this_month: 0 }] },
          '/api/holdings': { holdings: [] }, '/api/income-sources': { incomeSources: [] }, '/api/planned-expenses': { plannedExpenses: [] },
          '/api/user/profile': { user: { name: 'Test owner' } },
          '/api/transactions': { transactions, pagination: { totalCount: transactions.length, hasMore: false, nextCursor: null, dataRevision: 0 } }
        }[path];
      }
      res.writeHead(payload ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload || {})); return;
    }
    const file = join(dist, path === '/' ? 'index.html' : path.slice(1));
    if (path.includes('..') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = await mkdtemp(join(tmpdir(), 'qltc-note-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-extensions', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let active;
  for (let i = 0; i < 100; i++) { try { active = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split(/\r?\n/); break; } catch { await delay(100); } }
  if (!active) throw new Error('Chrome did not start');
  const ws = new WebSocket(`ws://127.0.0.1:${active[0]}${active[1]}`);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const pending = new Map(); let id = 0;
  ws.addEventListener('message', ({ data }) => { const msg = JSON.parse(data); if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); if (p) msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  await page('Page.enable'); await page('Runtime.enable'); await page('Network.enable');
  await page('Network.setBlockedURLs', { urls: ['https://fonts.googleapis.com/*', 'https://fonts.gstatic.com/*'] });
  await page('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 1, mobile: true });
  const evaluate = async expression => { const out = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description || out.exceptionDetails.text); return out.result.value; };
  const until = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`Timed out: ${expression}`); };
  const click = async text => { const found = await evaluate(`(() => { const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}); if (!b || b.disabled) return false; b.click(); return true; })()`); assert.ok(found, `button ${text} must be available`); };
  const fill = async (selector, value) => evaluate(`(() => {const input=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
  await until(`document.body.textContent.includes('Đăng xuất')`);
  await until(`document.querySelectorAll('button').length > 8`);
  await click('Giao dịch');
  await until(`!!document.querySelector('#pending-note-note-expense')`);
  return { saved, transactions, evaluate, until, click, fill, page, async close() {
    await send('Browser.close').catch(() => {}); ws.close(); proc.kill();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } };
}

test('mobile review saves the optional note, keeps it after reload, and does not approve while editing', { skip: !existsSync(chrome), timeout: 40000 }, async () => {
  const b = await fixture();
  try {
    await b.click('Thêm ghi chú');
    const note = 'Ăn trưa cùng gia đình\nChia tiền sau';
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
    await b.page('Page.reload');
    await b.until(`document.body.textContent.includes('Đăng xuất')`);
    await b.click('Giao dịch'); await b.click('Lịch sử (2)');
    await b.until(`document.body.textContent.includes('Ghi chú: Ăn trưa cùng gia đình')`);
    await b.evaluate(`Array.from(document.querySelectorAll('p')).find(p=>p.textContent.startsWith('Ghi chú:')).click()`);
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
  } finally { await b.close(); }
});
