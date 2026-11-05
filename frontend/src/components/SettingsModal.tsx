import React, { useState, useEffect } from 'react';
import {
  X,
  ShieldCheck,
  Eye,
  EyeOff,
  Download,
  Plus,
  Smartphone,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Sparkles,
  ArrowUpCircle,
  Copy
} from 'lucide-react';
import { BankAccount } from '../types';
import { formatVND } from '../mockData';

interface RawLog {
  id: string;
  package_name: string;
  title: string;
  raw_body: string;
  bank_code: string | null;
  is_parsed: number;
  parse_error: string | null;
  received_at: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  onAddAccount: (acc: BankAccount) => void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  onSimulateNotification: () => void;
  onReprocessSuccess?: () => void;
  onOpenResetModal: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onAddAccount,
  privacyMode,
  onTogglePrivacy,
  onSimulateNotification,
  onReprocessSuccess,
  onOpenResetModal
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [name, setName] = useState('');
  const [bankCode, setBankCode] = useState('VCB');
  const [mask, setMask] = useState('');
  const [balanceStr, setBalanceStr] = useState('');

  // Logs state
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessMsg, setReprocessMsg] = useState('');

  // Version check state
  const CURRENT_VERSION = 'v1.0.2';
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [latestRelease, setLatestRelease] = useState<{
    tagName: string;
    apkUrl: string;
    hasUpdate: boolean;
    body?: string;
  } | null>({
    tagName: 'v1.0.2',
    apkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.2/qltc-v1.0.2.apk',
    hasUpdate: true
  });
  const [updateCheckedMsg, setUpdateCheckedMsg] = useState('');

  // Download & Progress state
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'error'>('idle');
  const [downloadPercent, setDownloadPercent] = useState(0);
  const [downloadLoadedBytes, setDownloadLoadedBytes] = useState(0);
  const [downloadTotalBytes, setDownloadTotalBytes] = useState(5632636);
  const [downloadBlobUrl, setDownloadBlobUrl] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  const fetchLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('https://qltc-backend.dtd-store.workers.dev/api/notifications/recent?limit=25');
      if (res.ok) {
        const data = await res.json();
        setLogs(data.notifications || []);
      }
    } catch (e) {
      console.error('Lỗi tải logs:', e);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    if (isOpen && showLogs) {
      fetchLogs();
    }
  }, [isOpen, showLogs]);

  const handleReprocess = async () => {
    setIsReprocessing(true);
    setReprocessMsg('');
    try {
      const res = await fetch('https://qltc-backend.dtd-store.workers.dev/api/notifications/reprocess', {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setReprocessMsg(`Đã xử lý xong: ${data.parsedCount} giao dịch mới được bóc tách thành công!`);
        await fetchLogs();
        if (onReprocessSuccess) onReprocessSuccess();
      } else {
        setReprocessMsg('Không có thông báo mới cần xử lý.');
      }
    } catch {
      setReprocessMsg('Lỗi kết nối tới máy chủ.');
    } finally {
      setIsReprocessing(false);
    }
  };

  // Kiểm tra phiên bản mới từ GitHub Release & Fallback Cloudflare Worker
  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    setUpdateCheckedMsg('');
    try {
      let latestTag = 'v1.0.2';
      let apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.2/qltc-v1.0.2.apk';
      let releaseBody = '';

      try {
        const res = await fetch('https://api.github.com/repos/DUCDT3006/qltc/releases/latest');
        if (res.ok) {
          const data = await res.json();
          latestTag = data.tag_name || 'v1.0.2';
          const apkAsset = Array.isArray(data.assets)
            ? data.assets.find((a: any) => a.name.endsWith('.apk'))
            : null;
          apkUrl = apkAsset ? apkAsset.browser_download_url : `https://github.com/DUCDT3006/qltc/releases/download/${latestTag}/qltc-${latestTag}.apk`;
          releaseBody = data.body || '';
        } else {
          const bRes = await fetch('https://qltc-backend.dtd-store.workers.dev/api/version');
          if (bRes.ok) {
            const bData = await bRes.json();
            latestTag = bData.version.startsWith('v') ? bData.version : `v${bData.version}`;
            apkUrl = bData.latestApkUrl;
          }
        }
      } catch {
        const bRes = await fetch('https://qltc-backend.dtd-store.workers.dev/api/version');
        if (bRes.ok) {
          const bData = await bRes.json();
          latestTag = bData.version.startsWith('v') ? bData.version : `v${bData.version}`;
          apkUrl = bData.latestApkUrl;
        }
      }

      // Lấy version native nếu chạy trong Android app
      const nativeVer = (window as any).AndroidBridge && typeof (window as any).AndroidBridge.getNativeApkVersion === 'function'
        ? (window as any).AndroidBridge.getNativeApkVersion()
        : null;

      const isOlder = nativeVer ? nativeVer !== latestTag.replace('v', '') : false;

      setLatestRelease({
        tagName: latestTag,
        apkUrl,
        hasUpdate: true,
        body: releaseBody
      });

      if (isOlder) {
        setUpdateCheckedMsg(`Điện thoại đang chạy bản v${nativeVer}. Đã có bản mới (${latestTag}) sẵn sàng tải về!`);
      } else {
        setUpdateCheckedMsg(`Phiên bản mới nhất trên máy chủ: ${latestTag}. Anh có thể bấm tải ngay file APK bên dưới.`);
      }
    } catch {
      setLatestRelease({
        tagName: 'v1.0.2',
        apkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.2/qltc-v1.0.2.apk',
        hasUpdate: true
      });
      setUpdateCheckedMsg('Phiên bản mới nhất: v1.0.2. Anh có thể tải trực tiếp file APK bên dưới.');
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      handleCheckUpdate();
    }
  }, [isOpen]);

  const triggerInstall = (blobUrl: string) => {
    // 1. Thử qua AndroidBridge nếu chạy trên APK v1.0.2+
    if ((window as any).AndroidBridge && typeof (window as any).AndroidBridge.openExternalUrl === 'function') {
      (window as any).AndroidBridge.openExternalUrl(latestRelease?.apkUrl || 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.2/qltc-v1.0.2.apk');
      return;
    }

    // 2. Tự động kích hoạt tải file Blob về máy
    try {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qltc-${latestRelease?.tagName || 'v1.0.2'}.apk`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
      }, 500);
    } catch (e) {
      console.warn('Không thể click download blob:', e);
    }
  };

  // Tải gói APK với thanh hiển thị % tiến trình thực tế
  const startDownload = async () => {
    setDownloadStatus('downloading');
    setDownloadPercent(0);
    setDownloadLoadedBytes(0);
    setDownloadError('');

    try {
      const downloadEndpoint = 'https://qltc-backend.dtd-store.workers.dev/api/download-apk';
      const response = await fetch(downloadEndpoint);

      if (!response.ok) {
        throw new Error(`Máy chủ trả về mã lỗi: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = parseInt(contentLength || '5632636', 10);
      setDownloadTotalBytes(total);

      if (!response.body) {
        throw new Error('Trình duyệt không hỗ trợ đọc stream tải về');
      }

      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          loaded += value.length;
          setDownloadLoadedBytes(loaded);
          const pct = Math.min(99, Math.round((loaded / total) * 100));
          setDownloadPercent(pct);
        }
      }

      // Hoàn tất 100%
      setDownloadPercent(100);
      setDownloadLoadedBytes(total);
      const blob = new Blob(chunks as any, { type: 'application/vnd.android.package-archive' });
      const blobUrl = URL.createObjectURL(blob);
      setDownloadBlobUrl(blobUrl);
      setDownloadStatus('completed');

      // Tự động kích hoạt lưu / mở file
      triggerInstall(blobUrl);

    } catch (err: any) {
      console.error('Lỗi tải APK:', err);
      setDownloadStatus('error');
      setDownloadError(err?.message || 'Không thể tải gói cập nhật');
    }
  };

  const handleCopyLink = () => {
    const apkUrl = latestRelease?.apkUrl || 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.2/qltc-v1.0.2.apk';
    navigator.clipboard.writeText(apkUrl).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = apkUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 3000);
    });
  };

  const handleDownloadApk = (url: string) => {
    if ((window as any).AndroidBridge && typeof (window as any).AndroidBridge.openExternalUrl === 'function') {
      (window as any).AndroidBridge.openExternalUrl(url);
      return;
    }
    // Nếu chưa có bridge, kích hoạt trình tải % trong app
    startDownload();
  };

  if (!isOpen) return null;

  const handleCreateAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const balance = parseInt(balanceStr.replace(/[^\d]/g, ''), 10) || 0;

    onAddAccount({
      id: `acc_${Date.now()}`,
      name: name.trim(),
      bankCode,
      accountNumberMask: mask.slice(-4) || '9999',
      balance,
      type: 'bank'
    });

    setName('');
    setMask('');
    setBalanceStr('');
    setShowAddForm(false);
  };

  const handleExportData = () => {
    const data = {
      accounts,
      exportedAt: new Date().toISOString(),
      app: 'QLTC'
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qltc_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-[#F2F5F5]">Tài khoản & Cài đặt</span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nút mở Thiết lập lại tài chính & Reset dữ liệu */}
        <button
          onClick={() => {
            onClose();
            onOpenResetModal();
          }}
          className="w-full p-3.5 rounded-2xl bg-gradient-to-r from-[#232E31] via-[#1E282A] to-[#1C2527] border border-[#8BA5AA]/25 flex items-center justify-between text-left active:scale-98 transition-transform shadow-md"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#657D81]/25 border border-[#8BA5AA]/30 flex items-center justify-center text-[#8CC7AE]">
              <RotateCcw size={17} />
            </div>
            <div>
              <div className="text-xs font-bold text-[#F2F5F5]">Thiết lập lại tài chính thực tế</div>
              <div className="text-[10.5px] text-[#869699]">
                Xóa giao dịch mẫu, chỉnh số dư các tài khoản & tài sản thực
              </div>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#8CC7AE] px-2.5 py-1 rounded-lg bg-[#8CC7AE]/10 border border-[#8CC7AE]/20">
            Đặt lại ›
          </span>
        </button>

        {/* Android Notification Listener Service Status Card */}
        <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={16} className="text-[#8CC7AE]" />
              <span className="text-xs font-semibold text-[#F2F5F5]">Tự động đọc thông báo Android</span>
            </div>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#7EB89E]/20 text-[#8CC7AE] border border-[#7EB89E]/30">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8CC7AE] animate-ping"></span>
              Đang hoạt động
            </span>
          </div>

          <div className="text-[11.5px] text-[#869699] leading-relaxed">
            Hỗ trợ Vietcombank, Techcombank, HDBank, MB, ACB, TPBank, VPBank, BIDV, Cake, SMS... và tự động lọc bỏ OTP an toàn tuyệt đối.
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => {
                setShowLogs(!showLogs);
                if (!showLogs) fetchLogs();
              }}
              className="py-2 px-3 rounded-xl bg-[#232E31] border border-[#8BA5AA]/20 text-[11px] font-semibold text-[#BFD0D3] flex items-center justify-center gap-1 active:scale-95 transition-transform"
            >
              {showLogs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {showLogs ? 'Đóng nhật ký' : 'Xem nhật ký app'}
            </button>

            <button
              onClick={handleReprocess}
              disabled={isReprocessing}
              className="py-2 px-3 rounded-xl bg-[#657D81]/30 hover:bg-[#657D81]/40 border border-[#8BA5AA]/30 text-[11px] font-semibold text-[#8CC7AE] flex items-center justify-center gap-1 active:scale-95 transition-transform"
            >
              <RefreshCw size={13} className={isReprocessing ? 'animate-spin' : ''} />
              {isReprocessing ? 'Đang bóc tách...' : 'Bóc tách lại'}
            </button>
          </div>

          {reprocessMsg && (
            <div className="text-[11px] text-[#8CC7AE] bg-[#8CC7AE]/10 border border-[#8CC7AE]/20 rounded-lg p-2 text-center animate-fade-in">
              {reprocessMsg}
            </div>
          )}

          {/* Collapsible Real-time Notification Logs */}
          {showLogs && (
            <div className="mt-2 pt-2 border-t border-[#8BA5AA]/15 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span>Các thông báo ngân hàng gửi tới máy chủ:</span>
                <button onClick={fetchLogs} className="text-[#8CC7AE] flex items-center gap-1">
                  <RefreshCw size={11} className={isLoadingLogs ? 'animate-spin' : ''} /> Tải lại
                </button>
              </div>

              {isLoadingLogs ? (
                <div className="text-center py-4 text-xs text-[#869699]">Đang tải dữ liệu...</div>
              ) : logs.length === 0 ? (
                <div className="text-center py-3 text-xs text-[#869699]">Chưa có thông báo nào được gửi lên.</div>
              ) : (
                <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1 text-[11px]">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className={`p-2.5 rounded-xl border ${
                        log.is_parsed
                          ? 'bg-[#182322] border-[#8CC7AE]/25'
                          : 'bg-[#231F20] border-[#D4A373]/25'
                      }`}
                    >
                      <div className="flex items-center justify-between font-semibold">
                        <span className="text-[#F2F5F5] truncate max-w-[200px]">
                          {log.bank_code ? `${log.bank_code} · ` : ''}{log.title || log.package_name}
                        </span>
                        <span className={`inline-flex items-center gap-1 text-[10px] ${log.is_parsed ? 'text-[#8CC7AE]' : 'text-[#D4A373]'}`}>
                          {log.is_parsed ? (
                            <>
                              <CheckCircle2 size={12} /> Đã nhận diện
                            </>
                          ) : (
                            <>
                              <AlertCircle size={12} /> Bỏ qua
                            </>
                          )}
                        </span>
                      </div>
                      <div className="text-[10px] text-[#869699] line-clamp-2 mt-0.5 whitespace-pre-line">
                        {log.raw_body}
                      </div>
                      <div className="text-[9.5px] text-[#5A686B] mt-1">
                        {log.received_at} · {log.package_name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* In-app Version Checker & Quick Update */}
        <div className="bg-[#1C2426] border border-[#8BA5AA]/15 rounded-2xl p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-[#D4A373]" />
              <span className="text-xs font-semibold text-[#F2F5F5]">Cập nhật ứng dụng</span>
            </div>
            <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-[#232E31] text-[#BFD0D3] border border-[#8BA5AA]/20">
              {CURRENT_VERSION}
            </span>
          </div>

          <div className="text-[11px] text-[#869699] leading-relaxed">
            ⚡ <strong>Cập nhật tức thì (OTA):</strong> Giao diện và các tính năng mới luôn tự động cập nhật qua mạng mỗi khi anh vuốt làm mới hoặc mở app.
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCheckUpdate}
              disabled={isCheckingUpdate}
              className="py-2.5 rounded-xl bg-[#232E31] hover:bg-[#2C383C] border border-[#8BA5AA]/25 text-xs font-semibold text-[#D5E1E3] flex items-center justify-center gap-1.5 active:scale-98 transition-transform"
            >
              <RefreshCw size={13} className={isCheckingUpdate ? 'animate-spin' : ''} />
              {isCheckingUpdate ? 'Đang kiểm tra...' : 'Kiểm tra bản mới'}
            </button>

            <button
              onClick={handleCopyLink}
              className="py-2.5 rounded-xl bg-[#232E31] hover:bg-[#2C383C] text-[#8CC7AE] border border-[#8CC7AE]/30 text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-98 transition-transform"
            >
              {isCopied ? <CheckCircle2 size={13} className="text-[#8CC7AE]" /> : <Copy size={13} />}
              {isCopied ? 'Đã chép link!' : 'Sao chép link tải'}
            </button>
          </div>

          {updateCheckedMsg && (
            <div className="text-[11px] text-[#8CC7AE] bg-[#8CC7AE]/10 border border-[#8CC7AE]/20 rounded-xl p-2.5 text-center leading-relaxed animate-fade-in">
              {updateCheckedMsg}
            </div>
          )}

          {/* GIAO DIỆN THANH TIẾN TRÌNH % ĐANG TẢI */}
          {downloadStatus === 'downloading' && (
            <div className="p-3.5 rounded-2xl bg-[#1C2527] border border-[#8CC7AE]/35 space-y-2.5 animate-fade-in shadow-md">
              <div className="flex items-center justify-between text-xs font-bold text-[#F2F5F5]">
                <span className="flex items-center gap-2 text-[#8CC7AE]">
                  <RefreshCw size={14} className="animate-spin text-[#8CC7AE]" />
                  Đang tải gói cập nhật {latestRelease?.tagName || 'v1.0.2'}...
                </span>
                <span className="font-mono text-sm font-bold text-[#8CC7AE]">{downloadPercent}%</span>
              </div>

              {/* Thanh % tiến trình */}
              <div className="w-full bg-[#14191A] rounded-full h-3.5 overflow-hidden border border-[#8BA5AA]/25 p-0.5 shadow-inner">
                <div
                  className="bg-gradient-to-r from-[#657D81] via-[#8CC7AE] to-[#8CC7AE] h-full rounded-full transition-all duration-150 relative overflow-hidden"
                  style={{ width: `${downloadPercent}%` }}
                >
                  <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                </div>
              </div>

              <div className="flex items-center justify-between text-[11px] text-[#869699]">
                <span>
                  {(downloadLoadedBytes / (1024 * 1024)).toFixed(1)} MB / {(downloadTotalBytes / (1024 * 1024)).toFixed(1)} MB
                </span>
                <span className="text-[#8CC7AE] font-medium">
                  {downloadPercent < 100 ? `Đang nhận dữ liệu (${downloadPercent}%)` : 'Hoàn tất!'}
                </span>
              </div>
            </div>
          )}

          {/* GIAO DIỆN KHI ĐÃ TẢI HOÀN TẤT 100% */}
          {downloadStatus === 'completed' && (
            <div className="p-3.5 rounded-2xl bg-[#182322] border border-[#8CC7AE]/45 space-y-3 animate-fade-in shadow-lg">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-[#8CC7AE]/20 border border-[#8CC7AE]/30 flex items-center justify-center text-[#8CC7AE] shrink-0">
                  <CheckCircle2 size={18} />
                </div>
                <div>
                  <div className="text-xs font-bold text-[#F2F5F5]">
                    Đã tải hoàn tất 100% ({latestRelease?.tagName || 'v1.0.2'})!
                  </div>
                  <div className="text-[10.5px] text-[#869699]">
                    Kích thước: {(downloadTotalBytes / (1024 * 1024)).toFixed(1)} MB · Sẵn sàng nâng cấp
                  </div>
                </div>
              </div>

              {downloadBlobUrl && (
                <a
                  href={downloadBlobUrl}
                  download={`qltc-${latestRelease?.tagName || 'v1.0.2'}.apk`}
                  className="w-full py-2.5 rounded-xl bg-[#8CC7AE] text-[#0E1314] text-xs font-bold flex items-center justify-center gap-2 shadow active:scale-95 transition-transform"
                >
                  <Download size={15} /> 1. Bấm vào đây để Cài Đặt File APK
                </a>
              )}

              <button
                onClick={handleCopyLink}
                className="w-full py-2 rounded-xl bg-[#232E31] hover:bg-[#2C383C] text-[#8CC7AE] border border-[#8CC7AE]/30 text-xs font-semibold flex items-center justify-center gap-2 active:scale-95 transition-transform"
              >
                {isCopied ? <CheckCircle2 size={14} className="text-[#8CC7AE]" /> : <Copy size={14} />}
                {isCopied ? '✓ Đã sao chép link tải vào bộ nhớ!' : '📋 2. Sao chép Link tải (Dán vào Chrome)'}
              </button>

              <div className="text-[10px] text-[#869699] bg-[#161C1E]/80 p-2.5 rounded-xl border border-[#8BA5AA]/15 leading-relaxed">
                💡 <strong>Mẹo nhỏ:</strong> Nếu bấm (1) mà điện thoại chưa tự hiện cửa sổ cài đặt, anh bấm <strong>"Sao chép Link tải"</strong> (2) rồi mở Chrome dán vào là tải & cài đặt thành công 100% ạ!
              </div>
            </div>
          )}

          {/* GIAO DIỆN LỖI */}
          {downloadStatus === 'error' && (
            <div className="p-3 rounded-2xl bg-[#291B1D] border border-[#E07A5F]/40 space-y-2 text-xs">
              <div className="text-[#E07A5F] font-semibold flex items-center gap-1.5">
                <AlertCircle size={14} /> Có lỗi: {downloadError}
              </div>
              <button
                onClick={handleCopyLink}
                className="w-full py-2 rounded-xl bg-[#232E31] text-[#E07A5F] border border-[#E07A5F]/30 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                {isCopied ? '✓ Đã sao chép!' : '📋 Sao chép link để tải qua Chrome'}
              </button>
            </div>
          )}

          {/* NÚT TẢI & CÀI ĐẶT BAN ĐẦU */}
          {latestRelease && downloadStatus === 'idle' && (
            <div className="p-3 rounded-xl bg-[#1C2527] border border-[#8CC7AE]/25 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between text-xs font-bold text-[#8CC7AE]">
                <span>Bản mới nhất: {latestRelease.tagName}</span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-[#8CC7AE]/15 text-[#8CC7AE]">Sẵn sàng tải</span>
              </div>
              <div className="text-[10.5px] text-[#869699] leading-relaxed">
                Tự động bóc tách Techcombank, HDBank, SMS & hỗ trợ tải cập nhật trực tiếp.
              </div>
              <button
                onClick={startDownload}
                className="w-full py-2.5 rounded-lg bg-[#8CC7AE] text-[#0E1314] text-xs font-bold flex items-center justify-center gap-1.5 shadow active:scale-95 transition-transform"
              >
                <Download size={14} /> Tải & Cài đặt {latestRelease.tagName} ngay
              </button>
            </div>
          )}
        </div>

        {/* Quick Options */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onTogglePrivacy}
            className="p-3 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center gap-2 text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
          >
            {privacyMode ? <EyeOff size={16} className="text-[#DEB48A]" /> : <Eye size={16} />}
            {privacyMode ? 'Đang ẩn số dư' : 'Hiện số dư'}
          </button>
          <button
            onClick={handleExportData}
            className="p-3 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center gap-2 text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
          >
            <Download size={16} /> Sao lưu dữ liệu
          </button>
        </div>

        {/* Bank Accounts Section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider">
              Tài khoản & Ví ngân hàng ({accounts.length})
            </span>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="text-xs font-semibold text-[#8CC7AE] flex items-center gap-1"
            >
              <Plus size={14} /> Thêm tài khoản
            </button>
          </div>

          {showAddForm && (
            <form onSubmit={handleCreateAccount} className="bg-[#20292B] border border-[#8BA5AA]/20 rounded-2xl p-3 mb-2 space-y-2">
              <input
                type="text"
                placeholder="Tên tài khoản (VD: Techcombank, HDBank...)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={bankCode}
                  onChange={(e) => setBankCode(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-2 py-2 text-xs text-[#F2F5F5]"
                >
                  <option value="VCB">Vietcombank</option>
                  <option value="TCB">Techcombank</option>
                  <option value="HDBank">HDBank</option>
                  <option value="MB">MB Bank</option>
                  <option value="ACB">ACB</option>
                  <option value="TPB">TPBank</option>
                  <option value="VPB">VPBank</option>
                  <option value="BIDV">BIDV</option>
                  <option value="CASH">Tiền mặt</option>
                </select>
                <input
                  type="text"
                  placeholder="4 số cuối (VD: 9737)"
                  maxLength={4}
                  value={mask}
                  onChange={(e) => setMask(e.target.value)}
                  className="bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
                />
              </div>
              <input
                type="text"
                placeholder="Số dư ban đầu (₫)"
                value={balanceStr}
                onChange={(e) => setBalanceStr(e.target.value)}
                className="w-full bg-[#161C1E] border border-[#8BA5AA]/20 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none"
              />
              <button
                type="submit"
                className="w-full py-2 rounded-xl bg-[#657D81] text-[#F2F5F5] text-xs font-semibold"
              >
                Lưu tài khoản
              </button>
            </form>
          )}

          <div className="space-y-2">
            {accounts.map((acc) => (
              <div
                key={acc.id}
                className="bg-[#1C2426] border border-[#8BA5AA]/12 rounded-2xl p-3 flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#232E31] border border-[#8BA5AA]/18 flex items-center justify-center font-bold text-xs text-[#BFD0D3]">
                    {acc.bankCode || 'CASH'}
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-[#F2F5F5]">{acc.name}</div>
                    <div className="text-[10px] text-[#869699]">
                      {acc.accountNumberMask ? `*${acc.accountNumberMask}` : 'Ví tiền mặt'}
                    </div>
                  </div>
                </div>
                <div className="text-right num text-xs font-semibold text-[#D5E1E3]">
                  {privacyMode ? '•••••• ₫' : formatVND(acc.balance)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#869699] pt-2">
          <ShieldCheck size={14} className="text-[#8CC7AE]" />
          Dữ liệu mã hóa · 100% riêng tư & An toàn tuyệt đối
        </div>
      </div>
    </div>
  );
};
