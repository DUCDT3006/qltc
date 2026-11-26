import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapPin, Search } from 'lucide-react';
import type { LandComparison, LandDetails, LandPosition, LandSurvey, LandValuation } from '../types';
import { API_BASE, apiRequestJson } from '../services/apiClient';
import { findLandLocations, withinVietnam, type LandLocation } from '../services/landLocation';
import { formatPrivacyVND } from '../utils/financeMath';

const inputStyle = 'min-h-11 w-full rounded-xl border border-[#8BA5AA]/25 bg-[#20292B] px-3 text-sm text-[#F2F5F5] focus:ring-2 focus:ring-[#8CC7AE]/60';
const buttonStyle = 'min-h-11 rounded-xl border border-[#8BA5AA]/30 px-3 text-sm font-semibold text-[#D5E1E3] active:bg-[#263234] disabled:opacity-50';
type LocationSearch = { kind: 'loading' } | { kind: 'results'; locations: LandLocation[] } |
  { kind: 'message' | 'error'; text: string };

function parseCoordinatePair(query: string): LandPosition | null {
  const pair = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/.exec(query) ??
    /^([+-]?\d+(?:[.,]\d+)?)(?:\s*;\s*|\s+)([+-]?\d+(?:[.,]\d+)?)$/.exec(query);
  if (!pair) return null;
  return { lat: Number(pair[1].replace(',', '.')), lng: Number(pair[2].replace(',', '.')) };
}

