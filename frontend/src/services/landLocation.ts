import type { LandPosition } from '../types';

export type LandLocation = LandPosition & { label: string; zoom: number };
export const withinVietnam = ({ lat, lng }: LandPosition) => lat >= 7 && lat <= 24 && lng >= 100 && lng <= 115;

interface GeocodedPlace {
  geometry?: { type?: string; coordinates?: unknown[] };
  properties?: Record<string, unknown>;
}

const placeZoom: Readonly<Record<string, number>> = {
  state: 10, county: 12, city: 12, district: 14, locality: 15, street: 16, house: 17
};

export async function findLandLocations(query: string, signal: AbortSignal): Promise<LandLocation[]> {
  const url = new URL('https://photon.komoot.io/api');
  const address = query.normalize('NFC').replace(/\s+/g, ' ').replace(/\b(?:TP[.\s]*)?HCM\b/gi, 'Hồ Chí Minh');
  url.search = new URLSearchParams({ q: address, countrycode: 'VN', limit: '5' }).toString();
  const response = await fetch(url, {
    signal, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    headers: { 'Accept-Language': 'vi-VN,vi;q=0.9' }
  });
  if (!response.ok) throw new Error('Address search unavailable');
  const payload = await response.json() as { features?: GeocodedPlace[] } | null;
  if (!Array.isArray(payload?.features)) throw new Error('Invalid address results');

  const locations: LandLocation[] = [];
  for (const feature of payload.features) {
    const place = feature?.properties;
    const geometry = feature?.geometry;
    if (place?.countrycode !== 'VN' || geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates)) continue;
    const [lng, lat] = geometry.coordinates;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !withinVietnam({ lat, lng })) continue;

    const street = typeof place.street === 'string' && typeof place.housenumber === 'string'
      ? place.housenumber + ' ' + place.street : place.street;
    const parts = [place.name, street, place.locality, place.district, place.county, place.city, place.state];
    const label = [...new Set(parts.flatMap(part => typeof part === 'string' && part.trim() ? [part.trim()] : []))].join(', ');
    if (!label || locations.some(row => row.lat === lat && row.lng === lng && row.label === label)) continue;
    const zoom = typeof place.type === 'string' && Object.hasOwn(placeZoom, place.type) ? placeZoom[place.type] : 15;
    locations.push({ lat, lng, label, zoom });
    if (locations.length === 5) break;
  }
  return locations;
}
