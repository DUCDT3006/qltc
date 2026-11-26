const API = 'https://api.fmarket.vn/res';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface FmarketProduct {
  productId: number;
  shortName: string;
  name: string;
  issuer?: string;
}

export interface FmarketQuote extends FmarketProduct {
  nav: number;
  navDate: string;
  stale: boolean;
}

async function readFmarket(path: string, body: object): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${API}/${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Fmarket HTTP ${response.status}`);
    return (await response.json() as { data?: unknown }).data;
  } finally {
    clearTimeout(timeout);
  }
}

// These are the public product list and NAV history used by https://fmarket.vn/quy.
export async function loadFmarketProducts(symbol?: string): Promise<FmarketProduct[]> {
  const products = new Map<string, FmarketProduct>();
  const pageSize = 100;
  for (let page = 1; page <= 5; page++) {
    const payload = await readFmarket('products/filter', {
      types: ['NEW_FUND', 'TRADING_FUND'], page, pageSize, ...(symbol ? { searchField: symbol } : {})
    });
    if (!Array.isArray(payload?.rows)) throw new Error('Invalid Fmarket catalog');
    for (const row of payload.rows) {
      const shortName = typeof row?.shortName === 'string' ? row.shortName.trim().toUpperCase() : '';
      const name = typeof row?.name === 'string' ? row.name.trim() : '';
      const productId = Number(row?.id);
      if (!shortName || !name || !Number.isSafeInteger(productId) || productId <= 0 || row.status !== 'PRODUCT_ACTIVE') continue;
      const issuer = row.owner?.shortName || row.owner?.name;
      products.set(shortName, { shortName, name, productId, issuer: typeof issuer === 'string' ? issuer : undefined });
    }
    if ((symbol && products.has(symbol)) || page * Number(payload.pageSize || pageSize) >= Number(payload.total || 0) || payload.rows.length === 0) break;
  }
  return [...products.values()].sort((a, b) => a.shortName.localeCompare(b.shortName));
}

export async function loadFmarketNav(product: FmarketProduct, now = Date.now()): Promise<FmarketQuote | null> {
  const rows = await readFmarket('product/get-nav-history', {
    isAllData: 0, productId: product.productId, navPeriod: 'navTo12Months'
  });
  if (!Array.isArray(rows)) throw new Error('Invalid Fmarket NAV history');

  const today = new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
  let latest: FmarketQuote | null = null;
  for (const row of rows) {
    const nav = Number(row?.nav);
    const navDate = row?.navDate;
    if (Number(row?.productId) !== product.productId || !Number.isFinite(nav) || nav <= 0 ||
        typeof navDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(navDate) || navDate > today) continue;
    const dateMs = Date.parse(navDate);
    if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== navDate) continue;
    if (!latest || navDate > latest.navDate) {
      latest = { ...product, nav, navDate, stale: Date.parse(today) - dateMs > 7 * DAY_MS };
    }
  }
  return latest;
}

export async function loadFmarketQuote(symbol: string): Promise<FmarketQuote | null> {
  const product = (await loadFmarketProducts(symbol)).find(row => row.shortName === symbol);
  return product ? loadFmarketNav(product) : null;
}
