// Centralized API Client & Offline Draft Queue for QLTC V2 (V2-01, V2-02, V2-07)

export const API_BASE = '/api';
const DRAFT_OUTBOX_KEY = 'qltc_draft_outbox_v2';

export interface DraftMutation {
  id?: string;
  operationId: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'DELETE';
  payload: any;
  createdAt: string;
  status?: string;
  lastError?: string;
}

export function getAuthToken(): string {
  try { localStorage.removeItem('qltc_owner_token'); } catch { /* storage may be unavailable */ }
  return '';
}

export function isTrustedApiUrl(input: string | URL): boolean {
  try {
    const fallbackOrigin = typeof window === 'undefined' ? 'https://qltc-app.dtd-store.workers.dev' : window.location.origin;
    const base = new URL(API_BASE, fallbackOrigin);
    const url = new URL(String(input), fallbackOrigin);
    return url.origin === base.origin && (url.pathname === base.pathname || url.pathname.startsWith(base.pathname + '/'));
  } catch { return false; }
}

export function setAuthToken(token: string) {
  // Compatibility shim for old callers; browser owner auth now uses an HttpOnly cookie.
  try { localStorage.removeItem('qltc_owner_token'); } catch { /* storage may be unavailable */ }
}

export function generateOperationId(prefix = 'op'): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function getDraftOutbox(): DraftMutation[] {
  try {
    const raw = localStorage.getItem(DRAFT_OUTBOX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveDraftToOutbox(draft: DraftMutation): boolean {
  try {
    const current = getDraftOutbox().filter((d) => d.operationId !== draft.operationId);
    current.push(draft);
    localStorage.setItem(DRAFT_OUTBOX_KEY, JSON.stringify(current));
    return true;
  } catch {
    return false;
  }
}

let replayInFlight: Promise<number> | null = null;
export function replayDraftOutbox(): Promise<number> {
  if (replayInFlight) return replayInFlight;
  replayInFlight = (async () => {
    let completed = 0;
    for (const draft of getDraftOutbox().sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      // Only creation drafts can be safely replayed. Destructive operations require fresh user intent.
      if (draft.method !== 'POST' || draft.endpoint !== '/transactions' || !draft.operationId) continue;
      try {
        await apiRequestJson(`${API_BASE}${draft.endpoint}`, {
          method: 'POST', body: draft.payload, operationId: draft.operationId
        });
        removeDraftFromOutbox(draft.operationId);
        completed++;
      } catch (err) {
        const lastError = err instanceof Error ? err.message : 'Không đồng bộ được';
        saveDraftToOutbox({ ...draft, status: 'draft', lastError });
        // Keep order: later mutations must not jump ahead of an unresolved draft.
        break;
      }
    }
    return completed;
  })().finally(() => { replayInFlight = null; });
  return replayInFlight;
}

export function removeDraftFromOutbox(operationId: string) {
  try {
    const current = getDraftOutbox().filter((d) => d.operationId !== operationId);
    localStorage.setItem(DRAFT_OUTBOX_KEY, JSON.stringify(current));
  } catch {
    // ignore
  }
}

export class ApiRequestError extends Error {
  status: number;
  code: string;
  details?: any;

  constructor(message: string, status: number, code = 'API_ERROR', details?: any) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type AuthSessionCheck = 'signedIn' | 'signedOut' | 'unavailable';

/** Check the cookie-backed session without treating server/network failures as sign-out. */
export async function checkAuthSession(
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AuthSessionCheck> {
  const response = await fetchImpl(`${API_BASE}/auth/session`, {
    credentials: 'same-origin',
    redirect: 'error',
    signal
  });
  if (response.ok) return 'signedIn';
  if (response.status === 401 || response.status === 403) return 'signedOut';
  return 'unavailable';
}

export type TimedAuthSessionCheck = AuthSessionCheck | 'timeout';

/** Start a bounded session check; its timer and request are both cancelled on cleanup. */
export function checkAuthSessionWithTimeout(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10000
): { promise: Promise<TimedAuthSessionCheck>; cancel: () => void } {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let settled = false;
  let resolveResult!: (result: TimedAuthSessionCheck) => void;

  const promise = new Promise<TimedAuthSessionCheck>(resolve => {
    resolveResult = resolve;
  }).finally(() => clearTimeout(timer));

  timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    controller.abort();
    resolveResult('timeout');
  }, timeoutMs);

  checkAuthSession(fetchImpl, controller.signal).then(result => {
    if (settled) return;
    settled = true;
    resolveResult(result);
  }).catch(() => {
    if (settled) return;
    settled = true;
    resolveResult('unavailable');
  });

  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        controller.abort();
        resolveResult('unavailable');
      }
      clearTimeout(timer);
    }
  };
}

