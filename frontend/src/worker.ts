import { INTERFACE_UPDATE } from './interfaceUpdate';

type FrontendWorkerEnv = {
  ASSETS: { fetch: (req: Request | string) => Promise<Response> };
  BACKEND?: { fetch: (request: Request) => Promise<Response> };
};

export default {
  async fetch(request: Request, env: FrontendWorkerEnv): Promise<Response> {
    const url = new URL(request.url);

    // Use the backend's release metadata for the stable download links.
    const apkDownload = url.pathname === '/apk' || url.pathname === '/download';
    // Keep browser API traffic same-origin so the HttpOnly session cookie is first-party.
    if (apkDownload || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      if (!env.BACKEND) return Response.json({ error: 'Backend service binding is not configured', code: 'BACKEND_UNAVAILABLE' }, { status: 503 });
      return env.BACKEND.fetch(apkDownload ? new Request(new URL('/api/download-apk', url), request) : request);
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
      headers.set('X-QLTC-Interface-Revision', String(INTERFACE_UPDATE.revision));
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
