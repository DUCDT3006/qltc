import { FmarketFund } from '../types';

export type FmarketFeedStatus = 'loading' | 'available' | 'stale' | 'unavailable';

export interface ParsedFmarketResponse {
  funds: FmarketFund[];
  status: FmarketFeedStatus;
}

export async function fetchFmarketFunds(
  fetcher: typeof fetch = fetch,
  endpoint = '/api/market/fmarket-funds'
): Promise<ParsedFmarketResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(endpoint, { credentials: 'same-origin', signal: controller.signal });
    const payload = await response.json().catch(() => null);
    return parseFmarketFundsResponse(payload, response.ok);
  } catch {
    return { funds: [], status: 'unavailable' };
  } finally {
    clearTimeout(timeout);
  }
}

/** Parses the real /api/market/fmarket-funds contract without inventing NAV values. */
export function parseFmarketFundsResponse(payload: unknown, httpOk = true): ParsedFmarketResponse {
  if (!httpOk || !payload || typeof payload !== 'object') return { funds: [], status: 'unavailable' };
  const response = payload as { funds?: unknown; stale?: unknown; quoteOnSelect?: unknown };
  if (!Array.isArray(response.funds)) return { funds: [], status: 'unavailable' };

  const funds = response.funds.flatMap((candidate): FmarketFund[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as Record<string, unknown>;
    const shortName = typeof row.shortName === 'string' ? row.shortName.trim() : '';
    if (!shortName) return [];
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : shortName;
    const rawNav = Number(row.nav);
    const navDate = typeof row.navDate === 'string' && row.navDate.trim() ? row.navDate.trim() : undefined;
    const updatedAt = navDate ? Date.parse(navDate) : NaN;
    const dateKnown = Number.isFinite(updatedAt);
    const navKnown = Number.isFinite(rawNav) && rawNav > 0;
    const stale = row.stale === true || !dateKnown || !navKnown;
    return [{
      shortName,
      name,
      nav: navKnown ? rawNav : null,
      navDate: dateKnown ? navDate : undefined,
      updatedAt: dateKnown ? updatedAt : undefined,
      issuer: typeof row.issuer === 'string' ? row.issuer : undefined,
      stale,
      navAvailable: navKnown && dateKnown && row.stale !== true
    }];
  });

  if (response.quoteOnSelect === true && funds.length > 0) return { funds, status: 'available' };
  const usableCount = funds.filter(fund => fund.navAvailable).length;
  if (funds.length === 0 || usableCount === 0) return { funds, status: 'unavailable' };
  return { funds, status: usableCount < funds.length || response.stale === true ? 'stale' : 'available' };
}

export type FmarketQuote = Pick<FmarketFund, 'shortName' | 'name' | 'stale'> & { nav: number; navDate: string };

export async function fetchFmarketQuote(symbol: string, signal?: AbortSignal): Promise<FmarketQuote | null> {
  const res = await fetch(`/api/market/fmarket-funds/${encodeURIComponent(symbol)}`, { credentials: 'same-origin', signal });
  if (!res.ok) return null;
  const data = await res.json();
  const fund = parseFmarketFundsResponse({ funds: [data] }).funds[0];
  if (!fund || fund.shortName.toUpperCase() !== symbol || !fund.nav || !fund.navDate) return null;
  return { shortName: fund.shortName, name: fund.name, nav: fund.nav, navDate: fund.navDate, stale: fund.stale };
}
