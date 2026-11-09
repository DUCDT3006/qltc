import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const dist = resolve(import.meta.dirname, '../dist');
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const jsAsset = html.match(/\/assets\/index-[\w-]+\.js/)?.[0];
const cssAsset = html.match(/\/assets\/index-[\w-]+\.css/)?.[0];

test('build references existing versioned JS/CSS and a matching offline shell', () => {
  assert.ok(jsAsset && cssAsset);
  assert.ok(existsSync(join(dist, jsAsset.slice(1))));
  assert.ok(existsSync(join(dist, cssAsset.slice(1))));
  assert.ok(html.indexOf(jsAsset) < html.indexOf('data-qltc-startup'));
  const sw = readFileSync(join(dist, 'sw.js'), 'utf8');
  assert.ok(sw.includes(`const JS_ASSET = '${jsAsset}'`));
  assert.ok(sw.includes(`const CSS_ASSET = '${cssAsset}'`));
  assert.ok(!sw.includes('__QLTC_JS_ASSET__'));
  const headers = readFileSync(join(dist, '_headers'), 'utf8');
  assert.match(headers, /\/assets\/index-\*\.js[\s\S]*immutable/);
  assert.match(headers, /\/assets\/index\.js[\s\S]*no-cache/);
});

test('new worker replaces only old shell caches and revalidates legacy fixed assets', async () => {
  const listeners = {};
  const stores = new Map([['qltc-shell-v202', new Map([['/assets/index.js', new Response('stale')]])], ['unrelated-user-cache', new Map()]]);
  const keyOf = (request) => typeof request === 'string' ? request : new URL(request.url).pathname;
  const cacheApi = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(paths) { paths.forEach((path) => store.set(path, new Response('shell'))); },
        async put(request, response) { store.set(keyOf(request), response); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) {
        const hit = store.get(keyOf(request));
        if (hit) return hit;
      }
    }
  };
  let fetched = 0;
  let online = true;
  const context = {
    URL, Response, AbortController, setTimeout, clearTimeout,
    caches: cacheApi,
    fetch: async () => { fetched++; if (!online) throw new Error('offline'); return new Response('fresh'); },
    self: {
      location: { origin: 'https://example.test' },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name, fn) => { listeners[name] = fn; }
    }
  };
  runInNewContext(readFileSync(join(dist, 'sw.js'), 'utf8'), context);
  let installing;
  listeners.install({ waitUntil: (promise) => { installing = promise; } });
  await installing;
  let activating;
  listeners.activate({ waitUntil: (promise) => { activating = promise; } });
  await activating;
  assert.ok(!stores.has('qltc-shell-v202'));
  assert.ok(stores.has('unrelated-user-cache'));
  let responding;
  listeners.fetch({ request: { url: 'https://example.test/assets/index.js', method: 'GET', mode: 'cors' }, respondWith: (promise) => { responding = promise; } });
  assert.equal(await (await responding).text(), 'fresh');
  assert.equal(fetched, 1);

  online = false;
  listeners.fetch({ request: { url: 'https://example.test/dashboard', method: 'GET', mode: 'navigate' }, respondWith: (promise) => { responding = promise; } });
  assert.equal(await (await responding).text(), 'shell');
  online = true;
  listeners.fetch({ request: { url: 'https://example.test/dashboard', method: 'GET', mode: 'navigate' }, respondWith: (promise) => { responding = promise; } });
  assert.equal(await (await responding).text(), 'fresh');
});

