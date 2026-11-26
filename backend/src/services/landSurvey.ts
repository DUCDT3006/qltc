import { isValidVndAmount } from './ledger';

type LandUse = 'residential' | 'agricultural' | 'mixed';
type Access = 'frontage' | 'alley';
export interface LandPosition { lat: number; lng: number }
export interface LandDetails extends LandPosition {
  address: string;
  parcel: string;
  landUse: LandUse | null;
  access: Access | null;
  valuation: LandValuation | null;
}

export interface LandValuation {
  source: 'dulieu.dev';
  kind: 'asking';
  surveyedAt: string;
  newestSampleOn: string | null;
  radiusKm: number;
  sampleCount: number;
  lowPerM2: number;
  medianPerM2: number;
  highPerM2: number;
  scope?: 'ward' | 'district';
  locationLabel?: string;
}

export interface LandSurveyInput extends LandPosition {
  area: number;
  radiusKm: number;
  landUse: LandUse | null;
  access: Access | null;
  allowRegion?: boolean;
}

const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validRadius = (value: unknown): value is number => value === 1 || value === 2 || value === 5;
const validUse = (value: unknown): value is LandUse => value === 'residential' || value === 'agricultural' || value === 'mixed';
const validAccess = (value: unknown): value is Access => value === 'frontage' || value === 'alley';
const isPosition = (value: any): value is LandPosition => typeof value?.lat === 'number' && value.lat >= 7 && value.lat <= 24 &&
  typeof value?.lng === 'number' && value.lng >= 100 && value.lng <= 115;
export const isLandArea = (area: unknown): area is number => typeof area === 'number' && Number.isFinite(area) && area > 0 && area <= 10_000_000;

export function parseLandDetails(value: any, price?: number): LandDetails | null {
  if (!isPosition(value)) return null;
  const { lat, lng, address, parcel, landUse, access, valuation } = value as LandDetails;
  if (typeof address !== 'string' || address.length > 250 || typeof parcel !== 'string' || parcel.length > 100 ||
      !(landUse === null || validUse(landUse)) || !(access === null || validAccess(access))) return null;
  if (valuation !== null) {
    if (!valuation || valuation.source !== 'dulieu.dev' || valuation.kind !== 'asking' ||
        typeof valuation.surveyedAt !== 'string' || !Number.isFinite(Date.parse(valuation.surveyedAt)) ||
        !(valuation.newestSampleOn === null || isDate(valuation.newestSampleOn)) || !validRadius(valuation.radiusKm) ||
        !Number.isInteger(valuation.sampleCount) || valuation.sampleCount < 3 || valuation.sampleCount > 500 ||
        (valuation.scope !== undefined && !['ward', 'district'].includes(valuation.scope)) ||
        (valuation.scope !== undefined && (typeof valuation.locationLabel !== 'string' || !valuation.locationLabel.trim() || valuation.locationLabel.length > 150)) ||
        !isValidVndAmount(valuation.lowPerM2) || !isValidVndAmount(valuation.medianPerM2) || !isValidVndAmount(valuation.highPerM2) ||
        valuation.lowPerM2 > valuation.medianPerM2 || valuation.medianPerM2 > valuation.highPerM2 ||
        (price !== undefined && price !== valuation.medianPerM2)) return null;
  }
  return { lat, lng, address: address.trim(), parcel: parcel.trim(), landUse, access, valuation };
}

export function readLandDetails(json: unknown): LandDetails | null {
  try { return typeof json === 'string' ? parseLandDetails(JSON.parse(json)) : null; }
  catch { return null; }
}

export function parseLandSurveyInput(value: any): LandSurveyInput | null {
  if (!isPosition(value)) return null;
  const { lat, lng, area, radiusKm, landUse, access, allowRegion } = value as LandSurveyInput;
  if (!isLandArea(area) || !validRadius(radiusKm) || !(landUse === null || validUse(landUse)) || !(access === null || validAccess(access))) return null;
  if (allowRegion !== undefined && typeof allowRegion !== 'boolean') return null;
  return { lat, lng, area, radiusKm, landUse, access, allowRegion: allowRegion === true };
}

