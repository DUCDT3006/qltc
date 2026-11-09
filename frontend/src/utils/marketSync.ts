/** Only an explicit server-reported update counts as a successful price refresh. */
export function hasVerifiedPriceUpdates(response: unknown): boolean {
  if (!response || typeof response !== 'object') return false;
  const updated = (response as { updated?: unknown }).updated;
  return Boolean(updated && typeof updated === 'object' && Object.keys(updated).length > 0);
}
