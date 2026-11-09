import { FmarketFund } from '../types';

export type FmarketFeedStatus = 'available' | 'stale' | 'unavailable';

export interface ParsedFmarketResponse {
  funds: FmarketFund[];
  status: FmarketFeedStatus;
}

export async function fetchFmarketFunds(
  fetcher: typeof fetch = fetch,
  endpoint = '/api/market/fmarket-funds'
): Promise<ParsedFmarketResponse> {
  try {
    const response = await fetcher(endpoint, { credentials: 'same-origin' });
    const payload = await response.json().catch(() => null);
    return parseFmarketFundsResponse(payload, response.ok);
  } catch {
    return { funds: [], status: 'unavailable' };
  }
}

/** Parses the real /api/market/fmarket-funds contract without inventing NAV values. */
export function parseFmarketFundsResponse(payload: unknown, httpOk = true): ParsedFmarketResponse {
  if (!httpOk || !payload || typeof payload !== 'object') return { funds: [], status: 'unavailable' };
  const response = payload as { funds?: unknown; stale?: unknown };
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

  const usableCount = funds.filter(fund => fund.navAvailable).length;
  if (funds.length === 0 || usableCount === 0) return { funds, status: 'unavailable' };
  return { funds, status: usableCount < funds.length || response.stale === true ? 'stale' : 'available' };
}
