// Advance the revision when publishing an interface change that users should see.
export const INTERFACE_UPDATE = {
  revision: 15,
  title: 'Đổi mã chủ tài khoản',
  description: 'Anh có thể đổi mã đăng nhập chủ tài khoản trong mục Cài đặt cá nhân.'
};

export function readInstalledApkVersion(): string | null {
  if (typeof window === 'undefined') return null;
  const { AndroidBridge } = window as Window & { AndroidBridge?: { getNativeApkVersion?: () => string } };
  try {
    const version = AndroidBridge?.getNativeApkVersion?.();
    return typeof version === 'string' && /^\d+\.\d+\.\d+$/.test(version) ? version : null;
  } catch {
    return null;
  }
}
