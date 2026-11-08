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
  Copy,
  User,
  Camera,
  Mail,
  Phone,
  Edit2,
  Edit3,
  Trash2,
  Landmark,
  Settings,
  QrCode,
  Building2,
  MapPin,
  Check
} from 'lucide-react';
import { BankAccount, UserProfile } from '../types';
import { formatVND } from '../utils/financeMath';
import { CurrencyInput } from './CurrencyInput';
import { ConfirmSheet } from './ConfirmSheet';
import { BankPickerModal } from './BankPickerModal';
import { AccountQrModal } from './AccountQrModal';
import { findBankByCode, VietnamBank } from '../utils/vietnamBanks';

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
  onUpdateAccount?: (acc: BankAccount) => Promise<void> | void;
  onUpdateAccountBalance?: (
    accountId: string,
    newBalance: number,
    name?: string,
    type?: BankAccount['type']
  ) => Promise<void> | void;
  onDeleteAccount?: (accountId: string) => Promise<void> | void;
  privacyMode: boolean;
  onTogglePrivacy: () => void;
  onSimulateNotification?: (notif?: any) => void | Promise<void>;
  onReprocessSuccess?: () => void;
  onOpenResetModal: () => void;
  userProfile: UserProfile;
  onUpdateUserProfile: (updated: Partial<UserProfile>) => void | Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  accounts,
  onAddAccount,
  onUpdateAccount,
  onUpdateAccountBalance,
  onDeleteAccount,
  privacyMode,
  onTogglePrivacy,
  onSimulateNotification,
  onReprocessSuccess,
  onOpenResetModal,
  userProfile,
  onUpdateUserProfile
}) => {
  // Account Form & Management State
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [isBankPickerOpen, setIsBankPickerOpen] = useState(false);
  const [qrModalAccount, setQrModalAccount] = useState<BankAccount | null>(null);
  const [copiedAccountId, setCopiedAccountId] = useState<string | null>(null);

  // Form inputs
  const [accName, setAccName] = useState('');
  const [accBankCode, setAccBankCode] = useState('VCB');
  const [accBankBin, setAccBankBin] = useState('970436');
  const [accNumber, setAccNumber] = useState('');
  const [accHolder, setAccHolder] = useState('');
  const [accBranch, setAccBranch] = useState('');
  const [accType, setAccType] = useState<BankAccount['type']>('bank');
  const [accBalance, setAccBalance] = useState<number>(0);
  const [accFormError, setAccFormError] = useState('');

  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [editingAccBalance, setEditingAccBalance] = useState<number>(0);
  const [confirmDeleteAcc, setConfirmDeleteAcc] = useState<BankAccount | null>(null);

  // Profile edit state
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState(userProfile?.name || 'Anh Đức');
  const [profileEmail, setProfileEmail] = useState(userProfile?.email || '');
  const [profilePhone, setProfilePhone] = useState(userProfile?.phone || '');
  const [profileAvatar, setProfileAvatar] = useState(userProfile?.avatar || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSaveSuccess, setProfileSaveSuccess] = useState(false);

  useEffect(() => {
    if (userProfile) {
      setProfileName(userProfile.name || 'Anh Đức');
      setProfileEmail(userProfile.email || '');
      setProfilePhone(userProfile.phone || '');
      setProfileAvatar(userProfile.avatar || '');
    }
  }, [userProfile, isOpen]);

  // Xử lý nén và chọn ảnh avatar từ điện thoại / máy tính
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 250;
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxDim) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          }
        } else {
          if (height > maxDim) {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          setProfileAvatar(dataUrl);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Tạo avatar từ icon preset phong cách sang trọng
  const handleSelectPresetAvatar = (emoji: string) => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 128, 128);
      grad.addColorStop(0, '#3E4F52');
      grad.addColorStop(1, '#1C2426');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(64, 64, 64, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = '64px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, 64, 70);
      setProfileAvatar(canvas.toDataURL('image/png'));
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    try {
      await onUpdateUserProfile({
        name: profileName.trim() || 'Anh Đức',
        email: profileEmail.trim(),
        phone: profilePhone.trim(),
        avatar: profileAvatar
      });
      setProfileSaveSuccess(true);
      setTimeout(() => {
        setProfileSaveSuccess(false);
        setIsEditingProfile(false);
      }, 1000);
    } catch (err) {
      console.error('Lỗi lưu hồ sơ:', err);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Logs state
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<RawLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [reprocessMsg, setReprocessMsg] = useState('');

  // Settings Tab Navigation
  const [settingsTab, setSettingsTab] = useState<'profile' | 'accounts' | 'automation' | 'system'>('profile');

  // Version check state
  const CURRENT_VERSION = 'v1.2.9';
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [latestRelease, setLatestRelease] = useState<{
    tagName: string;
    apkUrl: string;
    hasUpdate: boolean;
    body?: string;
  } | null>({
    tagName: 'v1.2.9',
    apkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.9/qltc-v1.2.9.apk',
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
      let latestTag = 'v1.2.9';
      let apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.9/qltc-v1.2.9.apk';
      let releaseBody = '';

      try {
        const res = await fetch('https://api.github.com/repos/DUCDT3006/qltc/releases/latest');
        if (res.ok) {
          const data = await res.json();
          latestTag = data.tag_name || 'v1.2.9';
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
        tagName: 'v1.2.9',
        apkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.9/qltc-v1.2.9.apk',
        hasUpdate: true
      });
      setUpdateCheckedMsg('Phiên bản mới nhất: v1.2.9. Anh có thể tải trực tiếp file APK bên dưới.');
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
      (window as any).AndroidBridge.openExternalUrl(latestRelease?.apkUrl || 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.9/qltc-v1.2.9.apk');
      return;
    }

    // 2. Tự động kích hoạt tải file Blob về máy
    try {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `qltc-${latestRelease?.tagName || 'v1.2.9'}.apk`;
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
    const apkUrl = 'https://qltc-app.dtd-store.workers.dev/apk';
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

  const openCreateAccountForm = () => {
    setEditingAccount(null);
    setAccName('');
    setAccBankCode('VCB');
    setAccBankBin('970436');
    setAccNumber('');
    setAccHolder(userProfile?.name?.toUpperCase() || '');
    setAccBranch('');
    setAccType('bank');
    setAccBalance(0);
    setAccFormError('');
    setShowAddForm(true);
  };

  const openEditAccountForm = (acc: BankAccount) => {
    setEditingAccount(acc);
    setAccName(acc.name);
    setAccBankCode(acc.bankCode || 'VCB');
    setAccBankBin(acc.bankBin || findBankByCode(acc.bankCode)?.bin || '970436');
    setAccNumber(acc.accountNumber || (acc.accountNumberMask ? `*${acc.accountNumberMask}` : ''));
    setAccHolder(acc.accountHolder || '');
    setAccBranch(acc.branch || '');
    setAccType(acc.type || 'bank');
    setAccBalance(acc.balance || 0);
    setAccFormError('');
    setShowAddForm(true);
  };

  const handleSelectBank = (bank: VietnamBank) => {
    setAccBankCode(bank.code);
    setAccBankBin(bank.bin);
    if (!accName.trim() || findBankByCode(accBankCode)?.shortName === accName.trim()) {
      setAccName(bank.shortName);
    }
    if (bank.code === 'CASH') {
      setAccType('cash');
    } else if (['MOMO', 'ZALOPAY', 'VIETTELMONEY', 'VNPTMONEY'].includes(bank.code)) {
      setAccType('ewallet');
    } else {
      setAccType('bank');
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accName.trim()) {
      setAccFormError('Vui lòng nhập tên tài khoản / ví gợi nhớ');
      return;
    }

    const cleanNumber = accNumber.replace(/\D/g, '');
    let cleanMask = cleanNumber ? cleanNumber.slice(-4) : undefined;
    if (!cleanMask && editingAccount?.accountNumberMask) {
      cleanMask = editingAccount.accountNumberMask;
    }

    if (editingAccount) {
      const updated: BankAccount = {
        ...editingAccount,
        name: accName.trim(),
        bankCode: accType === 'cash' ? undefined : accBankCode,
        bankBin: accType === 'cash' ? undefined : accBankBin,
        accountNumber: accType === 'cash' ? undefined : (cleanNumber || undefined),
        accountHolder: accType === 'cash' ? undefined : (accHolder.trim().toUpperCase() || undefined),
        branch: accType === 'cash' ? undefined : (accBranch.trim() || undefined),
        accountNumberMask: accType === 'cash' ? undefined : cleanMask,
        balance: Math.round(accBalance || 0),
        type: accType
      };

      if (onUpdateAccount) {
        await onUpdateAccount(updated);
      } else if (onUpdateAccountBalance) {
        await onUpdateAccountBalance(updated.id, updated.balance, updated.name, updated.type);
      }
    } else {
      const newAcc: BankAccount = {
        id: `acc_${Date.now()}`,
        name: accName.trim(),
        bankCode: accType === 'cash' ? undefined : accBankCode,
        bankBin: accType === 'cash' ? undefined : accBankBin,
        accountNumber: accType === 'cash' ? undefined : (cleanNumber || undefined),
        accountHolder: accType === 'cash' ? undefined : (accHolder.trim().toUpperCase() || undefined),
        branch: accType === 'cash' ? undefined : (accBranch.trim() || undefined),
        accountNumberMask: accType === 'cash' ? undefined : cleanMask,
        balance: Math.round(accBalance || 0),
        type: accType
      };

      onAddAccount(newAcc);
    }

    setShowAddForm(false);
    setEditingAccount(null);
  };

  const handleCopyAccount = (acc: BankAccount) => {
    const bank = findBankByCode(acc.bankCode);
    const num = acc.accountNumber || (acc.accountNumberMask ? `*${acc.accountNumberMask}` : '');
    const lines = [
      `🏦 Ngân hàng: ${bank?.shortName || acc.bankCode || 'Ngân hàng'}`,
      num ? `💳 Số TK: ${num}` : '',
      acc.accountHolder ? `👤 Chủ TK: ${acc.accountHolder.toUpperCase()}` : '',
      acc.branch ? `📍 Chi nhánh: ${acc.branch}` : ''
    ].filter(Boolean);

    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedAccountId(acc.id);
    setTimeout(() => setCopiedAccountId(null), 2500);
  };

  const handleExportData = () => {
    const data = {
      accounts,
      exportedAt: new Date().toISOString(),
      app: 'QLTC',
      version: CURRENT_VERSION
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
      <div className="w-full max-w-md max-h-[88vh] overflow-y-auto bg-[#161C1E] border-t border-[#8BA5AA]/20 rounded-t-3xl p-5 shadow-2xl space-y-4 no-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <span className="text-base font-bold text-[#F2F5F5] block">Tài khoản & Cài đặt</span>
            <span className="text-[11px] text-[#869699]">Phiên bản {CURRENT_VERSION}</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[#232D30] text-[#97A8AB] flex items-center justify-center active:scale-90 transition-transform"
          >
            <X size={18} />
          </button>
        </div>

        {/* U-05: Thanh điều hướng 4 Tab gọn gàng */}
        <div className="grid grid-cols-4 gap-1 p-1 bg-[#0E1314] border border-[#8BA5AA]/15 rounded-2xl">
          {([
            { id: 'profile', label: 'Cá nhân', icon: User },
            { id: 'accounts', label: `Ví (${accounts.length})`, icon: Landmark },
            { id: 'automation', label: 'Tự động', icon: Smartphone },
            { id: 'system', label: 'Hệ thống', icon: Settings }
          ] as const).map(t => {
            const IconComp = t.icon;
            const active = settingsTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSettingsTab(t.id)}
                className={`py-2 px-1 rounded-xl text-[11px] font-semibold flex flex-col items-center justify-center gap-1 transition-all ${
                  active
                    ? 'bg-[#657D81] text-[#F2F5F5] shadow'
                    : 'text-[#869699] hover:text-[#D5E1E3]'
                }`}
              >
                <IconComp size={14} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: HỒ SƠ THÔNG TIN CÁ NHÂN & QUYỀN RIÊNG TƯ */}
        {settingsTab === 'profile' && (
          <div className="space-y-3 animate-fade-in">
            <div className="bg-gradient-to-br from-[#1E2729] to-[#151D1F] border border-[#8BA5AA]/25 rounded-2xl p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Avatar circle */}
              <div className="relative">
                <div className="w-[50px] h-[50px] rounded-full bg-gradient-to-br from-[#657D81] to-[#3E4F52] border-2 border-[#8CC7AE]/50 flex items-center justify-center font-bold text-lg text-[#F2F5F5] overflow-hidden shadow-md">
                  {profileAvatar ? (
                    <img src={profileAvatar} alt={profileName} className="w-full h-full object-cover" />
                  ) : (
                    <span>{(profileName?.trim() || 'A')[0].toUpperCase()}</span>
                  )}
                </div>
                {isEditingProfile && (
                  <label
                    title="Đổi ảnh đại diện"
                    className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#8CC7AE] text-[#0E1314] flex items-center justify-center cursor-pointer shadow-md hover:scale-105 active:scale-95 transition-transform"
                  >
                    <Camera size={12} strokeWidth={2.5} />
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                  </label>
                )}
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-[#F2F5F5]">{profileName || 'Anh Đức'}</span>
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-[#8CC7AE]/15 text-[#8CC7AE] font-medium">Cá nhân</span>
                </div>
                <div className="text-[11.5px] text-[#869699] flex items-center gap-1 mt-0.5">
                  <Mail size={12} className="text-[#8CC7AE]" />
                  <span className="truncate max-w-[170px]">{profileEmail || 'Chưa đặt Gmail'}</span>
                </div>
                {profilePhone ? (
                  <div className="text-[11px] text-[#869699] flex items-center gap-1 mt-0.5">
                    <Phone size={12} className="text-[#8CC7AE]" />
                    <span>{profilePhone}</span>
                  </div>
                ) : (
                  <div className="text-[10.5px] text-[#6E7F82] italic mt-0.5">Chưa có số điện thoại</div>
                )}
              </div>
            </div>

            <button
              onClick={() => setIsEditingProfile(!isEditingProfile)}
              className="py-1.5 px-3 rounded-xl bg-[#232E31] hover:bg-[#2B393D] text-xs font-semibold text-[#8CC7AE] border border-[#8CC7AE]/25 flex items-center gap-1 active:scale-95 transition-transform"
            >
              <Edit3 size={13} />
              {isEditingProfile ? 'Đóng' : 'Sửa'}
            </button>
          </div>

          {/* Form Chỉnh sửa thông tin */}
          {isEditingProfile && (
            <form onSubmit={handleSaveProfile} className="pt-3 border-t border-[#8BA5AA]/15 space-y-3 animate-fade-in">
              <div className="text-[11px] font-semibold text-[#8CC7AE] flex items-center justify-between">
                <span>Cập nhật thông tin (Không bắt buộc)</span>
                <span className="text-[10px] text-[#869699] font-normal">Có thể để mặc định</span>
              </div>

              {/* Tùy chọn Avatar */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-[#97A8AB] font-medium block">Ảnh đại diện (Avatar):</label>
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="cursor-pointer py-1.5 px-3 rounded-xl bg-[#232E31] border border-[#8BA5AA]/30 text-[11px] font-semibold text-[#BFD0D3] flex items-center gap-1.5 hover:bg-[#2A373B] active:scale-95 transition-transform">
                    <Camera size={13} className="text-[#8CC7AE]" />
                    Tải ảnh từ máy
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                  </label>

                  {profileAvatar && (
                    <button
                      type="button"
                      onClick={() => setProfileAvatar('')}
                      className="py-1.5 px-2.5 rounded-xl bg-[#291B1D] text-[#E07A5F] border border-[#E07A5F]/30 text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-transform"
                    >
                      <Trash2 size={12} />
                      Gỡ ảnh
                    </button>
                  )}
                </div>

                {/* Preset icons sang trọng */}
                <div className="flex items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-[#869699]">Icon mẫu:</span>
                  {['👔', '🕶️', '⚡', '💎', '👑', '🎯'].map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => handleSelectPresetAvatar(emoji)}
                      className="w-7 h-7 rounded-lg bg-[#232E31] hover:bg-[#2B393D] border border-[#8BA5AA]/20 flex items-center justify-center text-sm active:scale-90 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nhập Họ tên */}
              <div className="space-y-1">
                <label className="text-[11px] text-[#97A8AB] font-medium block">Họ và tên / Biệt danh:</label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-2.5 text-[#869699]" />
                  <input
                    type="text"
                    placeholder="VD: Anh Đức, Đức Dương..."
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full bg-[#121617] border border-[#8BA5AA]/25 rounded-xl pl-8 pr-3 py-2 text-xs text-[#F2F5F5] placeholder-[#576466] focus:outline-none focus:border-[#8CC7AE]/50"
                  />
                </div>
              </div>

              {/* Nhập Gmail */}
              <div className="space-y-1">
                <label className="text-[11px] text-[#97A8AB] font-medium block">Gmail / Email:</label>
                <div className="relative">
                  <Mail size={14} className="absolute left-3 top-2.5 text-[#869699]" />
                  <input
                    type="email"
                    placeholder="VD: duongthuongduc@gmail.com"
                    value={profileEmail}
                    onChange={(e) => setProfileEmail(e.target.value)}
                    className="w-full bg-[#121617] border border-[#8BA5AA]/25 rounded-xl pl-8 pr-3 py-2 text-xs text-[#F2F5F5] placeholder-[#576466] focus:outline-none focus:border-[#8CC7AE]/50"
                  />
                </div>
              </div>

              {/* Nhập Số điện thoại */}
              <div className="space-y-1">
                <label className="text-[11px] text-[#97A8AB] font-medium block">Số điện thoại:</label>
                <div className="relative">
                  <Phone size={14} className="absolute left-3 top-2.5 text-[#869699]" />
                  <input
                    type="tel"
                    placeholder="VD: 0912 345 678"
                    value={profilePhone}
                    onChange={(e) => setProfilePhone(e.target.value)}
                    className="w-full bg-[#121617] border border-[#8BA5AA]/25 rounded-xl pl-8 pr-3 py-2 text-xs text-[#F2F5F5] placeholder-[#576466] focus:outline-none focus:border-[#8CC7AE]/50"
                  />
                </div>
              </div>

              <div className="text-[10px] text-[#869699] italic">
                💡 Thông tin cá nhân này không bắt buộc. Anh có thể để mặc định hoặc thay đổi bất cứ khi nào theo ý muốn.
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsEditingProfile(false)}
                  className="flex-1 py-2 rounded-xl bg-[#232E31] text-[#97A8AB] text-xs font-semibold hover:bg-[#283538] active:scale-95 transition-transform"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="flex-1 py-2 rounded-xl bg-[#8CC7AE] hover:bg-[#9ED4BD] text-[#0E1314] text-xs font-bold shadow-md flex items-center justify-center gap-1.5 active:scale-95 transition-transform disabled:opacity-50"
                >
                  {isSavingProfile ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      Đang lưu...
                    </>
                  ) : profileSaveSuccess ? (
                    <>
                      <CheckCircle2 size={14} />
                      Đã lưu!
                    </>
                  ) : (
                    'Lưu thông tin'
                  )}
                </button>
              </div>
            </form>
          )}
            </div>

            {/* Tùy chọn Ẩn/Hiện số dư riêng tư */}
            <button
              type="button"
              onClick={onTogglePrivacy}
              className="w-full p-3.5 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center justify-between text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
            >
              <span className="flex items-center gap-2.5">
                {privacyMode ? <EyeOff size={16} className="text-[#DEB48A]" /> : <Eye size={16} className="text-[#8CC7AE]" />}
                <span>Chế độ ẩn số dư nhạy cảm</span>
              </span>
              <span className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${privacyMode ? 'bg-[#DEB48A]/20 text-[#DEB48A]' : 'bg-[#232E31] text-[#869699]'}`}>
                {privacyMode ? 'Đang ẩn' : 'Đang hiện'}
              </span>
            </button>
          </div>
        )}

        {/* TAB 3: TỰ ĐỘNG ĐỌC THÔNG BÁO ANDROID */}
        {settingsTab === 'automation' && (
          <div className="space-y-3 animate-fade-in">
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
          </div>
        )}

        {/* TAB 4: HỆ THỐNG, CẬP NHẬT APK & ĐẶT LẠI DỮ LIỆU */}
        {settingsTab === 'system' && (
          <div className="space-y-3 animate-fade-in">
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
                  Đang tải gói cập nhật {latestRelease?.tagName || 'v1.2.9'}...
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
                    Đã tải hoàn tất 100% ({latestRelease?.tagName || 'v1.2.9'})!
                  </div>
                  <div className="text-[10.5px] text-[#869699]">
                    Kích thước: {(downloadTotalBytes / (1024 * 1024)).toFixed(1)} MB · Sẵn sàng nâng cấp
                  </div>
                </div>
              </div>

              {downloadBlobUrl && (
                <a
                  href={downloadBlobUrl}
                  download={`qltc-${latestRelease?.tagName || 'v1.2.9'}.apk`}
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

            {/* Sao lưu & Thiết lập lại tài chính */}
            <button
              type="button"
              onClick={handleExportData}
              className="w-full p-3.5 rounded-2xl bg-[#1C2426] border border-[#8BA5AA]/15 flex items-center justify-between text-xs font-medium text-[#C4D0D2] active:bg-[#232D30]"
            >
              <span className="flex items-center gap-2.5">
                <Download size={16} className="text-[#8CC7AE]" />
                <span>Sao lưu dữ liệu ra file JSON</span>
              </span>
              <span className="text-[11px] text-[#8CC7AE] font-semibold">Tải về ›</span>
            </button>

            <button
              type="button"
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
          </div>
        )}

        {/* TAB 2: TÀI KHOẢN & VÍ NGÂN HÀNG */}
        {settingsTab === 'accounts' && (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-semibold text-[#869699] uppercase tracking-wider block">
                  Tài khoản & Ví ngân hàng ({accounts.length})
                </span>
                <span className="text-[10px] text-[#869699]">
                  Hỗ trợ VietQR 24/7, sao chép STK và xuất mã QR chuyển khoản
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (showAddForm) {
                    setShowAddForm(false);
                    setEditingAccount(null);
                  } else {
                    openCreateAccountForm();
                  }
                }}
                className="px-2.5 py-1.5 rounded-xl bg-[#20292B] hover:bg-[#28383B] border border-[#8CC7AE]/30 text-xs font-semibold text-[#8CC7AE] flex items-center gap-1 active:scale-95 shadow-sm"
              >
                <Plus size={14} /> {showAddForm ? 'Đóng form' : 'Thêm tài khoản'}
              </button>
            </div>

            {/* FORM THÊM MỚI / CHỈNH SỬA TÀI KHOẢN ĐẦY ĐỦ THÔNG TIN */}
            {showAddForm && (
              <form
                onSubmit={handleSaveAccount}
                className="bg-gradient-to-br from-[#202B2E] to-[#161F21] border border-[#8BA5AA]/25 rounded-3xl p-4 space-y-3 shadow-xl animate-fade-in"
              >
                <div className="flex items-center justify-between border-b border-[#8BA5AA]/15 pb-2">
                  <span className="text-xs font-bold text-[#F2F5F5] flex items-center gap-1.5">
                    <Building2 size={14} className="text-[#8CC7AE]" />
                    {editingAccount ? 'Chỉnh sửa tài khoản ngân hàng' : 'Thêm tài khoản ngân hàng mới'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingAccount(null);
                    }}
                    className="text-[#869699] hover:text-white text-xs"
                  >
                    Đóng ✕
                  </button>
                </div>

                {accFormError && (
                  <div className="p-2 rounded-xl bg-[#3B2022] border border-[#E06D6D]/40 text-[#E06D6D] text-xs">
                    {accFormError}
                  </div>
                )}

                {/* 1. CHỌN NGÂN HÀNG TỪ DANH SÁCH 76+ NGÂN HÀNG VIỆT NAM */}
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Ngân hàng / Đơn vị cung cấp
                  </label>
                  <button
                    type="button"
                    onClick={() => setIsBankPickerOpen(true)}
                    className="w-full p-2.5 rounded-2xl bg-[#161C1E] border border-[#8BA5AA]/25 hover:border-[#8CC7AE]/50 flex items-center justify-between text-left transition-all active:scale-98"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow">
                        {findBankByCode(accBankCode)?.logo ? (
                          <img
                            src={findBankByCode(accBankCode)?.logo}
                            alt={accBankCode}
                            className="w-full h-full object-contain"
                          />
                        ) : (
                          <Building2 size={16} className="text-[#0E1314]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#F2F5F5] flex items-center gap-1.5 truncate">
                          <span>{findBankByCode(accBankCode)?.shortName || accBankCode}</span>
                          <span className="text-[10px] font-mono text-[#869699] px-1 rounded bg-[#0E1314]">
                            {accBankCode}
                          </span>
                        </div>
                        <div className="text-[10.5px] text-[#869699] truncate">
                          {findBankByCode(accBankCode)?.name || 'Chạm để tìm và đổi ngân hàng khác'}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold text-[#8CC7AE] px-2.5 py-1 rounded-xl bg-[#8CC7AE]/10 border border-[#8CC7AE]/20 shrink-0">
                      Đổi ngân hàng ▾
                    </span>
                  </button>
                </div>

                {/* 2. SỐ TÀI KHOẢN ĐẦY ĐỦ */}
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Số tài khoản đầy đủ
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="VD: 19036888888888"
                    value={accNumber}
                    onChange={(e) => setAccNumber(e.target.value)}
                    className="w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3.5 py-2 text-xs font-mono text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]"
                  />
                  <span className="text-[10px] text-[#869699] mt-0.5 block">
                    Hệ thống sẽ dùng số tài khoản này để tự động tạo mã QR VietQR chuyển khoản nhanh.
                  </span>
                </div>

                {/* 3. TÊN CHỦ TÀI KHOẢN & CHI NHÁNH */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                      Tên chủ tài khoản
                    </label>
                    <input
                      type="text"
                      placeholder="VD: DO TIEN DUC"
                      value={accHolder}
                      onChange={(e) => setAccHolder(e.target.value.toUpperCase())}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE] uppercase font-semibold"
                    />
                  </div>

                  <div>
                    <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                      Chi nhánh (Không bắt buộc)
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Chi nhánh Ba Đình"
                      value={accBranch}
                      onChange={(e) => setAccBranch(e.target.value)}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]"
                    />
                  </div>
                </div>

                {/* 4. TÊN GỢI NHỚ VÀ LOẠI VÍ */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                      Tên gợi nhớ tài khoản / Ví
                    </label>
                    <input
                      type="text"
                      placeholder="VD: Techcombank chính, Ví tiền mặt..."
                      value={accName}
                      onChange={(e) => setAccName(e.target.value)}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] placeholder-[#869699] focus:outline-none focus:border-[#8CC7AE]"
                    />
                  </div>

                  <div>
                    <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                      Loại tài sản / Ví
                    </label>
                    <select
                      value={accType}
                      onChange={(e) => setAccType(e.target.value as any)}
                      className="w-full bg-[#161C1E] border border-[#8BA5AA]/25 rounded-xl px-3 py-2 text-xs text-[#F2F5F5] focus:outline-none focus:border-[#8CC7AE]"
                    >
                      <option value="bank" className="bg-[#161C1E] text-white">🏦 Tài khoản Ngân hàng</option>
                      <option value="cash" className="bg-[#161C1E] text-white">💵 Ví Tiền mặt</option>
                      <option value="ewallet" className="bg-[#161C1E] text-white">📱 Ví Điện tử (MoMo/ZaloPay)</option>
                      <option value="savings" className="bg-[#161C1E] text-white">💰 Sổ Tiết kiệm</option>
                      <option value="securities" className="bg-[#161C1E] text-white">📈 Tài khoản Chứng khoán</option>
                    </select>
                  </div>
                </div>

                {/* 5. SỐ DƯ HIỆN TẠI */}
                <div>
                  <label className="text-[10.5px] font-semibold text-[#869699] uppercase tracking-wider block mb-1">
                    Số dư hiện tại (₫)
                  </label>
                  <CurrencyInput
                    value={accBalance}
                    onChange={setAccBalance}
                    className="text-sm font-bold"
                  />
                </div>

                {/* Cụm nút Lưu / Hủy */}
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setEditingAccount(null);
                    }}
                    className="px-4 py-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-xs font-semibold text-[#97A8AB] active:scale-95"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 rounded-xl bg-[#8CC7AE] hover:bg-[#9ED4BD] text-[#0E1314] text-xs font-bold shadow active:scale-98 transition-transform"
                  >
                    {editingAccount ? 'Lưu thay đổi' : 'Lưu tài khoản mới'}
                  </button>
                </div>
              </form>
            )}

            {/* DANH SÁCH TÀI KHOẢN ĐÃ SETUP */}
            <div className="space-y-2.5">
              {accounts.length === 0 ? (
                <div className="text-center py-8 text-xs text-[#869699] bg-[#1C2426]/60 rounded-3xl border border-dashed border-[#8BA5AA]/20 p-4">
                  Chưa có tài khoản nào. Bấm <b>+ Thêm tài khoản</b> để thiết lập ngân hàng của anh.
                </div>
              ) : (
                accounts.map((acc) => {
                  const bank = findBankByCode(acc.bankCode);
                  const isCopied = copiedAccountId === acc.id;
                  const displayNum = acc.accountNumber || (acc.accountNumberMask ? `*${acc.accountNumberMask}` : 'Ví tiền mặt');

                  return (
                    <div
                      key={acc.id}
                      className="bg-gradient-to-br from-[#20292B] to-[#172022] border border-[#8BA5AA]/20 rounded-2xl p-3.5 space-y-2.5 shadow-md"
                    >
                      {/* Dòng 1: Logo, Tên, Số TK và Số dư */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="w-9 h-9 rounded-xl bg-white p-1 flex items-center justify-center shrink-0 overflow-hidden shadow">
                            {bank?.logo ? (
                              <img
                                src={bank.logo}
                                alt={bank.shortName}
                                className="w-full h-full object-contain"
                              />
                            ) : (
                              <div className="w-full h-full bg-[#232E31] text-[#8CC7AE] font-bold text-xs flex items-center justify-center">
                                {acc.bankCode || 'VÍ'}
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[#F2F5F5] truncate flex items-center gap-1.5">
                              <span>{acc.name}</span>
                              {acc.bankCode && (
                                <span className="text-[10px] font-mono px-1 rounded bg-[#0E1314] text-[#869699] border border-[#8BA5AA]/15">
                                  {bank?.shortName || acc.bankCode}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[#869699] font-mono mt-0.5 truncate flex items-center gap-1">
                              <span>STK:</span>
                              <span className="text-[#D5E1E3] font-semibold">{displayNum}</span>
                            </div>
                          </div>
                        </div>

                        {/* Số dư */}
                        <div className="text-right num text-[13px] font-bold text-[#8CC7AE] shrink-0">
                          {privacyMode ? '•••••• ₫' : formatVND(acc.balance)}
                        </div>
                      </div>

                      {/* Dòng 2: Tên chủ tài khoản & Chi nhánh (nếu có) */}
                      {(acc.accountHolder || acc.branch) && (
                        <div className="bg-[#12191B]/70 rounded-xl px-2.5 py-1.5 text-[10.5px] text-[#869699] flex flex-wrap items-center gap-x-3 gap-y-1">
                          {acc.accountHolder && (
                            <span className="flex items-center gap-1">
                              <User size={11} className="text-[#8CC7AE]" />
                              <b className="text-[#F2F5F5] uppercase">{acc.accountHolder}</b>
                            </span>
                          )}
                          {acc.branch && (
                            <span className="flex items-center gap-1 truncate max-w-xs">
                              <MapPin size={11} className="text-[#869699]" />
                              <span>{acc.branch}</span>
                            </span>
                          )}
                        </div>
                      )}

                      {/* Dòng 3: Cụm nút tính năng: Copy STK, Mã QR VietQR, Sửa, Xóa */}
                      <div className="flex items-center justify-between pt-1 border-t border-[#8BA5AA]/10">
                        {/* Nút sao chép & Nút Mã QR */}
                        <div className="flex items-center gap-1.5">
                          {acc.type !== 'cash' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCopyAccount(acc)}
                                className={`px-2.5 py-1 rounded-xl border text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-all ${
                                  isCopied
                                    ? 'bg-[#8CC7AE]/20 border-[#8CC7AE] text-[#8CC7AE]'
                                    : 'bg-[#232D30] hover:bg-[#2C3B3F] border-[#8BA5AA]/20 text-[#D5E1E3]'
                                }`}
                                title="Sao chép số tài khoản & thông tin chuyển khoản"
                              >
                                {isCopied ? (
                                  <>
                                    <Check size={12} className="text-[#8CC7AE]" /> Đã chép
                                  </>
                                ) : (
                                  <>
                                    <Copy size={12} /> Sao chép STK
                                  </>
                                )}
                              </button>

                              <button
                                type="button"
                                onClick={() => setQrModalAccount(acc)}
                                className="px-2.5 py-1 rounded-xl bg-[#8CC7AE]/15 hover:bg-[#8CC7AE]/25 border border-[#8CC7AE]/30 text-[11px] font-bold text-[#8CC7AE] flex items-center gap-1 active:scale-95 transition-all"
                                title="Xem và tải mã QR VietQR chuyển khoản nhanh"
                              >
                                <QrCode size={12} /> Mã QR
                              </button>
                            </>
                          )}
                        </div>

                        {/* Cụm nút Sửa & Xóa */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditAccountForm(acc)}
                            className="p-1.5 rounded-lg bg-[#232E31] text-[#D5E1E3] hover:bg-[#2C383C] active:scale-90"
                            title="Chỉnh sửa thông tin tài khoản"
                          >
                            <Edit2 size={13} />
                          </button>

                          {onDeleteAccount && (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteAcc(acc)}
                              className="p-1.5 rounded-lg bg-[#291B1D] text-[#E06D6D] hover:bg-[#382124] active:scale-90"
                              title="Xóa tài khoản"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Security badge */}
        <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#869699] pt-2">
          <ShieldCheck size={14} className="text-[#8CC7AE]" />
          Dữ liệu mã hóa · 100% riêng tư & An toàn tuyệt đối
        </div>
      </div>

      {/* U-04: Xác nhận xóa tài khoản */}
      <ConfirmSheet
        isOpen={Boolean(confirmDeleteAcc)}
        title="Xóa tài khoản / Ví"
        description={`Anh có chắc muốn ẩn/xóa tài khoản "${confirmDeleteAcc?.name}" khỏi danh sách tài sản hiện có không?`}
        confirmText="Xóa tài khoản"
        isDanger
        onConfirm={async () => {
          if (confirmDeleteAcc && onDeleteAccount) {
            await onDeleteAccount(confirmDeleteAcc.id);
          }
          setConfirmDeleteAcc(null);
        }}
        onCancel={() => setConfirmDeleteAcc(null)}
      />

      {/* Modal chọn ngân hàng Việt Nam */}
      <BankPickerModal
        isOpen={isBankPickerOpen}
        onClose={() => setIsBankPickerOpen(false)}
        selectedCode={accBankCode}
        onSelect={handleSelectBank}
      />

      {/* Modal hiển thị mã VietQR chuyển khoản */}
      <AccountQrModal
        isOpen={Boolean(qrModalAccount)}
        onClose={() => setQrModalAccount(null)}
        account={qrModalAccount}
        onEditAccount={(acc) => openEditAccountForm(acc)}
      />
    </div>
  );
};
