export interface BackupPreviewCount {
  key: string;
  count: number;
}

export function getBackupPreviewCounts(data: unknown): BackupPreviewCount[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .filter(([, records]) => Array.isArray(records))
    .map(([key, records]) => ({ key, count: (records as unknown[]).length }));
}

export function isVerifiedBackupDryRun(response: any): boolean {
  return response?.dryRun === true && response?.valid === true;
}
