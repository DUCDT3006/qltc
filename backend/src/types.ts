// QLTC V2 Data Contracts & Types
// Theo đặc tả tối ưu V2.md

export type UserRole = 'owner' | 'device';

export interface AuthPrincipal {
  userId: string;
  role: UserRole;
  deviceId?: string;
}

export type Bindings = {
  DB: D1Database;
  AI?: any;
  KV?: KVNamespace;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  OWNER_API_TOKEN?: string;
  FRONTEND_ORIGIN?: string;
};

export interface ParsedTransaction {
  type: 'income' | 'expense';
  amount: number;
  accountNumberMask?: string;
  bankCode: string;
  occurredAt: string;
  timeSource?: 'override' | 'notification_text' | 'server_received' | 'notification';
  description: string;
  balanceAfter?: number;
  externalRef?: string;
  parseStatus?: 'parsed' | 'ambiguous';
  reasonCode?: string;
}

export type PeriodMode = 'month' | 'quarter' | 'year' | 'custom' | 'all';

export interface PeriodContext {
  mode: PeriodMode;
  timeZone: 'Asia/Ho_Chi_Minh';
  fromInclusiveUtc: string | null;
  toExclusiveUtc: string | null;
  label: string;
}

export interface MutationAck {
  operationId: string;
  applied: boolean;
  replayed: boolean;
  entityIds: string[];
  revisions: Record<string, number>;
  dataRevision: number;
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'REVISION_CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ACCOUNT_NOT_FOUND'
  | 'RETRYABLE_ERROR';

export interface ApiErrorResponse {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export type CadenceType = 'monthly' | 'weekly' | 'quarterly' | 'semiannual' | 'annual' | 'one_time';

export interface PlanVersion {
  id: string;
  userId: string;
  type: 'income' | 'expense' | 'jar_budget';
  ownerId: string;
  amountVnd: number;
  cadence: CadenceType;
  effectiveFromMonth: string; // 'YYYY-MM'
  effectiveToMonthExclusive: string | null; // 'YYYY-MM' or null if open-ended
  oneTimeDate?: string | null; // 'YYYY-MM-DD'
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  userId: string;
  deviceName: string;
  tokenHash: string;
  status: 'active' | 'revoked';
  createdAt: string;
  revokedAt?: string | null;
}

export interface LedgerPosting {
  id: string;
  userId: string;
  operationId: string;
  accountId: string;
  transactionId?: string | null;
  deltaVnd: number;
  createdAt: string;
}

export interface MutationReceipt {
  userId: string;
  operationId: string;
  payloadHash: string;
  ackJson: string;
  createdAt: string;
}
