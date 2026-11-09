import { ParsedTransaction } from '../types';

/**
 * Generates a unique SHA-256 hash for a parsed transaction to prevent duplicates.
 * Includes userId, bankCode, accountNumberMask, type, amount, balanceAfter (even when 0!),
 * externalRef (when available), or 5-minute time bucket + normalized description.
 */
export async function generateDedupeHash(userId: string, parsed: ParsedTransaction): Promise<string> {
  const dateObj = new Date(parsed.occurredAt);
  const timeBucket = isNaN(dateObj.getTime())
    ? parsed.occurredAt
    : Math.floor(dateObj.getTime() / (1000 * 60 * 5));

  const cleanDesc = parsed.description
    .toLowerCase()
    .replace(/\s+/g, '')
    .slice(0, 40);

  const balancePart =
    parsed.balanceAfter !== undefined && parsed.balanceAfter !== null
      ? `_BAL${parsed.balanceAfter}`
      : '';
  const refPart = parsed.externalRef ? `_REF${parsed.externalRef.toUpperCase()}` : '';

  const rawString = `${userId}_${parsed.bankCode || 'UNK'}_${parsed.accountNumberMask || '0000'}_${parsed.type}_${parsed.amount}_${timeBucket}${balancePart}${refPart}_${cleanDesc}`;

  const msgBuffer = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}
