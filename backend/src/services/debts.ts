import { isValidVndAmount } from './ledger';

export const debtTable = `CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  creditor TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'payable' CHECK(kind IN ('payable','receivable')),
  principal_vnd INTEGER NOT NULL CHECK(principal_vnd >= 0),
  charges_vnd INTEGER NOT NULL DEFAULT 0 CHECK(charges_vnd >= 0),
  due_on TEXT,
  due_vnd INTEGER NOT NULL DEFAULT 0 CHECK(due_vnd >= 0),
  collateral_holding_id TEXT REFERENCES holdings(id) ON DELETE SET NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

export const debtPaymentTable = `CREATE TABLE IF NOT EXISTS debt_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  bank_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  interest_transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  principal_vnd INTEGER NOT NULL CHECK(principal_vnd >= 0),
  charges_vnd INTEGER NOT NULL CHECK(charges_vnd >= 0),
  charges_reduced_vnd INTEGER NOT NULL CHECK(charges_reduced_vnd >= 0 AND charges_reduced_vnd <= charges_vnd),
  debt_revision_after INTEGER NOT NULL,
  account_revision_after INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at TEXT
)`;

export const isRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
export const isOperationId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value);
const isNonnegativeVnd = (value: unknown): value is number => value === 0 || (typeof value === 'number' && isValidVndAmount(value));
const isDueDate = (date: unknown): date is string => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 150;

export function parseDebtFields(value: any) {
  const { name, creditor = '', kind, principalVnd, chargesVnd = 0, dueOn = null, dueVnd = 0, collateralHoldingId = null } = value || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100 || typeof creditor !== 'string' || creditor.trim().length > 100 ||
      (kind !== undefined && kind !== 'payable' && kind !== 'receivable') ||
      !isNonnegativeVnd(principalVnd) || !isNonnegativeVnd(chargesVnd) || !isNonnegativeVnd(principalVnd + chargesVnd) ||
      !isNonnegativeVnd(dueVnd) || (dueOn !== null && !isDueDate(dueOn)) || (dueVnd > 0 && !dueOn) ||
      (kind === 'receivable' && (chargesVnd !== 0 || collateralHoldingId !== null)) ||
      (collateralHoldingId !== null && !validId(collateralHoldingId))) return null;
  return { name: name.trim(), creditor: creditor.trim(), principalVnd, chargesVnd, dueOn, dueVnd, collateralHoldingId,
    ...(kind === undefined ? {} : { kind: kind as 'payable' | 'receivable' }) };
}

export function parseDebtPayment(value: any) {
  const { accountId, principalVnd, chargesVnd, transactionId = null, expectedTransactionRevision = null, expectedRevision, operationId, type } = value || {};
  if (!validId(accountId) || accountId === 'acc_unassigned' || !isNonnegativeVnd(principalVnd) || !isNonnegativeVnd(chargesVnd) ||
      !isValidVndAmount(principalVnd + chargesVnd) || !isRevision(expectedRevision) || !isOperationId(operationId) ||
      (type !== undefined && (type !== 'income' || !transactionId || chargesVnd !== 0)) ||
      (transactionId === null ? expectedTransactionRevision !== null : !validId(transactionId) || !isRevision(expectedTransactionRevision))) return null;
  return { accountId, principalVnd, chargesVnd, totalVnd: principalVnd + chargesVnd, transactionId, expectedTransactionRevision, expectedRevision, operationId,
    ...(type === 'income' ? { type: 'income' as const } : {}) };
}
