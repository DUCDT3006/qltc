export type SummaryRequestState = 'loading' | 'loaded' | 'error';

export interface PlannedValueResolution {
  amount: number | null;
  source: 'server' | 'local-unsynced' | 'none';
}

export function resolvePlannedValue(
  serverValue: number | null | undefined,
  state: SummaryRequestState,
  localCurrentPeriodValue: number,
  canUseCurrentPeriodFallback: boolean
): PlannedValueResolution {
  if (state === 'loaded') {
    return typeof serverValue === 'number' && Number.isFinite(serverValue)
      ? { amount: serverValue, source: 'server' }
      : { amount: null, source: 'none' };
  }
  if (state === 'error' && canUseCurrentPeriodFallback) {
    return { amount: localCurrentPeriodValue, source: 'local-unsynced' };
  }
  return { amount: null, source: 'none' };
}