/**
 * Wrapper that keeps API requests same-origin so browser cookies are sent first-party.
 */
let isFetchPatched = false;
export function installAuthenticatedFetchInterceptor() {
  if (isFetchPatched || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (isTrustedApiUrl(urlStr)) {
      const headers = new Headers(input instanceof Request ? input.headers : undefined);
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      return originalFetch(input, { ...init, headers, credentials: 'same-origin', redirect: 'error' });
    }
    return originalFetch(input, init);
  };

  isFetchPatched = true;
}

/**
 * Performs an authenticated JSON API call and strictly validates `res.ok` before resolving.
 * Never resolves as success on HTTP 4xx/5xx or network failure (V2-07).
 */
export async function apiRequestJson<T = any>(
  url: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: any;
    operationId?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<T> {
  const method = options.method || 'GET';
  if (!isTrustedApiUrl(url)) throw new ApiRequestError('API URL không được phép', 0, 'UNTRUSTED_API_URL');
  const headers: Record<string, string> = {
    ...(options.headers || {})
  };

  if (options.operationId) {
    headers['X-Operation-Id'] = options.operationId;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    credentials: 'same-origin',
    redirect: 'error',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const errMsg = data?.error || data?.message || `Lỗi máy chủ (HTTP ${res.status})`;
    const errCode = data?.code || (res.status === 401 ? 'UNAUTHORIZED' : res.status === 409 ? 'CONFLICT' : 'API_ERROR');
    throw new ApiRequestError(errMsg, res.status, errCode, data);
  }

  return data as T;
}

export async function fetchAllTransactions<T = any>(): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | null = null;
  let dataRevision: string | number | null = null;
  let expectedCount: number | null = null;
  for (;;) {
    const query = new URLSearchParams({ limit: '500' });
    if (cursor) query.set('cursor', cursor);
    let page: {
      transactions: T[];
      pagination: { totalCount: number; hasMore: boolean; nextCursor: string | null; dataRevision: string | number };
    };
    try {
      page = await apiRequestJson(`${API_BASE}/transactions?${query.toString()}`);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'STALE_CURSOR') {
        throw new Error('Lịch sử vừa thay đổi trong lúc tải. Hãy tải lại để xem dữ liệu mới nhất.');
      }
      throw err;
    }
    if (!Array.isArray(page.transactions) || !page.pagination) throw new Error('Trang lịch sử không hợp lệ');
    if (expectedCount === null) expectedCount = page.pagination.totalCount;
    if (dataRevision === null) dataRevision = page.pagination.dataRevision;
    if (dataRevision === undefined || dataRevision === null || page.pagination.dataRevision !== dataRevision) {
      throw new Error('Lịch sử vừa thay đổi trong lúc tải. Hãy tải lại để xem dữ liệu mới nhất.');
    }
    if (page.pagination.totalCount !== expectedCount) {
      throw new Error('Lịch sử vừa thay đổi trong lúc tải. Hãy tải lại để xem dữ liệu mới nhất.');
    }
    all.push(...page.transactions);
    if (!page.pagination.hasMore) {
      if (all.length !== expectedCount) throw new Error('Lịch sử chưa tải đủ');
      return all;
    }
    if (typeof page.pagination.nextCursor !== 'string' || !page.pagination.nextCursor) throw new Error('Máy chủ trả cursor lịch sử không hợp lệ');
    cursor = page.pagination.nextCursor;
  }
}
