import type { FmarketFund, Holding, Transaction } from '../types';

export interface NotificationFund {
  symbol: string;
  name: string;
  holding?: Holding;
}

/** Use a complete ticker token, never a substring of an account number or another ticker. */
export function detectNotificationFund(tx: Transaction, catalog: FmarketFund[], holdings: Holding[]): NotificationFund | null {
  if (tx.status !== 'pending' || tx.type !== 'expense' || tx.fundPurchase) return null;
  const candidates = new Map<string, string>();
  for (const fund of catalog) candidates.set(fund.shortName.toUpperCase(), fund.name);
  for (const holding of holdings) {
    if (holding.assetClass === 'fund') candidates.set(holding.symbol.toUpperCase(), holding.name);
  }
  const content = `${tx.description} ${tx.rawQuote || ''}`.normalize('NFC').toUpperCase();
  const matches: NotificationFund[] = [];
  for (const [symbol, name] of candidates) {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?:^|[^A-Z0-9])${escaped}(?![A-Z0-9])`).test(content)) {
      const owned = holdings.filter(holding => holding.assetClass === 'fund' && holding.symbol.toUpperCase() === symbol);
      if (owned.length > 1) return null;
      matches.push({ symbol, name, holding: owned[0] });
    }
  }
  return matches.length === 1 ? matches[0] : null;
}
