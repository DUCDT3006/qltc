import { API_BASE, apiRequestJson } from '../services/apiClient';
import { InvestmentCashflow, InvestmentCashflowsResponse } from '../types';

const endpoint = `${API_BASE}/investment-cashflows`;

export function parseInvestmentCashflowsResponse(payload: unknown): InvestmentCashflowsResponse {
  if (!payload || typeof payload !== 'object') throw new Error('Máy chủ trả dữ liệu lịch sử đầu tư không hợp lệ');
  const value = payload as Record<string, unknown>;
  if (!Array.isArray(value.cashflows)) throw new Error('Máy chủ chưa trả danh sách dòng tiền hợp lệ');
  const cashflows: InvestmentCashflow[] = value.cashflows.flatMap((row): InvestmentCashflow[] => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const amountVnd = item.amountVnd ?? item.amount_vnd;
    const occurredAt = item.occurredAt ?? item.occurred_at;
    if (typeof item.id !== 'string' || (item.type !== 'contribution' && item.type !== 'withdrawal') ||
        typeof amountVnd !== 'number' || !Number.isFinite(amountVnd) ||
        typeof occurredAt !== 'string') return [];
    return [{ id: item.id, type: item.type, amountVnd, occurredAt,
      note: typeof item.note === 'string' ? item.note : null }];
  });
  if (cashflows.length !== value.cashflows.length) throw new Error('Máy chủ trả một hoặc nhiều dòng lịch sử không hợp lệ');
  const rawXirr = value.xirr;
  let xirr: InvestmentCashflowsResponse['xirr'] = null;
  if (rawXirr && typeof rawXirr === 'object') {
    const result = rawXirr as Record<string, unknown>;
    xirr = {
      rate: typeof result.rate === 'number' && Number.isFinite(result.rate) ? result.rate : null,
      annualizedPct: typeof result.annualizedPct === 'number' && Number.isFinite(result.annualizedPct) ? result.annualizedPct : null,
      reasonCode: typeof result.reasonCode === 'string' ? result.reasonCode : null,
      message: typeof result.message === 'string' ? result.message : null,
      terminalValueVnd: typeof result.terminalValueVnd === 'number' ? result.terminalValueVnd : null,
      valuationDate: typeof result.valuationDate === 'string' ? result.valuationDate : null,
      priceAsOfOldest: typeof result.priceAsOfOldest === 'string' ? result.priceAsOfOldest : null
    };
  }
  return {
    cashflows,
    historyCompleteFrom: typeof value.historyCompleteFrom === 'string' ? value.historyCompleteFrom : null,
    xirr
  };
}

export async function getInvestmentCashflows(): Promise<InvestmentCashflowsResponse> {
  return parseInvestmentCashflowsResponse(await apiRequestJson(endpoint));
}

export async function addInvestmentCashflow(input: Omit<InvestmentCashflow, 'id'>): Promise<void> {
  await apiRequestJson(endpoint, { method: 'POST', body: input });
}

export async function setInvestmentHistoryCompleteFrom(completeFrom: string): Promise<void> {
  await apiRequestJson(`${endpoint}/completeness`, { method: 'PUT', body: { completeFrom } });
}

export async function deleteInvestmentCashflow(id: string): Promise<void> {
  await apiRequestJson(`${endpoint}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