function distanceMeters(a: LandPosition, b: LandPosition): number {
  const rad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * rad / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2;
  return Math.round(12_742_000 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function fold(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd') : '';
}

function listingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 600) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && ['batdongsan.com.vn', 'guland.vn', 'nhatot.com', 'chotot.com'].some(
      host => url.hostname === host || url.hostname.endsWith(`.${host}`)
    )) return url.href;
  } catch { /* A comparison can be displayed without a link. */ }
  return null;
}

type Region = { scope: 'ward' | 'district'; locationLabel: string };
const DAY_MS = 86_400_000;
const vietnamDay = (now: Date, daysAgo = 0) =>
  new Date(now.getTime() + 7 * 3600_000 - daysAgo * DAY_MS).toISOString().slice(0, 10);

function listingId(row: any): string | null {
  if (typeof row?.source_id === 'string' && row.source_id && row.source_id.length <= 200) return row.source_id;
  return typeof row?.source === 'string' && (typeof row.listing_id === 'string' || typeof row.listing_id === 'number')
    ? row.source + ':' + row.listing_id : null;
}

function sample(row: any, query: LandSurveyInput, today: string, region: Region | undefined, matchArea: boolean) {
  if (!row || row.transaction !== 'ban' || !/^(?:land(?:-[a-z-]+)?|dat(?:-[a-z-]+)?)$/.test(fold(row.property_type))) return null;
  if (region) {
    const areaName = region.scope === 'ward' ? row.ward : row.district;
    if (!sameRegionName(areaName, region.locationLabel, region.scope)) return null;
  }
  const position = { lat: Number(row.lat ?? NaN), lng: Number(row.lng ?? NaN) };
  if (!region && !isPosition(position)) return null;
  const distanceM = region ? null : distanceMeters(query, position);
  const area = Number(row.area);
  if ((distanceM !== null && distanceM > query.radiusKm * 1000) || !isLandArea(area) ||
      (matchArea && (area < query.area / 2 || area > query.area * 2))) return null;

  // Only use properties that explicitly mention the selected land use / road access.
  const foldedTitle = fold(row.title).trim();
  if (/^dau gia\b|\bgia khoi diem\b/.test(foldedTitle)) return null;
  const description = [fold(row.property_type), foldedTitle, fold(row.type_name)].join(' ').replace(/-/g, ' ');
  const usePattern = query.landUse === 'residential' ? /\b(?:tho cu|dat o)\b/ :
    query.landUse === 'agricultural' ? /\b(?:nong nghiep|trong cay|dat ruong)\b/ :
      query.landUse === 'mixed' ? /\b(?:hon hop|tho cu.*nong nghiep|nong nghiep.*tho cu)\b/ : null;
  const accessPattern = query.access === 'frontage' ? /\bmat tien\b/ : query.access === 'alley' ? /\b(?:hem|ngo|ngach)\b/ : null;
  if ((usePattern && !usePattern.test(description)) || (accessPattern && !accessPattern.test(description))) return null;

  const value = Number(row.price_value);
  const perM2 = row.price_unit === 'total' ? Math.round(value / area) : row.price_unit === 'per_m2' ? Math.round(value) : 0;
  if (!isValidVndAmount(perM2) || (matchArea && !isValidVndAmount(Math.round(perM2 * query.area)))) return null;
  const observedOn = [row.crawl_date, row.date, row.snapshot_date, row.fetched_at].filter((date): date is string => typeof date === 'string')
    .map(date => date.slice(0, 10)).find(isDate) ?? null;
  if (observedOn && (observedOn > today || Date.parse(today) - Date.parse(observedOn) > 90 * DAY_MS)) return null;

  const source = typeof row.source === 'string' && /^[a-z0-9.-]{1,50}$/i.test(row.source) ? row.source : 'DuLieu.dev';
  const title = typeof row.title === 'string' ? row.title.trim().slice(0, 150) : 'Tin bán đất';
  return {
    id: listingId(row), fingerprint: region ? `${foldedTitle}|${area}|${perM2}` : `${position.lat.toFixed(5)}|${position.lng.toFixed(5)}|${area}|${perM2}`,
    title, area, perM2, distanceM, observedOn, source, url: listingUrl(row.url)
  };
}