function LandMap({ position, onPick }: { position: LandPosition | null; onPick: (point: LandPosition) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const initial = useRef(position);
  const change = useRef(onPick);
  const camera = useRef<{ point: LandPosition; zoom: number } | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [search, setSearch] = useState<LocationSearch | null>(null);
  const [attempt, setAttempt] = useState(0);

  const cancelSearch = useCallback(() => {
    searchRequest.current?.abort();
    searchRequest.current = null;
  }, []);
  useEffect(() => cancelSearch, [cancelSearch]);

  const showOnMap = useCallback((point: LandPosition, zoom: number) => {
    camera.current = { point, zoom };
    map.current?.jumpTo({ center: [point.lng, point.lat], zoom });
  }, []);
  const choose = useCallback((point: LandPosition, zoom = false) => {
    cancelSearch();
    if (!withinVietnam(point)) {
      setSearch({ kind: 'error', text: 'Anh chọn tọa độ ở Việt Nam theo thứ tự vĩ độ, kinh độ.' });
      return;
    }
    const rounded = { lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)) };
    if (zoom) showOnMap(rounded, 17);
    if (map.current) marker.current?.setLngLat([rounded.lng, rounded.lat]).addTo(map.current);
    initial.current = rounded;
    setSearch(null);
    change.current(rounded);
  }, [cancelSearch, showOnMap]);

  useEffect(() => { change.current = onPick; }, [onPick]);
  useEffect(() => { initial.current = position; }, [position]);
  useEffect(() => {
    let disposed = false;
    let hasVectorData = false;
    let loaded = false;
    setReady(false);
    setError('');
    const loadTimeout = setTimeout(() => {
      if (!disposed && !loaded) setError('Chưa tải được nền bản đồ. Anh thử tải lại hoặc nhập tọa độ trong ô Tìm vị trí.');
    }, 12000);
    void import('maplibre-gl').then(M => {
      if (disposed || !host.current) return;
      const start = initial.current;
      const center = camera.current?.point ?? start ?? { lng: 108.2, lat: 16.05 };
      M.setWorkerUrl(mapWorkerUrl);
      const instance = new M.Map({
        container: host.current,
        style: 'https://tiles.openfreemap.org/styles/bright',
        center: [center.lng, center.lat],
        zoom: camera.current?.zoom ?? (start ? 17 : 6),
        minZoom: 5, maxZoom: 19,
        dragRotate: false, pitchWithRotate: false,
        renderWorldCopies: false,
        locale: { 'Map.Title': 'Chọn vị trí lô đất', 'Marker.Title': 'Vị trí lô đất',
          'NavigationControl.ZoomIn': 'Phóng to', 'NavigationControl.ZoomOut': 'Thu nhỏ',
          'AttributionControl.ToggleAttribution': 'Nguồn bản đồ' }
      });
      map.current = instance;
      instance.addControl(new M.NavigationControl({ showCompass: false }), 'top-left');
      instance.touchZoomRotate.disableRotation();
      instance.on('sourcedata', event => {
        if (event.sourceId === 'openmaptiles' && event.coord) hasVectorData = true;
      });
      instance.on('idle', () => {
        if (disposed || !hasVectorData || !instance.isStyleLoaded()) return;
        loaded = true;
        clearTimeout(loadTimeout);
        setReady(true); setError('');
      });
      instance.on('error', () => { if (!disposed) setError('Chưa tải đủ nền bản đồ. Anh thử tải lại.'); });
      marker.current = new M.Marker({ color: '#8CC7AE' });
      if (start) marker.current.setLngLat([start.lng, start.lat]).addTo(instance);
      instance.on('click', ({ lngLat }) => choose(lngLat));
    }).catch(() => { if (!disposed) setError('Chưa mở được bản đồ. Anh có thể nhập tọa độ trong ô Tìm vị trí.'); });
    return () => { disposed = true; clearTimeout(loadTimeout); marker.current?.remove(); map.current?.remove(); map.current = null; marker.current = null; };
  }, [attempt, choose]);

  const findLocation = async () => {
    if (searchRequest.current) return;
    const query = input.trim();
    const point = parseCoordinatePair(query);
    if (point) { choose(point, true); return; }
    if (/^[\d+\-.,;()\s]+$/.test(query)) {
      setSearch({ kind: 'error', text: 'Anh nhập hai số vĩ độ và kinh độ, ví dụ 21.0285, 105.8542.' });
      return;
    }
    if (query.length < 2) {
      setSearch({ kind: 'error', text: 'Anh nhập tên khu vực, địa chỉ hoặc tọa độ.' });
      return;
    }

    const request = new AbortController();
    searchRequest.current = request;
    setSearch({ kind: 'loading' });
    const timeout = setTimeout(() => request.abort(), 16000);
    try {
      const locations = await findLandLocations(query, request.signal);
      if (searchRequest.current !== request) return;
      setSearch(locations.length ? { kind: 'results', locations } :
        { kind: 'message', text: 'Chưa thấy địa chỉ này. Anh thử thêm tên phường, xã hoặc tỉnh, thành.' });
    } catch {
      if (searchRequest.current !== request) return;
      setSearch({ kind: 'error', text: request.signal.aborted ? 'Tìm địa chỉ mất nhiều thời gian. Anh thử lại.' :
        'Chưa tìm được địa chỉ lúc này. Anh thử lại hoặc nhập tọa độ.' });
    } finally {
      clearTimeout(timeout);
      if (searchRequest.current === request) searchRequest.current = null;
    }
  };

  return <div className="space-y-2">
    <label htmlFor="land-location-search" className="block text-sm font-semibold text-[#F2F5F5]">Tìm vị trí</label>
    <div className="flex items-center gap-2">
      <input id="land-location-search" className={inputStyle + ' min-w-0'} value={input} maxLength={250}
        placeholder="Địa chỉ, khu vực hoặc tọa độ" enterKeyHint="search" aria-describedby="land-location-help"
        onChange={event => { cancelSearch(); setInput(event.target.value); setSearch(null); }}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.currentTarget.blur();
          void findLocation();
        }} />
      <button type="button" className={buttonStyle + ' shrink-0'} disabled={search?.kind === 'loading'} onClick={() => void findLocation()}>Tìm</button>
    </div>
    <p id="land-location-help" className="text-xs text-[#BFD0D3]">Ví dụ Nhà Bè, TP.HCM hoặc 21.0285, 105.8542.</p>
    {search?.kind === 'loading' && <p role="status" className="text-xs text-[#BFD0D3]">Đang tìm địa chỉ…</p>}
    {search?.kind === 'error' && <p role="alert" className="text-sm text-[#E99191]">{search.text}</p>}
    {search?.kind === 'message' && <p role="status" className="text-xs text-[#BFD0D3]">{search.text}</p>}
    {search?.kind === 'results' && <>
      <p role="status" className="text-xs text-[#BFD0D3]">Chọn một kết quả để mở trên bản đồ.</p>
      <ul aria-label="Kết quả tìm vị trí" className="max-h-44 space-y-2 overflow-y-auto">
        {search.locations.map(location => <li key={location.lat + ',' + location.lng + ',' + location.label}>
          <button type="button" className={buttonStyle + ' flex w-full items-center gap-2 py-2 text-left'}
            onClick={() => {
              showOnMap(location, location.zoom);
              setSearch({ kind: 'message', text: 'Đang xem ' + location.label + '.' });
            }}><MapPin size={16} className="shrink-0 text-[#8CC7AE]" aria-hidden="true" />{location.label}</button>
        </li>)}
      </ul>
      <p className="text-[11px] text-[#BFD0D3]">Dữ liệu địa chỉ từ <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">OpenStreetMap</a>.</p>
    </>}
    <div ref={host} role="region" aria-label="Bản đồ chọn vị trí lô đất" className="qltc-land-map isolate h-[260px] w-full overflow-hidden rounded-xl border border-[#8BA5AA]/25 bg-[#20292B]" />
    {error ? <p role="status" className="text-xs text-[#DEB48A]">{error}</p> : ready ?
      <p className="text-xs text-[#BFD0D3]">Chạm vào lô đất để đặt ghim.</p> :
      <p role="status" className="text-xs text-[#BFD0D3]">Đang mở bản đồ…</p>}
    <div className="flex flex-wrap gap-2">
      {error && <button type="button" className={buttonStyle} onClick={() => setAttempt(value => value + 1)}>Tải lại nền bản đồ</button>}
      <button type="button" className={buttonStyle} disabled={!ready} onClick={() => { const center = map.current?.getCenter(); if (center) choose(center); }}>Ghim tâm bản đồ</button>
      <button type="button" className={buttonStyle} disabled={!ready} onClick={() => { showOnMap({ lng: 108.2, lat: 16.05 }, 6); setSearch(null); cancelSearch(); }}>Về bản đồ Việt Nam</button>
    </div>
  </div>;
}

