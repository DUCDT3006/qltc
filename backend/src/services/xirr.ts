// XIRR Solver V2 (Đợt 10)
// Tuân thủ đặc tả V2-19, AT2-42, AT2-43

export interface CashFlow {
  amount: number; // Âm: góp vốn/mua; Dương: rút vốn/bán/giá trị cuối kỳ
  date: string | Date; // ISO string hoặc Date
}

export type CashFlowItem = CashFlow;

export function calculateXirr(cashFlows: CashFlow[], guess = 0.1): number | null {
  if (!cashFlows || cashFlows.length < 2) return null;

  // Kiểm tra phải có cả dòng tiền âm (góp) và dương (rút/cuối kỳ)
  let hasPositive = false;
  let hasNegative = false;
  for (const cf of cashFlows) {
    if (cf.amount > 0) hasPositive = true;
    if (cf.amount < 0) hasNegative = true;
  }
  if (!hasPositive || !hasNegative) return null;

  const parsedDates = cashFlows.map(cf => (cf.date instanceof Date ? cf.date.getTime() : new Date(cf.date).getTime()));
  for (const d of parsedDates) {
    if (isNaN(d)) return null;
  }

  const minDate = Math.min(...parsedDates);

  const npv = (r: number) => {
    let sum = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const dt = (parsedDates[i] - minDate) / (86400000 * 365);
      sum += cashFlows[i].amount / Math.pow(1 + r, dt);
    }
    return sum;
  };

  const dNpv = (r: number) => {
    let sum = 0;
    for (let i = 0; i < cashFlows.length; i++) {
      const dt = (parsedDates[i] - minDate) / (86400000 * 365);
      sum += -dt * cashFlows[i].amount / Math.pow(1 + r, dt + 1);
    }
    return sum;
  };

  let r = guess;
  const maxIter = 100;
  const tol = 1e-6;

  // Thuật toán Newton-Raphson
  for (let iter = 0; iter < maxIter; iter++) {
    if (r <= -1) r = -0.9999;
    const f = npv(r);
    if (Math.abs(f) < tol) {
      return r;
    }
    const df = dNpv(r);
    if (Math.abs(df) < 1e-12) {
      break;
    }
    const nextR = r - f / df;
    if (Math.abs(nextR - r) < tol) {
      return nextR;
    }
    r = nextR;
  }

  // Thuật toán Bisection fallback
  let low = -0.9999;
  let high = 10.0;
  let fLow = npv(low);
  let fHigh = npv(high);

  if (fLow * fHigh > 0) {
    return null; // Không hội tụ
  }

  for (let iter = 0; iter < 100; iter++) {
    const mid = (low + high) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < tol || (high - low) / 2 < tol) {
      return mid;
    }
    if (fLow * fMid < 0) {
      high = mid;
      fHigh = fMid;
    } else {
      low = mid;
      fLow = fMid;
    }
  }

  return (low + high) / 2;
}

export const calculateXIRR = calculateXirr;