function percentile(sorted: number[], p: number): number {
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  return Math.round(sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower));
}

function landComparisons(data: unknown[], query: LandSurveyInput, now: Date, region?: Region, matchArea = true) {
  const today = vietnamDay(now);
  const keys = new Set<string>();
  return data.slice(0, 500).flatMap(row => {
    const listing = sample(row, query, today, region, matchArea);
    if (!listing || keys.has(listing.fingerprint) || (listing.id && keys.has(listing.id))) return [];
    keys.add(listing.fingerprint);
    if (listing.id) keys.add(listing.id);
    const { fingerprint: _fingerprint, id: _id, ...comparison } = listing;
    return [comparison];
  }).sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

export function buildLandSurvey(data: unknown[], query: LandSurveyInput, now = new Date(), region?: Region) {
  const comparisons = landComparisons(data, query, now, region);
  const prices = comparisons.map(row => row.perM2).sort((a, b) => a - b);
  const valuation: LandValuation | null = prices.length >= 3 ? {
    source: 'dulieu.dev', kind: 'asking', surveyedAt: now.toISOString(),
    newestSampleOn: comparisons.map(row => row.observedOn).filter((day): day is string => day !== null).sort().at(-1) ?? null,
    radiusKm: query.radiusKm, sampleCount: prices.length,
    lowPerM2: percentile(prices, 0.25), medianPerM2: percentile(prices, 0.5), highPerM2: percentile(prices, 0.75),
    ...region
  } : null;
  return { valuation, sampleCount: prices.length, comparisons: comparisons.slice(0, 8), ...region };
}

type LandSurvey = ReturnType<typeof buildLandSurvey>;
type LandReference = Region & { comparisons: LandSurvey['comparisons'] };

function landReference(rows: unknown[], query: LandSurveyInput, now: Date, region: Region): LandReference {
  const comparisons = landComparisons(rows, { ...query, landUse: null, access: null }, now, region, false)
    .sort((a, b) => Math.abs(a.area - query.area) - Math.abs(b.area - query.area)).slice(0, 4);
  return { ...region, comparisons };
}

export class LandSourceError extends Error {
  constructor(endpoint: string, readonly reason: string) { super(`Land source ${endpoint}: ${reason}`); }
}

async function readLandApi(path: string, params: Record<string, string>, apiKey: string, timeoutMs: number): Promise<any[]> {
  const url = new URL(path, 'https://dulieu.dev');
  url.search = new URLSearchParams(params).toString().replace(/\+/g, '%20');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Workers supports manual redirects, while redirect:'error' throws before sending a request.
    // A 3xx is rejected below so the provider key is never forwarded to a redirected host.
    const response = await fetch(url.toString(), { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) throw new LandSourceError(path, `HTTP ${response.status}`);
    const payload = await response.json() as { data?: unknown };
    if (!Array.isArray(payload?.data)) throw new LandSourceError(path, 'Invalid data');
    return payload.data;
  } catch (error) {
    if (error instanceof LandSourceError) throw error;
    throw new LandSourceError(path, error instanceof Error ? error.name : 'Network failure');
  } finally { clearTimeout(timeout); }
}

function searchLocation(value: string): string {
  return value.replace(/^(?:(?:phường|xã|thị trấn|quận|huyện|thành phố|thị xã)\s+|(?:q|h|tp|tx|x|p)\.\s*)/i, '').trim();
}

function sameRegionName(value: unknown, label: string, scope: Region['scope']): boolean {
  if (typeof value !== 'string') return false;
  const actual = fold(searchLocation(value));
  const expected = fold(searchLocation(label));
  // DuLieu.dev annotates some merged wards as e.g. "X. Nhà Bè mới".
  return actual === expected || (scope === 'ward' && /^(?:x|p)\.\s*/i.test(value) && actual === expected + ' moi');
}

async function findListingDistrict(ward: string, province: string, apiKey: string, checkDistrictName: boolean): Promise<string> {
  const rows = await readLandApi('/api/realestate/suggest', { q: searchLocation(ward), limit: '30' }, apiKey, 4000);
  if (checkDistrictName && rows.some((row: any) =>
    row?.type === 'district' && row.province === province && sameRegionName(row.name, ward, 'district'))) return '';
  const matches = new Map<string, string>();
  for (const row of rows) {
    if (row?.type !== 'ward' || row.province !== province || !sameRegionName(row.name, ward, 'ward') ||
        typeof row.district !== 'string' || row.district.length > 150) continue;
    const district = searchLocation(row.district);
    if (district) matches.set(fold(district), district);
  }
  return matches.size === 1 ? [...matches.values()][0] : '';
}

export async function loadLandSurvey(query: LandSurveyInput, apiKey: string): Promise<LandSurvey & { reference?: LandReference }> {
  // Only the coordinates needed for the lookup leave QLTC. Account data and plot notes stay private.
  let nearby: ReturnType<typeof buildLandSurvey> | null = null;
  try {
    const rows = await readLandApi('/api/realestate/nearby', {
      lat: query.lat.toFixed(4), lng: query.lng.toFixed(4), radius: String(query.radiusKm), transaction: 'ban', limit: '500'
    }, apiKey, 2500);
    nearby = buildLandSurvey(rows, query);
    if (nearby.valuation) return nearby;
  } catch { /* Some source listings currently have no coordinates; use a labeled regional comparison. */ }

  // Older interfaces cannot show regional coverage correctly and must keep their radius-only response.
  if (!query.allowRegion) {
    if (nearby) return nearby;
    throw new Error('Radius data unavailable');
  }

  let best: (LandSurvey & { reference?: LandReference }) | null = nearby;
  try {
    const point = `https://www.google.com/maps?q=${query.lat.toFixed(4)},${query.lng.toFixed(4)}`;
    const places = await readLandApi('/api/geo/resolve', { q: point }, apiKey, 5000);
    const place = places[0];
    const resolvedPosition = { lat: Number(place?.lat ?? NaN), lng: Number(place?.lng ?? NaN) };
    let ward = typeof place?.ward === 'string' && place.ward.length <= 150 ? place.ward.trim() : '';
    let district = typeof place?.district === 'string' && place.district.length <= 150 &&
      !sameRegionName(place.province, place.district, 'district') ? place.district.trim() : '';
    if (typeof place?.province_key !== 'string' || !/^[a-z0-9-]{1,60}$/.test(place.province_key) ||
        !isPosition(resolvedPosition) || distanceMeters(query, resolvedPosition) > 1000 ||
        !['high', 'medium'].includes(place.confidence) || (!ward && !district)) throw new Error('No verified location');
    const province = place.province_key;

    // A district filter avoids the provider's slower full-text search. Verify both labels against each listing.
    const deadline = Date.now() + 12000;
    try {
      let listingDistrict = searchLocation(district);
      if (!ward || !listingDistrict || sameRegionName(district, ward, 'ward')) {
        // Some coordinate lookups put a commune name in the district field.
        const mappedDistrict = await findListingDistrict(ward || district, province, apiKey, !ward).catch(() => '');
        if (mappedDistrict) {
          if (!ward) { ward = district; district = ''; }
          else if (!sameRegionName(district, mappedDistrict, 'district')) district = '';
          listingDistrict = mappedDistrict;
        }
      }
      if (listingDistrict) {
        const limit = 150;
        const params = { transaction: 'ban', type: 'dat', province, district: listingDistrict, limit: String(limit) };
        const now = new Date();
        const rows = await readLandApi('/api/realestate', params, apiKey, 6000);
        const inDistrict = (row: any) => row?.province === province && sameRegionName(row.district, listingDistrict, 'district');
        const region: Region = ward ? { scope: 'ward', locationLabel: ward } : { scope: 'district', locationLabel: district };
        let districtRows = rows.filter(inDistrict);
        let regional = buildLandSurvey(districtRows, query, now, region);
        if (regional.valuation) return regional;

        // A bounded query for an individual day is faster than a range query at the source.
        const timeout = Math.min(5000, deadline - Date.now());
        if (timeout > 0) {
          const older: Record<string, string>[] = [7, 14].map(days => ({ ...params, date: vietnamDay(now, days) }));
          if (rows.length >= limit) older.unshift({ ...params, min_area: String(query.area / 2), max_area: String(query.area * 2) });
          const snapshots = await Promise.all(older.map(options => readLandApi('/api/realestate', options, apiKey, timeout).catch(() => [])));
          const seen = new Set<string>();
          districtRows = [...districtRows, ...snapshots.flat().filter(inDistrict)].filter(row => {
            const id = listingId(row);
            if (!id) return true;
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          regional = buildLandSurvey(districtRows, query, now, region);
          if (regional.valuation) return regional;
        }
        if (regional.sampleCount >= (best?.sampleCount ?? 0)) best = regional;
        if (ward && district) {
          const broader = buildLandSurvey(districtRows, query, now, { scope: 'district', locationLabel: district });
          if (broader.valuation) return broader;
          if (broader.sampleCount > (best?.sampleCount ?? -1)) best = broader;
        }
        if (best && best.sampleCount === 0) {
          let reference = landReference(districtRows, query, now, region);
          if (ward && reference.comparisons.length === 0) {
            reference = landReference(districtRows, query, now, { scope: 'district', locationLabel: listingDistrict });
          }
          if (reference.comparisons.length) best = { ...best, reference };
        }
        if (best && rows.length < limit) return best;
      }
    } catch (error) {
      console.warn('Land listings unavailable', error instanceof Error ? error.message : 'Unknown failure');
    }

    const params: Record<string, string> = { transaction: 'ban', type: 'land', area: String(query.area), province };
    if (ward) params.ward = searchLocation(ward);
    if (district) params.district = searchLocation(district);
    const remaining = Math.min(8000, deadline - Date.now());
    if (remaining <= 0) throw new LandSourceError('/api/realestate/estimate', 'AbortError');
    const estimates = await readLandApi('/api/realestate/estimate', params, apiKey, remaining);
    const estimate = estimates[0];
    const scope = estimate?.used_tier?.tier;
    if ((scope !== 'ward' || !params.ward) && (scope !== 'district' || !params.district)) {
      // A price covering the entire province is too broad for a pinned property.
      return best ?? buildLandSurvey([], query);
    }
    if (!Array.isArray(estimate.comps)) throw new Error('Invalid comparison data');
    // These comparisons come from the API's explicit land + sale filter. Their prices are already VND/m².
    const comparisons = estimate.comps.map((row: any) => ({
      ...row, transaction: 'ban', property_type: 'dat', price_unit: 'per_m2', price_value: row?.price_per_m2
    }));
    const regional = buildLandSurvey(comparisons, query, new Date(), { scope, locationLabel: scope === 'ward' ? ward : district });
    return best && best.sampleCount >= regional.sampleCount ? best : regional;
  } catch (error) {
    if (best) return best;
    throw error;
  }
}
