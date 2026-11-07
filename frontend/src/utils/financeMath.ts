// Tiện ích toán học tài chính & tỷ lệ phần trăm chuẩn hóa 100%

export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
}

export const RECURRENCE_PRESETS = [
  { value: 'Hàng tháng', label: 'Hàng tháng', divisor: 1, hint: 'Nhận đều mỗi tháng' },
  { value: 'Hàng quý', label: 'Hàng quý (3 tháng/lần)', divisor: 3, hint: 'Tự động chia 3 cho hàng tháng' },
  { value: 'Hàng năm', label: 'Hàng năm (12 tháng/lần)', divisor: 12, hint: 'Tự động chia 12 cho hàng tháng' },
  { value: 'Nửa năm (6 tháng)', label: 'Nửa năm (6 tháng/lần)', divisor: 6, hint: 'Tự động chia 6 cho hàng tháng' },
  { value: 'Hàng tuần', label: 'Hàng tuần', divisor: 12 / 52, hint: 'Quy đổi 4.33 tuần/tháng' },
  { value: 'Một lần', label: 'Một lần / Theo đợt', divisor: 1, hint: 'Ghi nhận trọn vẹn trong tháng này' }
];

export function normalizeToMonthlyAmount(amount: number, recurrence?: string): number {
  if (!amount || amount <= 0) return 0;
  const rec = (recurrence || '').toLowerCase().trim();
  if (rec.includes('năm') || rec.includes('year')) {
    return Math.round(amount / 12);
  }
  if (rec.includes('quý') || rec.includes('quarter')) {
    return Math.round(amount / 3);
  }
  if (rec.includes('6 tháng') || rec.includes('nửa năm') || rec.includes('semiannual')) {
    return Math.round(amount / 6);
  }
  if (rec.includes('tuần') || rec.includes('week')) {
    return Math.round((amount * 52) / 12);
  }
  return Math.round(amount);
}

// Phương pháp Số Dư Lớn Nhất (Largest Remainder Method) đảm bảo tổng các tỷ lệ % luôn đúng bằng 100%
export function computeExact100Percentages(values: number[]): number[] {
  const sum = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (sum <= 0) {
    return values.map(() => 0);
  }

  const rawShares = values.map(v => (Math.max(0, v) / sum) * 100);
  const floors = rawShares.map(v => Math.floor(v));
  const remainders = rawShares.map((v, idx) => ({ remainder: v - floors[idx], idx }));

  let floorSum = floors.reduce((s, f) => s + f, 0);
  let diff = 100 - floorSum;

  remainders.sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < diff; i++) {
    const targetIdx = remainders[i % remainders.length].idx;
    floors[targetIdx] += 1;
  }

  return floors;
}