const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function browserCase(scriptMode, budget = 4000, authStatus = 401) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/auth/session') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"signed out"}');
      return;
    }
    if (pathname === jsAsset && scriptMode === 'missing') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
      return;
    }
    if (pathname === jsAsset && scriptMode === 'silent') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end('// simulates a bundle that never mounts React');
      return;
    }
    const safePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (safePath.includes('..')) { res.writeHead(400); res.end(); return; }
    if (safePath === 'index.html') {
      const refreshCase = scriptMode.startsWith('refresh-');
      const mock = refreshCase ? `<script>
        window.fetch = async function(input) {
          var path = String(input).split('?')[0];
          var payloads = {
            '/api/auth/session': {authenticated:true},
            '/api/accounts': {accounts:[]}, '/api/jars': {jars:[]}, '/api/holdings': {holdings:[]},
            '/api/income-sources': {incomeSources:[]}, '/api/planned-expenses': {plannedExpenses:[]},
            '/api/user/profile': {user:{name:'Test user'}},
            '/api/transactions': {transactions:[],pagination:{totalCount:0,hasMore:false,nextCursor:null,dataRevision:0}}
          };
          if (path === '/api/transactions' && ${scriptMode === 'refresh-failure'}) return new Response('{"error":"D1_ERROR: no such column: j.icon"}', {status:500});
          return new Response(JSON.stringify(payloads[path] || {}), {status:payloads[path] ? 200 : 503});
        };
        var clicked = false;
        var observer = new MutationObserver(function () {
          if (!clicked) return;
          var text = document.getElementById('root')?.textContent || '';
          if (text.includes('Chưa tải đủ dữ liệu từ máy chủ')) document.documentElement.setAttribute('data-refresh-error-seen', 'true');
          if (text.includes('Đã tải đầy đủ dữ liệu từ máy chủ') || text.includes('Dữ liệu đã được đồng bộ mới nhất')) document.documentElement.setAttribute('data-refresh-success-seen', 'true');
        });
        observer.observe(document.documentElement, {childList:true,subtree:true,characterData:true});
        var clickTimer = setInterval(function () {
          var button = document.querySelector('button[title="Tải lại dữ liệu từ máy chủ"],button[title="Đồng bộ thông báo từ ngân hàng"]');
          if (button && !button.disabled) {
            clicked = true;
            document.documentElement.setAttribute('data-refresh-clicked', 'true');
            clearInterval(clickTimer);
            button.click();
          }
        }, 100);
      </script>` : `<script>window.fetch = async function(input) { if (String(input).indexOf('/api/auth/session') !== -1) return new Response('{}', {status: ${authStatus}}); return new Response('{}', {status: 404}); };</script>`;
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.end(html.replace('<script type="module"', mock + '<script type="module"'));
      return;
    }
    const file = join(dist, safePath);
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(readFileSync(file));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const profile = mkdtempSync(join(tmpdir(), 'qltc-startup-'));
  try {
    const url = `http://127.0.0.1:${server.address().port}/`;
    const output = await new Promise((resolveOutput, reject) => {
      const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--disable-extensions', `--user-data-dir=${profile}`, `--virtual-time-budget=${budget}`, '--dump-dom', url]);
      let stdout = '';
      proc.stdout.on('data', (chunk) => { stdout += chunk; });
      proc.on('error', reject);
      proc.on('close', (code) => code === 0 ? resolveOutput(stdout) : reject(new Error(`Chrome exit ${code}`)));
    });
    const root = output.match(/<div id="root">([\s\S]*?)<script>/)?.[1] || '';
    return (scriptMode.startsWith('refresh-') ? output.match(/<html[^>]*>/)?.[0] || '' : '') + root;
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(profile, { recursive: true, force: true });
  }
}

test('Chrome mounts the signed-out UI after a 401 session response', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('normal');
  assert.match(root, /QLTC cá nhân/);
  assert.match(root, /Đăng nhập/);
  assert.doesNotMatch(root, /data-qltc-startup/);
});

test('Chrome shows reconnect UI after a 503 session response', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('normal', 4000, 503);
  assert.match(root, /Thử kết nối lại/);
  assert.doesNotMatch(root, /data-qltc-startup/);
});

test('Chrome shows retry when the entry script is missing', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('missing');
  assert.match(root, /Không thể tải ứng dụng QLTC/);
  assert.match(root, /Thử tải lại/);
  assert.doesNotMatch(root, /data-qltc-startup/);
});

test('Chrome watchdog replaces a silent startup stall', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('silent', 14000);
  assert.match(root, /Không thể tải ứng dụng QLTC/);
  assert.doesNotMatch(root, /data-qltc-startup/);
});

test('Chrome refresh reports failure without a success toast when transaction loading fails', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('refresh-failure');
  assert.match(root, /data-refresh-clicked="true"/);
  assert.match(root, /data-refresh-error-seen="true"/);
  assert.doesNotMatch(root, /data-refresh-success-seen="true"/);
  assert.doesNotMatch(root, /D1_ERROR/);
});

test('Chrome refresh reports success only after every primary collection loads', { skip: !existsSync(chrome) }, async () => {
  const root = await browserCase('refresh-success');
  assert.match(root, /data-refresh-clicked="true"/);
  assert.match(root, /data-refresh-success-seen="true"/);
  assert.doesNotMatch(root, /data-refresh-error-seen="true"/);
});
