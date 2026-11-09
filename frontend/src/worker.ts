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
      return Response.redirect('https://github.com/DUCDT3006/qltc/releases/download/v2.0.2/qltc-v2.0.2.apk', 302);
    }

    // Serve static assets or fallback to index.html for SPA routing
    let response = await env.ASSETS.fetch(request);
    if (response.status === 404 && !url.pathname.includes('.')) {
      response = await env.ASSETS.fetch(new Request(new URL('/', request.url), request));
    }

    // Luôn không cache index.html để Android WebView tự động nạp code mới ngay lập tức
    if (url.pathname === '/' || url.pathname.endsWith('.html')) {
      const headers = new Headers(response.headers);
      headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      headers.set('Pragma', 'no-cache');
      headers.set('Expires', '0');
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Cache dài hạn và cho phép tải tức thì các tệp tài nguyên tĩnh (/assets/*)
    if (url.pathname.startsWith('/assets/')) {
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
