export default {
  async fetch(request: Request, env: { ASSETS: { fetch: (req: Request | string) => Promise<Response> } }): Promise<Response> {
    const url = new URL(request.url);

    // Đường dẫn rút gọn tải file APK trực tiếp
    if (url.pathname === '/apk' || url.pathname === '/download') {
      return Response.redirect('https://github.com/DUCDT3006/qltc/releases/download/v1.0.6/qltc-v1.0.6.apk', 302);
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

    return response;
  }
};
