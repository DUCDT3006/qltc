/** Returns null when the server response does not contain a collection, preserving cache on malformed responses. */
export function readServerCollection<T>(payload: unknown, key: string, map: (item: any) => T): T[] | null {
  if (!payload || typeof payload !== 'object' || !(key in payload)) return null;
  const collection = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(collection)) return null;
  return collection.map(map);
}
