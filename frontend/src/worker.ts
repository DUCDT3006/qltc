type FrontendWorkerEnv = {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  BACKEND?: { fetch: (request: Request) => Promise<Response> };
};

export default {
  async fetch(request: Request, env: FrontendWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    // Keep browser API traffic same-origin so the HttpOnly session cookie is first-party.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.BACKEND) return Response.json({ error: 'Backend service binding is not configured', code: 'BACKEND_UNAVAILABLE' }, { status: 503 });
      return env.BACKEND.fetch(request);
    }

    // Đường dẫn rút gọn tải file APK trực tiếp
    if (url.pathname === '/apk' || url.pathname === '/download') {
      return Response.redirect('https://github.com/DUCDT3006/qltc/releases/download/v2.0.3/qltc-v2.0.3.apk', 302);
    }

    // Serve static assets or fallback to index.html for SPA routing
    let response = await env.ASSETS.fetch(request);
    let servedHtml = false;
    if (response.status === 404 && !url.pathname.includes('.')) {
      response = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
      servedHtml = true;
    }

    // Luôn không cache index.html để Android WebView tự động nạp code mới ngay lập tức
    if (servedHtml || url.pathname === '/' || url.pathname.endsWith('.html')) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      headers.set('Content-Security-Policy', "frame-src 'none'; object-src 'none'");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    if (url.pathname === '/sw.js' || url.pathname === '/assets/index.js' || url.pathname === '/assets/index.css') {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }

    // Only fingerprinted entry assets may be treated as immutable.
    if (response.ok && /^\/assets\/index-[\w-]+\.(?:js|css)$/.test(url.pathname)) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
};
