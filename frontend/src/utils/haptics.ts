type HapticWindow = {
  AndroidBridge?: {
    triggerLightHaptic?: () => void;
  };
  navigator?: {
    vibrate?: (pattern: number | number[]) => boolean;
  };
};

export function triggerLightHaptic(
  targetWindow: HapticWindow | undefined = typeof window !== 'undefined' ? (window as HapticWindow) : undefined
): boolean {
  if (!targetWindow) return false;
  try {
    if (typeof targetWindow.AndroidBridge?.triggerLightHaptic === 'function') {
      targetWindow.AndroidBridge.triggerLightHaptic();
      return true;
    }
  } catch {
    // Fall back to the Web Vibration API when native bridge invocation fails.
  }

  try {
    const vibrate = targetWindow.navigator?.vibrate;
    if (typeof vibrate === 'function') {
      return Boolean(vibrate.call(targetWindow.navigator, 18));
    }
  } catch {
    return false;
  }

  return false;
}