function LandComparisonList({ rows, money }: { rows: LandComparison[]; money: (value: number) => string }) {
  return <ul className="space-y-2 text-xs text-[#BFD0D3]">{rows.map((row, index) => <li key={`${row.source}-${index}`} className="space-y-1 border-t border-[#8BA5AA]/20 pt-2">
    {row.url ? <a className="text-[#8CC7AE] underline" href={row.url} target="_blank" rel="noreferrer">{row.title}</a> : <p>{row.title}</p>}
    <p>{row.area.toLocaleString('vi-VN')} m² · <span className="font-semibold text-[#F2F5F5]">{money(row.perM2)} / m²</span>{row.distanceM !== null ? ` · cách ${row.distanceM.toLocaleString('vi-VN')} m` : ''}</p>
    <p>{row.source}{row.observedOn && ` · Ghi nhận ${row.observedOn.split('-').reverse().join('/')}`}</p>
  </li>)}</ul>;
}

export function LandSurveyFields({ details, area, privacyMode, onChange, onApply }: {
  details: LandDetails | null;
  area: number;
  privacyMode: boolean;
  onChange: (details: LandDetails) => void;
  onApply: (valuation: LandValuation) => void;
}) {
  const [mapOpen, setMapOpen] = useState(false);
  const [radiusKm, setRadiusKm] = useState(2);
  const [result, setResult] = useState<{ key: string; survey?: LandSurvey; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const query = details ? { lat: details.lat, lng: details.lng, area, radiusKm, landUse: details.landUse, access: details.access, allowRegion: true } : null;
  const key = JSON.stringify(query);
  const current = result?.key === key ? result : null;
  const money = (value: number) => formatPrivacyVND(value, privacyMode);
  useEffect(() => () => controller.current?.abort(), []);

  const survey = async () => {
    if (!query || loading || !Number.isFinite(area) || area <= 0 || area > 10_000_000) return;
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 26000);
    setLoading(true); setResult(null);
    try {
      const data = await apiRequestJson<LandSurvey>(`${API_BASE}/land/survey`, { method: 'POST', body: query, signal: request.signal });
      if (!Array.isArray(data?.comparisons) || !Number.isSafeInteger(data.sampleCount)) throw new Error('Chưa đọc được kết quả khảo giá.');
      setResult({ key, survey: data });
    } catch (error) {
      setResult({ key, error: request.signal.aborted ? 'Khảo giá mất nhiều thời gian. Anh thử lại.' : error instanceof Error ? error.message : 'Chưa lấy được giá.' });
    } finally { clearTimeout(timeout); setLoading(false); }
  };

  return <section aria-label="Vị trí và khảo giá đất" className="space-y-3 rounded-2xl border border-[#8BA5AA]/20 bg-[#161C1E] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-[#F2F5F5]"><MapPin size={16} aria-hidden="true" /> Vị trí lô đất</p>
      <button type="button" className={buttonStyle} aria-expanded={mapOpen} onClick={() => setMapOpen(open => !open)}>{mapOpen ? 'Đóng bản đồ' : details ? 'Chọn lại vị trí' : 'Chọn trên bản đồ'}</button>
    </div>
    {mapOpen && <LandMap position={details} onPick={point => {
      if (details?.lat === point.lat && details.lng === point.lng) return;
      onChange({ ...point, address: details?.address ?? '', parcel: details?.parcel ?? '', landUse: details?.landUse ?? null, access: details?.access ?? null, valuation: null });
    }} />}
    {details ? <>
      <p className="text-xs text-[#8CC7AE]">Đã ghim {details.lat.toFixed(5)}, {details.lng.toFixed(5)}</p>
      <label className="block text-xs text-[#BFD0D3]">Địa chỉ anh ghi chú<input className={inputStyle} maxLength={250} value={details.address} onChange={e => onChange({ ...details, address: e.target.value })} /></label>
      <label className="block text-xs text-[#BFD0D3]">Số thửa / tờ bản đồ (nếu có)<input className={inputStyle} maxLength={100} value={details.parcel} onChange={e => onChange({ ...details, parcel: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-[#BFD0D3]">Loại đất<select className={inputStyle} value={details.landUse ?? ''} onChange={e => onChange({ ...details, landUse: (e.target.value || null) as LandDetails['landUse'], valuation: null })}>
          <option value="">Chưa lọc</option><option value="residential">Đất ở</option><option value="agricultural">Nông nghiệp</option><option value="mixed">Hỗn hợp</option>
        </select></label>
        <label className="text-xs text-[#BFD0D3]">Lối vào<select className={inputStyle} value={details.access ?? ''} onChange={e => onChange({ ...details, access: (e.target.value || null) as LandDetails['access'], valuation: null })}>
          <option value="">Chưa lọc</option><option value="frontage">Mặt tiền</option><option value="alley">Hẻm / ngõ</option>
        </select></label>
      </div>
      <div className="grid grid-cols-[1fr_1.3fr] items-end gap-2">
        <label className="text-xs text-[#BFD0D3]">Bán kính<select className={inputStyle} value={radiusKm} onChange={e => setRadiusKm(Number(e.target.value))}><option value="1">1 km</option><option value="2">2 km</option><option value="5">5 km</option></select></label>
        <button type="button" className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#8CC7AE] px-3 text-sm font-bold text-[#0E1314] active:bg-[#B2DEC9] disabled:opacity-50"
          disabled={loading || !Number.isFinite(area) || area <= 0 || area > 10_000_000} onClick={() => void survey()}><Search size={16} aria-hidden="true" />{loading ? 'Đang khảo giá…' : 'Khảo giá ngay'}</button>
      </div>
      {(!area || area < 0) && <p className="text-xs text-[#BFD0D3]">Anh nhập diện tích theo m² để khảo giá.</p>}
      {current?.error && <p role="alert" className="text-sm text-[#DEB48A]">{current.error}</p>}
      {current?.survey && <div aria-live="polite" className="space-y-2 rounded-xl border border-[#8CC7AE]/25 bg-[#8CC7AE]/10 p-3">
        <p className="text-sm font-semibold text-[#D5E1E3]">Giá chào bán · DuLieu.dev</p>
        {current.survey.scope && <p className="text-xs text-[#DEB48A]">Khảo giá theo {current.survey.scope === 'ward' ? 'phường/xã' : 'quận/huyện'} {current.survey.locationLabel}. Nguồn chưa xác minh được khoảng cách từng tin tới ghim.</p>}
        {current.survey.valuation ? <>
          <p className="text-sm text-[#F2F5F5]">{money(current.survey.valuation.lowPerM2)} – {money(current.survey.valuation.highPerM2)} / m²</p>
          <p className="text-sm text-[#F2F5F5]">Cả lô {money(Math.round(area * current.survey.valuation.lowPerM2))} – {money(Math.round(area * current.survey.valuation.highPerM2))}</p>
          <p className="text-xs text-[#BFD0D3]">{current.survey.sampleCount} mẫu {current.survey.scope ? 'cùng khu vực' : `trong ${radiusKm} km`}. Lấy lúc {new Date(current.survey.valuation.surveyedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.</p>
          <p className="text-xs text-[#BFD0D3]">{current.survey.valuation.newestSampleOn ? `Ngày mẫu mới nhất ${current.survey.valuation.newestSampleOn.split('-').reverse().join('/')}.` : 'Nguồn chưa cung cấp ngày của mẫu.'}</p>
          <button type="button" className={`${buttonStyle} w-full`} onClick={() => { if (current.survey?.valuation) onApply(current.survey.valuation); }}>Dùng giá giữa {money(current.survey.valuation.medianPerM2)} / m²</button>
        </> : <p className="text-sm text-[#DEB48A]">{current.survey.sampleCount === 0
          ? 'Chưa tìm thấy tin bán phù hợp với diện tích và bộ lọc đã chọn.'
          : `Tìm được ${current.survey.sampleCount} mẫu phù hợp. Cần ít nhất 3 mẫu để gợi ý giá.`}</p>}
        {current.survey.comparisons.length > 0 && <details open={!current.survey.valuation} className="text-xs text-[#BFD0D3]"><summary className="min-h-9 cursor-pointer">Xem các lô so sánh</summary>
          <LandComparisonList rows={current.survey.comparisons} money={money} />
        </details>}
        {current.survey.reference && <section aria-label="Giá rao tham khảo" className="space-y-2 rounded-xl border border-[#8BA5AA]/25 bg-[#161C1E] p-3">
          <p className="text-sm font-semibold text-[#F2F5F5]">Giá rao tham khảo</p>
          <p className="text-xs text-[#BFD0D3]">Phạm vi {current.survey.reference.scope === 'ward' ? 'phường/xã' : 'quận/huyện'} {current.survey.reference.locationLabel}. Các tin có thể khác diện tích, loại đất hoặc lối vào anh chọn.</p>
          <LandComparisonList rows={current.survey.reference.comparisons} money={money} />
        </section>}
      </div>}
    </> : <p className="text-xs text-[#BFD0D3]">Ghim vị trí để khảo giá các lô gần đó.</p>}
  </section>;
}
