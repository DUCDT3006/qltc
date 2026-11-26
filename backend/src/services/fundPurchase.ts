export interface FundPurchaseLink {
  symbol: string;
  holdingId: string;
  quantity: number | null;
  unitPrice: number | null;
  alreadyRecorded: boolean;
}

export function addFundPurchase(oldQuantity: number, oldAverage: number, quantity: number, unitPrice: number) {
  const nextQuantity = oldQuantity + quantity;
  const totalCost = (oldQuantity > 0 ? oldQuantity * oldAverage : 0) + quantity * unitPrice;
  if (!Number.isFinite(oldQuantity) || oldQuantity < 0 ||
      (oldQuantity > 0 && (!Number.isFinite(oldAverage) || oldAverage <= 0)) ||
      !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice <= 0 ||
      !Number.isFinite(nextQuantity) || nextQuantity <= oldQuantity || totalCost <= 0 || !Number.isSafeInteger(Math.round(totalCost))) return null;
  return { quantity: nextQuantity, avgCost: totalCost / nextQuantity };
}

export function parseFundPurchaseLink(value: unknown): FundPurchaseLink | null {
  if (typeof value !== 'string') return null;
  try {
    const link = JSON.parse(value);
    if (typeof link?.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,23}$/.test(link.symbol) ||
        typeof link.holdingId !== 'string' || !link.holdingId || typeof link.alreadyRecorded !== 'boolean') return null;
    if (link.alreadyRecorded && link.quantity === null && link.unitPrice === null) return link;
    if (typeof link.quantity === 'number' && Number.isFinite(link.quantity) && link.quantity > 0 &&
        typeof link.unitPrice === 'number' && Number.isFinite(link.unitPrice) && link.unitPrice > 0) return link;
  } catch { /* Malformed metadata is not used for investment recognition. */ }
  return null;
}
