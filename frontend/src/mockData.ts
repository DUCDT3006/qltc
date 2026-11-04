import { Jar, BankAccount, Transaction, Holding } from './types';

export const INITIAL_JARS: Jar[] = [
  { id: 'jar_nec', code: 'NEC', name: 'Thiết yếu', targetPercent: 0.55, monthlyLimit: 24900000, spentThisMonth: 15500000, color: '#95B0B4' },
  { id: 'jar_ffa', code: 'FFA', name: 'Tự do TC', targetPercent: 0.10, monthlyLimit: 4520000, spentThisMonth: 4520000, color: '#8CC7AE' },
  { id: 'jar_ltss', code: 'LTSS', name: 'Tiết kiệm dài hạn', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 900000, color: '#657D81' },
  { id: 'jar_edu', code: 'EDU', name: 'Giáo dục', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 1340000, color: '#657D81' },
  { id: 'jar_play', code: 'PLAY', name: 'Hưởng thụ', targetPercent: 0.10, monthlyLimit: 4500000, spentThisMonth: 4090000, color: '#D4A373' },
  { id: 'jar_give', code: 'GIVE', name: 'Cho đi', targetPercent: 0.05, monthlyLimit: 2300000, spentThisMonth: 1050000, color: '#657D81' }
];

export const INITIAL_ACCOUNTS: BankAccount[] = [
  { id: 'acc_vcb', name: 'Vietcombank', bankCode: 'VCB', accountNumberMask: '0071', balance: 14520000, type: 'bank' },
  { id: 'acc_tcb', name: 'Techcombank', bankCode: 'TCB', accountNumberMask: '1902', balance: 5200000, type: 'bank' },
  { id: 'acc_mb', name: 'MB Bank', bankCode: 'MB', accountNumberMask: '0340', balance: 35000000, type: 'bank' },
  { id: 'acc_cash', name: 'Tiền mặt ví', balance: 1800000, type: 'cash' },
  { id: 'acc_tcbs', name: 'TCBS Chứng khoán', bankCode: 'TCBS', accountNumberMask: '8812', balance: 185000000, type: 'securities' }
];

export const INITIAL_PENDING_TRANSACTIONS: Transaction[] = [
  {
    id: 'txn_p1',
    bankCode: 'VCB',
    accountMask: '0071',
    accountName: 'Vietcombank · *0071',
    type: 'expense',
    amount: 85000,
    description: 'GRAB*TRIP DI CHUYEN',
    rawQuote: 'Số dư TK VCB 0071...9821 −85,000VND lúc 10:42 04/11. SD: 14,520,000VND. Ref MBVCB.784912.GRAB',
    suggestedCategory: 'Di chuyển',
    suggestedJarCode: 'NEC',
    occurredAt: 'Hôm nay · 10:42',
    status: 'pending'
  },
  {
    id: 'txn_p2',
    bankCode: 'TCB',
    accountMask: '1902',
    accountName: 'Techcombank · *1902',
    type: 'expense',
    amount: 350000,
    description: 'SHOPEE*ORDER MUA SAM',
    rawQuote: 'TK 1902... -350,000 VND luc 09:15 04/11. So du: 5,200,000 VND. ND: SHOPEE*ORDER',
    suggestedCategory: 'Mua sắm',
    suggestedJarCode: 'PLAY',
    occurredAt: 'Hôm nay · 09:15',
    status: 'pending'
  },
  {
    id: 'txn_p3',
    bankCode: 'MB',
    accountMask: '0340',
    accountName: 'MB Bank · *0340',
    type: 'income',
    amount: 25000000,
    description: 'CTY ABC THANH TOAN LUONG THANG 11',
    rawQuote: 'GD: +25,000,000VND vao 08:30 04/11. TK 0340... So du: 35,000,000VND. ND: CTY ABC THANH TOAN LUONG',
    suggestedCategory: 'Lương chính (tự chia 6 hũ)',
    suggestedJarCode: 'NEC',
    occurredAt: 'Hôm nay · 08:30',
    status: 'pending'
  },
  {
    id: 'txn_p4',
    bankCode: 'ACB',
    accountMask: '2190',
    accountName: 'ACB · *2190',
    type: 'transfer',
    amount: 5000000,
    description: 'Chuyển sang TCB *8812',
    rawQuote: 'ACB: TK 2190... GD -5,000,000 VND luc 07:45 04/11. ND: Chuyen sang TCB 8812',
    suggestedCategory: 'Chuyển tiền nội bộ',
    suggestedJarCode: 'NEC',
    occurredAt: 'Hôm nay · 07:45',
    status: 'pending'
  },
  {
    id: 'txn_p5',
    bankCode: 'VCB',
    accountMask: '0071',
    accountName: 'Vietcombank · *0071',
    type: 'expense',
    amount: 45000,
    description: 'HIGHLANDS COFFEE CAFE SANG',
    rawQuote: 'TK 0071... -45,000 VND luc 07:15 04/11. ND: HIGHLANDS COFFEE',
    suggestedCategory: 'Cafe & Trà',
    suggestedJarCode: 'PLAY',
    occurredAt: 'Hôm nay · 07:15',
    status: 'pending'
  }
];

export const INITIAL_HOLDINGS: Holding[] = [
  { symbol: 'HPG', name: 'Tập đoàn Hòa Phát', assetClass: 'stock', quantity: 2000, avgCost: 24100, currentPrice: 27350, unit: 'CP' },
  { symbol: 'FPT', name: 'Tập đoàn FPT', assetClass: 'stock', quantity: 500, avgCost: 132000, currentPrice: 128400, unit: 'CP' },
  { symbol: 'BCF', name: 'Quỹ Cổ phiếu VCBF-BCF', assetClass: 'fund', quantity: 2150, avgCost: 42150, currentPrice: 49820, unit: 'CCQ' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', quantity: 0.021, avgCost: 2090000000, currentPrice: 2542857000, unit: 'BTC' },
  { symbol: 'SJC', name: 'Vàng nhẫn 9999 SJC', assetClass: 'gold', quantity: 4, avgCost: 8140000, currentPrice: 8900000, unit: 'chỉ' }
];

export function formatVND(amount: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(amount)) + ' ₫';
}

export function formatShortVND(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1000000000) {
    return (amount / 1000000000).toFixed(1).replace('.', ',') + ' tỷ';
  }
  if (abs >= 1000000) {
    return (amount / 1000000).toFixed(1).replace('.', ',') + 'tr';
  }
  if (abs >= 1000) {
    return (amount / 1000).toFixed(0) + 'k';
  }
  return amount.toString();
}
