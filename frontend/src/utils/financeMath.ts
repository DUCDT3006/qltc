// Tiện ích toán học tài chính & tỷ lệ phần trăm chuẩn hóa 100%

export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
}

// Định dạng tiền tệ có hỗ trợ chế độ riêng tư (Privacy Mode - V2-23)
export function formatPrivacyVND(amount: number, isPrivacy = false): string {
  if (isPrivacy) return '•••••• ₫';
  return formatVND(amount);
}

// Định dạng số có che riêng tư cho số lượng hoặc giá trị khác
export function formatPrivacyText(text: string | number, isPrivacy = false): string {
  if (isPrivacy) return '••••••';
  return String(text);
}

export const RECURRENCE_PRESETS = [
  { value: 'Hàng tháng', label: 'Hàng tháng', divisor: 1, hint: 'Nhận đều mỗi tháng' },
  { value: 'Hàng quý', label: 'Hàng quý (3 tháng/lần)', divisor: 3, hint: 'Tự động chia 3 cho hàng tháng' },
  { value: 'Hàng năm', label: 'Hàng năm (12 tháng/lần)', divisor: 12, hint: 'Tự động chia 12 cho hàng tháng' },
  { value: 'Nửa năm (6 tháng)', label: 'Nửa năm (6 tháng/lần)', divisor: 6, hint: 'Tự động chia 6 cho hàng tháng' },
  { value: 'Hàng tuần', label: 'Hàng tuần', divisor: 12 / 52, hint: 'Quy đổi 4.33 tuần/tháng' },
  { value: 'Một lần', label: 'Một lần / Theo đợt', divisor: 1, hint: 'Ghi nhận trọn vẹn trong tháng này' }
];

export function normalizeToMonthlyAmount(amount?: number, recurrence?: string): number {
  if (!amount || amount <= 0) return 0;
  const rec = (recurrence || '').toLowerCase().trim();
  // Kiểm tra "nửa năm / 6 tháng" TRƯỚC "năm" để tránh 'nửa năm' bị khớp nhầm vào 'năm' (chia 12 thay vì chia 6)
  if (rec.includes('6 tháng') || rec.includes('nửa năm') || rec.includes('nua nam') || rec.includes('semiannual')) {
    return Math.round(amount / 6);
  }
  if (rec.includes('năm') || rec.includes('hang nam') || rec.includes('year')) {
    return Math.round(amount / 12);
  }
  if (rec.includes('quý') || rec.includes('hang quy') || rec.includes('quarter')) {
    return Math.round(amount / 3);
  }
  if (rec.includes('tuần') || rec.includes('hang tuan') || rec.includes('week')) {
    return Math.round((amount * 52) / 12);
  }
  return Math.round(amount);
}

// Phân bổ số tiền VND chính xác từng đồng theo tỷ trọng (Largest Remainder Method - V2-17)
export function allocateVndExact(totalVnd: number, weights: (number | { weight: number })[]): number[] {
  if (weights.length === 0) return [];
  const numWeights = weights.map(w => (typeof w === 'number' ? w : w.weight));
  if (totalVnd <= 0) return numWeights.map(() => 0);

  const totalWeight = numWeights.reduce((s, w) => s + Math.max(0, w), 0);
  if (totalWeight <= 0) return numWeights.map(() => 0);

  const rawShares = numWeights.map(w => (totalVnd * Math.max(0, w)) / totalWeight);
  const floors = rawShares.map(s => Math.floor(s));
  const remainders = rawShares.map((s, idx) => ({ remainder: s - floors[idx], idx }));

  let floorSum = floors.reduce((s, f) => s + f, 0);
  let diff = totalVnd - floorSum;

  remainders.sort((a, b) => b.remainder - a.remainder);

  for (let i = 0; i < diff; i++) {
    const targetIdx = remainders[i % remainders.length].idx;
    floors[targetIdx] += 1;
  }

  return floors;
}
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
