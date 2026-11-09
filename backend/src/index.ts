import { Hono } from 'hono';
import { Bindings, AuthPrincipal, PlanVersion } from './types';
import {
  parseBankNotification,
  isOtpNotification,
  redactOtp,
  canonicalizeOccurredAt,
  normalizeNotificationText
} from './services/parser';
import { generateDedupeHash } from './services/dedupe';
import { categorizeTransaction } from './services/rules';
import {
  calculateBalanceDelta,
  allocateVndLargestRemainder,
  validateAllocationWeights,
  isValidVndAmount,
  hashPayload,
  LedgerTxState
} from './services/ledger';
import {
  resolveAuthPrincipal,
  isAuthorizedRole,
  sha256Hex,
  generateRandomToken,
  generatePairCode,
  OWNER_SESSION_COOKIE,
  OWNER_SESSION_TTL_SECONDS,
  hasOwnerSessionCookie,
  isAllowedSessionMutationOrigin,
  readOwnerSessionCookie
} from './services/auth';
import { matchAccountForNotification, AccountCandidate } from './services/accountMatcher';
import { calculateXIRR } from './services/xirr';

export const app = new Hono<{
  Bindings: Bindings;
  Variables: { principal: AuthPrincipal };
}>();

const BUNDLED_DEFAULTS = {
  jars: [
    { id: 'jar_nec', name: 'Chi tiêu thiết yếu', icon: 'home', color: '#3B82F6', target_percent: 0.55, sort_order: 1 },
    { id: 'jar_ltss', name: 'Tiết kiệm dài hạn', icon: 'savings', color: '#10B981', target_percent: 0.10, sort_order: 2 },
    { id: 'jar_edu', name: 'Giáo dục & Phát triển', icon: 'school', color: '#8B5CF6', target_percent: 0.10, sort_order: 3 },
    { id: 'jar_play', name: 'Hưởng thụ', icon: 'Attractions', color: '#F59E0B', target_percent: 0.10, sort_order: 4 },
    { id: 'jar_ffa', name: 'Tự do tài chính', icon: 'trending_up', color: '#EC4899', target_percent: 0.10, sort_order: 5 },
    { id: 'jar_give', name: 'Cho đi', icon: 'volunteer_activism', color: '#EF4444', target_percent: 0.05, sort_order: 6 }
  ],
  accounts: [
    { id: 'acc_vcb', name: 'Vietcombank', type: 'bank', balance: 45000000, mask: '8899' },
    { id: 'acc_tcb', name: 'Techcombank', type: 'bank', balance: 12500000, mask: '1234' },
    { id: 'acc_momo', name: 'Ví MoMo', type: 'ewallet', balance: 2300000, mask: '9999' },
    { id: 'acc_cash', name: 'Tiền mặt', type: 'cash', balance: 1500000, mask: null }
  ],
  rules: [
    { id: 'rule_grab', field: 'description', type: 'contains', pattern: 'GRAB', action: 'assign_jar', target: 'jar_nec' },
    { id: 'rule_highlands', field: 'description', type: 'contains', pattern: 'HIGHLANDS', action: 'assign_jar', target: 'jar_play' },
    { id: 'rule_salary', field: 'description', type: 'contains', pattern: 'LUONG', action: 'assign_income', target: 'inc_salary' }
  ]
};

export async function getMutationReceipt(
  db: D1Database,
  operationId: string | undefined,
  userId: string,
  endpoint: string,
  payload: unknown
): Promise<{ conflict?: boolean; cachedResponse?: any; statusCode?: number; payloadHash?: string }> {
  if (!operationId) return {};
  const payloadHash = await hashPayload(payload);
  const primaryDb = ((db as any).withSession?.('first-primary') || db) as D1Database;
  const existing = await primaryDb
    .prepare('SELECT endpoint, payload_hash, status_code, response_json FROM mutation_receipts WHERE operation_id = ? AND user_id = ?')
    .bind(operationId, userId)
    .first<any>();
  if (existing) {
    if (existing.endpoint !== endpoint || existing.payload_hash !== payloadHash) {
      return { conflict: true, payloadHash };
    }
    return {
      cachedResponse: JSON.parse(existing.response_json),
      statusCode: existing.status_code,
      payloadHash
    };
  }
  return { payloadHash };
}

export function buildMutationReceiptStatement(
  db: D1Database,
  operationId: string | undefined,
  userId: string,
  endpoint: string,
  payloadHash: string | undefined,
  statusCode: number,
  responseBody: any
): D1PreparedStatement | null {
  if (!operationId || !payloadHash) return null;
  return db
    .prepare(
      `INSERT INTO mutation_receipts (operation_id, user_id, endpoint, payload_hash, status_code, response_json)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(operationId, userId, endpoint, payloadHash, statusCode, JSON.stringify(responseBody));
}

/**
 * Builds atomic SQL statements for a single account balance change + ledger posting.
 * Must be executed inside db.batch() junto with the transaction mutation.
 */
export function buildLedgerDeltaStatements(
  db: D1Database,
  userId: string,
  accountId: string,
  deltaVnd: number,
  reason: string,
  operationId: string,
  transactionId: string | null = null
): D1PreparedStatement[] {
  if (!accountId || deltaVnd === 0) return [];
  const postingId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return [
    db
      .prepare('UPDATE accounts SET balance = balance + ?, revision = COALESCE(revision, 1) + 1 WHERE id = ? AND user_id = ?')
      .bind(deltaVnd, accountId, userId),
    db
      .prepare(
        `INSERT INTO ledger_postings (id, user_id, account_id, transaction_id, operation_id, delta_vnd, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(postingId, userId, accountId, transactionId, operationId, deltaVnd, reason)
  ];
}

/**
 * Builds an atomic precondition assertion statement for db.batch().
 * If the SQL scalar condition evaluates to 0, CHECK (ok = 1) fails and rolls back the entire batch!
 */
export function buildBatchAssertion(db: D1Database, selectOneIfValidSql: string, binds: any[]): D1PreparedStatement {
  return db
    .prepare(`INSERT INTO mutation_assertions (ok) SELECT CASE WHEN (${selectOneIfValidSql}) THEN 1 ELSE 0 END`)
    .bind(...binds);
}

/**
 * Helper to record a plan_versions snapshot whenever an income_source, planned_expense, or jar is created or updated.
 */
export async function buildPlanVersionStatements(
  db: D1Database,
  userId: string,
  entityType: 'income_source' | 'planned_expense' | 'jar',
  entityId: string,
  effectiveMonth: string,
  payload: Record<string, any>
): Promise<D1PreparedStatement[]> {
  const stmts: D1PreparedStatement[] = [];
  // Close any open version starting before effectiveMonth
  stmts.push(
    db
      .prepare(
        `UPDATE plan_versions
         SET effective_to_month_exclusive = ?
         WHERE user_id = ? AND entity_type = ? AND entity_id = ?
           AND effective_to_month_exclusive IS NULL
           AND effective_from_month < ?`
      )
      .bind(effectiveMonth, userId, entityType, entityId, effectiveMonth)
  );
  // Delete any version that started on or after effectiveMonth to replace cleanly
  stmts.push(
    db
      .prepare(
        `DELETE FROM plan_versions
         WHERE user_id = ? AND entity_type = ? AND entity_id = ?
           AND effective_from_month >= ?`
      )
      .bind(userId, entityType, entityId, effectiveMonth)
  );
  const versionId = `pv_${entityType}_${entityId}_${effectiveMonth}_${Math.random().toString(36).slice(2, 7)}`;
  stmts.push(
    db
      .prepare(
        `INSERT INTO plan_versions (id, user_id, entity_type, entity_id, effective_from_month, effective_to_month_exclusive, payload_json)
         VALUES (?, ?, ?, ?, ?, NULL, ?)`
      )
      .bind(versionId, userId, entityType, entityId, effectiveMonth, JSON.stringify(payload))
  );
  return stmts;
}

export function getCurrentVnMonth(dateInput?: string | Date): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const vnTime = new Date(d.getTime() + 7 * 3600 * 1000);
  const yyyy = vnTime.getUTCFullYear();
  const mm = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

function isValidIsoCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getCreatedVnMonth(createdAt: unknown): string | null {
  if (typeof createdAt !== 'string' || !createdAt.trim()) return null;
  const createdDate = new Date(createdAt);
  if (!Number.isFinite(createdDate.getTime())) return null;
  return getCurrentVnMonth(createdDate);
}

function historicalSeedMonth(createdAt: unknown, effectiveMonth: string): string | null {
  const createdMonth = getCreatedVnMonth(createdAt);
  if (!createdMonth) return null;
  return createdMonth < effectiveMonth ? createdMonth : null;
}

function encodeTransactionCursor(payload: { v: 1; occurredAt: string; id: string; revision: number; filterHash: string }): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeTransactionCursor(value: string): { occurredAt: string; id: string; revision: number; filterHash: string } | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    if (decoded?.v !== 1 || typeof decoded.occurredAt !== 'string' || typeof decoded.id !== 'string' ||
        !Number.isSafeInteger(decoded.revision) || typeof decoded.filterHash !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

let isSchemaEnsured = false;
let lastEnsuredDb: D1Database | null = null;

export function resetSchemaEnsureCache() {
  isSchemaEnsured = false;
  lastEnsuredDb = null;
}

export async function ensureDatabaseSchema(db: D1Database) {
  if (isSchemaEnsured && lastEnsuredDb === db) return;
  try {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT UNIQUE NOT NULL,
          name TEXT,
          phone TEXT,
          avatar TEXT,
          password_hash TEXT,
          history_hidden_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS devices (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_name TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          status TEXT NOT NULL DEFAULT 'active',
          scopes TEXT NOT NULL DEFAULT 'notifications:ingest',
          last_seen_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          revoked_at DATETIME
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS device_pair_codes (
          code TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_name TEXT NOT NULL DEFAULT 'Android Device',
          expires_at DATETIME NOT NULL,
          used_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db.prepare(
      `CREATE TABLE IF NOT EXISTS web_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked_at TEXT
      )`
    ).run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS mutation_assertions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ok INTEGER NOT NULL CHECK (ok = 1)
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          currency TEXT DEFAULT 'VND',
          balance INTEGER DEFAULT 0,
          account_number_mask TEXT,
          account_number TEXT,
          bank_code TEXT,
          bank_name TEXT,
          account_holder TEXT,
          branch TEXT,
          aliases_json TEXT,
          include_in_net_worth INTEGER DEFAULT 1,
          is_active INTEGER DEFAULT 1,
          archived_at DATETIME,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS jars (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          icon TEXT,
          color TEXT,
          target_percent REAL DEFAULT 0,
          monthly_limit INTEGER DEFAULT 0,
          rollover_enabled BOOLEAN DEFAULT 0,
          is_active INTEGER DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1,
          sort_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS income_sources (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          expected_amount INTEGER DEFAULT 0,
          cadence TEXT DEFAULT 'monthly',
          one_time_date TEXT,
          expected_day INTEGER,
          account_id TEXT,
          icon TEXT DEFAULT 'payments',
          color TEXT DEFAULT '#10B981',
          is_active INTEGER DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS planned_expenses (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          name TEXT NOT NULL,
          expected_amount INTEGER DEFAULT 0,
          cadence TEXT DEFAULT 'monthly',
          one_time_date TEXT,
          due_day INTEGER,
          jar_id TEXT,
          account_id TEXT,
          is_active INTEGER DEFAULT 1,
          revision INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS plan_versions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          effective_from_month TEXT NOT NULL,
          effective_to_month_exclusive TEXT,
          payload_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS raw_notifications (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          device_id TEXT,
          event_id TEXT,
          app_package TEXT NOT NULL,
          title TEXT,
          text TEXT NOT NULL,
          received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          original_time_value TEXT,
          time_source TEXT DEFAULT 'notification',
          parse_status TEXT DEFAULT 'pending',
          parse_error TEXT,
          raw_json TEXT
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          occurred_at DATETIME NOT NULL,
          time_source TEXT DEFAULT 'user_input',
          type TEXT NOT NULL,
          amount INTEGER NOT NULL,
          currency TEXT DEFAULT 'VND',
          account_id TEXT NOT NULL,
          to_account_id TEXT,
          jar_id TEXT,
          income_source_id TEXT,
          planned_expense_id TEXT,
          status TEXT DEFAULT 'pending',
          needs_account_review INTEGER DEFAULT 0,
          source TEXT DEFAULT 'manual',
          description TEXT,
          counterparty TEXT,
          raw_notification_id TEXT,
          dedupe_hash TEXT UNIQUE,
          transfer_pair_id TEXT,
          suggested_pair_id TEXT,
          is_synthetic INTEGER DEFAULT 0,
          original_type TEXT,
          original_account_id TEXT,
          original_jar_id TEXT,
          original_income_source_id TEXT,
          original_description TEXT,
          original_status TEXT,
          history_hidden INTEGER NOT NULL DEFAULT 0,
          revision INTEGER NOT NULL DEFAULT 1,
          deleted_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ledger_baselines (
          account_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          baseline_amount_vnd INTEGER NOT NULL DEFAULT 0,
          baseline_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          note TEXT
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS ledger_postings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          account_id TEXT NOT NULL,
          transaction_id TEXT,
          operation_id TEXT NOT NULL,
          delta_vnd INTEGER NOT NULL,
          reason TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS mutation_receipts (
          operation_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          endpoint TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          status_code INTEGER NOT NULL,
          response_json TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          priority INTEGER DEFAULT 1,
          match_field TEXT NOT NULL,
          match_type TEXT NOT NULL,
          pattern TEXT NOT NULL,
          action_type TEXT NOT NULL,
          target_id TEXT,
          confidence REAL DEFAULT 1.0,
          is_active BOOLEAN DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY,
          symbol TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          asset_class TEXT NOT NULL,
          unit TEXT NOT NULL,
          quote_unit TEXT,
          provider TEXT,
          currency TEXT DEFAULT 'VND',
          current_price REAL DEFAULT 0,
          price_as_of DATETIME,
          sync_status TEXT DEFAULT 'ok',
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS holdings (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          account_id TEXT,
          quantity REAL NOT NULL DEFAULT 0,
          holding_unit TEXT,
          avg_cost REAL NOT NULL DEFAULT 0,
          note TEXT,
          revision INTEGER NOT NULL DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS investment_transactions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          account_id TEXT,
          type TEXT NOT NULL,
          occurred_at DATETIME NOT NULL,
          quantity REAL NOT NULL,
          unit_price REAL NOT NULL,
          fee INTEGER DEFAULT 0,
          tax INTEGER DEFAULT 0,
          total_amount_vnd INTEGER NOT NULL,
          linked_transaction_id TEXT,
          operation_id TEXT UNIQUE,
          note TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      )
      .run();

    await db.prepare(`CREATE TABLE IF NOT EXISTS investment_cashflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('contribution', 'withdrawal')),
      amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
      occurred_at TEXT NOT NULL,
      note TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_investment_cashflows_user_date
      ON investment_cashflows(user_id, occurred_at)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS investment_cashflow_settings (
      user_id TEXT PRIMARY KEY,
      complete_from TEXT NOT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`).run();

    const alterColumns = [
      'ALTER TABLE transactions ADD COLUMN transfer_pair_id TEXT',
      'ALTER TABLE transactions ADD COLUMN suggested_pair_id TEXT',
      'ALTER TABLE transactions ADD COLUMN original_type TEXT',
      'ALTER TABLE transactions ADD COLUMN original_account_id TEXT',
      'ALTER TABLE transactions ADD COLUMN original_jar_id TEXT',
      'ALTER TABLE transactions ADD COLUMN original_income_source_id TEXT',
      'ALTER TABLE transactions ADD COLUMN original_description TEXT',
      'ALTER TABLE transactions ADD COLUMN original_status TEXT',
      'ALTER TABLE transactions ADD COLUMN history_hidden INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE transactions ADD COLUMN needs_account_review INTEGER DEFAULT 0',
      'ALTER TABLE transactions ADD COLUMN time_source TEXT DEFAULT "user_input"',
      'ALTER TABLE transactions ADD COLUMN is_synthetic INTEGER DEFAULT 0',
      'ALTER TABLE transactions ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE transactions ADD COLUMN deleted_at DATETIME',
      'ALTER TABLE transactions ADD COLUMN updated_at DATETIME',
      'ALTER TABLE income_sources ADD COLUMN icon TEXT DEFAULT "payments"',
      'ALTER TABLE income_sources ADD COLUMN color TEXT DEFAULT "#10B981"',
      'ALTER TABLE income_sources ADD COLUMN one_time_date TEXT',
      'ALTER TABLE income_sources ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE income_sources ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE planned_expenses ADD COLUMN one_time_date TEXT',
      'ALTER TABLE planned_expenses ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE planned_expenses ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE jars ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE jars ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE accounts ADD COLUMN account_number TEXT',
      'ALTER TABLE accounts ADD COLUMN bank_code TEXT',
      'ALTER TABLE accounts ADD COLUMN bank_name TEXT',
      'ALTER TABLE accounts ADD COLUMN account_holder TEXT',
      'ALTER TABLE accounts ADD COLUMN branch TEXT',
      'ALTER TABLE accounts ADD COLUMN aliases_json TEXT',
      'ALTER TABLE accounts ADD COLUMN include_in_net_worth INTEGER DEFAULT 1',
      'ALTER TABLE accounts ADD COLUMN is_active INTEGER DEFAULT 1',
      'ALTER TABLE accounts ADD COLUMN archived_at DATETIME',
      'ALTER TABLE accounts ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE raw_notifications ADD COLUMN device_id TEXT',
      'ALTER TABLE raw_notifications ADD COLUMN event_id TEXT',
      'ALTER TABLE raw_notifications ADD COLUMN original_time_value TEXT',
      'ALTER TABLE raw_notifications ADD COLUMN time_source TEXT DEFAULT "notification"',
      'ALTER TABLE assets ADD COLUMN quote_unit TEXT',
      'ALTER TABLE assets ADD COLUMN provider TEXT',
      'ALTER TABLE assets ADD COLUMN price_as_of DATETIME',
      'ALTER TABLE assets ADD COLUMN sync_status TEXT DEFAULT "ok"',
      'ALTER TABLE holdings ADD COLUMN account_id TEXT',
      'ALTER TABLE holdings ADD COLUMN holding_unit TEXT',
      'ALTER TABLE holdings ADD COLUMN revision INTEGER DEFAULT 1',
      'ALTER TABLE users ADD COLUMN history_hidden_at DATETIME',
      'ALTER TABLE users ADD COLUMN phone TEXT',
      'ALTER TABLE users ADD COLUMN avatar TEXT'
    ];

    for (const sql of alterColumns) {
      try {
        await db.prepare(sql).run();
      } catch (error: any) {
        if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
      }
    }

    await db.prepare(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
    const historyMigration = await db.prepare("SELECT id FROM schema_migrations WHERE id = 'legacy_history_hidden_cutover_v1'").first<any>();
    if (!historyMigration) {
      await db.batch([
        db.prepare(`UPDATE transactions SET history_hidden = 1
          WHERE history_hidden = 0 AND user_id IN (SELECT id FROM users WHERE history_hidden_at IS NOT NULL)
            AND datetime(created_at) <= (SELECT datetime(history_hidden_at) FROM users WHERE users.id = transactions.user_id)`),
        db.prepare("INSERT INTO schema_migrations (id) VALUES ('legacy_history_hidden_cutover_v1')")
      ]);
    }

    // Create unique indexes safely
    const indexSqls = [
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_notifications_event ON raw_notifications(user_id, device_id, event_id) WHERE event_id IS NOT NULL',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_raw_notif_primary ON transactions(raw_notification_id) WHERE raw_notification_id IS NOT NULL AND is_synthetic = 0',
      'CREATE INDEX IF NOT EXISTS idx_ledger_postings_account ON ledger_postings(user_id, account_id, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_plan_versions_lookup ON plan_versions(user_id, entity_type, effective_from_month)'
    ];
    for (const sql of indexSqls) {
      await db.prepare(sql).run();
    }

    // Seed default user if none exists
    await db
      .prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)')
      .bind('user_default', 'admin@qltc.local', 'Chủ tài khoản')
      .run();

    await db.prepare(`CREATE TABLE IF NOT EXISTS user_data_revisions (
      user_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL DEFAULT 0,
      plan_revision INTEGER NOT NULL DEFAULT 0
    )`).run();
    try {
      await db.prepare('ALTER TABLE user_data_revisions ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0').run();
    } catch (error: any) {
      if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
    }
    const revisionTriggers = [
      ...['transactions', 'accounts', 'jars', 'income_sources', 'raw_notifications'].flatMap((table) => {
        const bump = (userExpr: string) => `INSERT INTO user_data_revisions (user_id, revision) VALUES (${userExpr}, 1)
          ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;`;
        return [
          `CREATE TRIGGER IF NOT EXISTS trg_revision_${table}_insert AFTER INSERT ON ${table} BEGIN ${bump('NEW.user_id')} END`,
          `CREATE TRIGGER IF NOT EXISTS trg_revision_${table}_update AFTER UPDATE ON ${table} BEGIN ${bump('NEW.user_id')} END`,
          `CREATE TRIGGER IF NOT EXISTS trg_revision_${table}_delete AFTER DELETE ON ${table} BEGIN ${bump('OLD.user_id')} END`
        ];
      }),
      `CREATE TRIGGER IF NOT EXISTS trg_revision_users_update AFTER UPDATE ON users BEGIN
        INSERT INTO user_data_revisions (user_id, revision) VALUES (NEW.id, 1)
        ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1;
      END`
    ];
    for (const sql of revisionTriggers) await db.prepare(sql).run();
    const planRevisionMigration = await db.prepare("SELECT id FROM schema_migrations WHERE id = 'plan_revision_triggers_v1'").first<any>();
    if (!planRevisionMigration) {
      for (const table of ['planned_expenses', 'plan_versions']) {
        for (const action of ['insert', 'update', 'delete']) {
          await db.prepare(`DROP TRIGGER IF EXISTS trg_revision_${table}_${action}`).run();
        }
        const planBump = (userExpr: string) => `INSERT INTO user_data_revisions (user_id, revision, plan_revision) VALUES (${userExpr}, 1, 1)
          ON CONFLICT(user_id) DO UPDATE SET revision = revision + 1, plan_revision = plan_revision + 1;`;
        await db.prepare(`CREATE TRIGGER trg_revision_${table}_insert AFTER INSERT ON ${table} BEGIN ${planBump('NEW.user_id')} END`).run();
        await db.prepare(`CREATE TRIGGER trg_revision_${table}_update AFTER UPDATE ON ${table} BEGIN ${planBump('NEW.user_id')} END`).run();
        await db.prepare(`CREATE TRIGGER trg_revision_${table}_delete AFTER DELETE ON ${table} BEGIN ${planBump('OLD.user_id')} END`).run();
      }
      await db.prepare("INSERT INTO schema_migrations (id) VALUES ('plan_revision_triggers_v1')").run();
    }

    isSchemaEnsured = true;
    lastEnsuredDb = db;
  } catch (error) {
    isSchemaEnsured = false;
    lastEnsuredDb = null;
    throw error;
  }
}

// Browser origins are a deployment allowlist; native clients do not send Origin.
app.use('*', async (c, next) => {
  const origin = c.req.header('Origin');
  const configuredOrigins = String((c.env as any)?.ALLOWED_ORIGINS || '')
    .split(',').map((value) => value.trim()).filter(Boolean);
  const allowedOrigins = new Set([
    'https://qltc-app.dtd-store.workers.dev',
    'https://qltc-canhan.pages.dev',
    String((c.env as any)?.FRONTEND_ORIGIN || '').trim(),
    ...configuredOrigins
  ].filter(Boolean));
  if (origin && !allowedOrigins.has(origin)) {
    return c.json({ error: 'Origin không được cho phép', code: 'ORIGIN_FORBIDDEN' }, 403);
  }
  if (origin) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    c.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, X-Device-Token, X-Owner-Token, X-Operation-Id, Cf-Access-Authenticated-User-Email, Cf-Access-Jwt-Assertion'
    );
  }
  if (c.req.method === 'OPTIONS') {
    return c.newResponse(null, 204);
  }
  if (c.env?.DB) {
    try {
      await ensureDatabaseSchema(c.env.DB);
    } catch (error) {
      console.error('Database schema ensure failed:', error);
      return c.json({ error: 'Database schema is unavailable', code: 'SCHEMA_UNAVAILABLE' }, 503);
    }
  }
  await next();
});

// V2-01 Strict Authentication & Role Authorization Middleware
const PUBLIC_PATHS = new Set([
  '/',
  '/api/health',
  '/api/version',
  '/api/download-apk',
  '/api/auth/pair-exchange',
  '/api/auth/login'
]);

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (PUBLIC_PATHS.has(path)) {
    return next();
  }

  const sessionCookiePresent = hasOwnerSessionCookie(c);
  if (sessionCookiePresent && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && !isAllowedSessionMutationOrigin(c)) {
    return c.json({ error: 'Nguồn yêu cầu không hợp lệ', code: 'CSRF_ORIGIN_REJECTED' }, 403);
  }

  const principal = await resolveAuthPrincipal(c);
  if (!principal) {
    return c.json(
      {
        error: 'Unauthorized: Vui lòng đăng nhập hoặc cung cấp token xác thực hợp lệ.',
        code: 'UNAUTHORIZED'
      },
      401
    );
  }

  // Device role is strictly restricted to notification ingest
  const isDeviceIngestRoute = path === '/api/notifications/ingest' && c.req.method === 'POST';
  if (principal.role === 'device' && !isDeviceIngestRoute) {
    return c.json(
      {
        error: 'Forbidden: Thiết bị chỉ có quyền gửi thông báo (notifications:ingest), không có quyền truy cập dữ liệu tài chính hoặc quản trị.',
        code: 'FORBIDDEN'
      },
      403
    );
  }

  c.set('principal', principal);
  await next();
});

// Health & Public Endpoints
app.get('/', (c) => c.text('QLTC Ca Nhan API is running!'));

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    version: '2.0.0',
    timestamp: new Date().toISOString()
  })
);

app.get('/api/version', (c) => {
  return c.json({
    versionCode: 23,
    versionName: '2.0.1',
    version: '2.0.1',
    latestApkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v2.0.1/qltc-v2.0.1.apk',
    downloadUrl: 'https://qltc-backend.dtd-store.workers.dev/api/download-apk',
    changelog:
      'Các thay đổi đáng chú ý:\n\n' +
      '• Sửa lỗi khởi chạy ứng dụng Android: Chạy ngầm tiến trình khởi tạo, app mở tức thì và ổn định 100% trên mọi dòng máy.\n' +
      '• Sửa xác thực: bỏ token mặc định, kiểm tra JWT Cloudflare Access và dùng phiên HttpOnly qua Worker cùng nguồn.\n' +
      '• Sửa ghi sổ để yêu cầu trùng operationId chỉ tác động số dư một lần; tách reset nguồn thu để giữ khoản chi dự kiến, hũ và giao dịch.\n' +
      '• Bổ sung phân trang có phát hiện dữ liệu thay đổi, xử lý kế hoạch theo kỳ và ngày của khoản “Một lần”.\n' +
      '• Bổ sung kiểm tra checksum, liên kết dữ liệu và bước xem trước khi khôi phục sao lưu.\n' +
      '• Nối lại nguồn dữ liệu quỹ; thêm lịch sử góp/rút để tính XIRR khi anh xác nhận dữ liệu đầy đủ. Trường hợp tiền tệ chưa được hỗ trợ sẽ không trả tỷ suất giả.\n' +
      '• Sửa một số luồng riêng tư, Back/Escape và focus của hộp thoại; Android có hàng đợi gửi lại bằng WorkManager.'
  });
});

app.get('/api/download-apk', (c) => {
  return c.redirect('https://github.com/DUCDT3006/qltc/releases/download/v2.0.1/qltc-v2.0.1.apk', 302);
});

// ============================================================================
// AUTH & DEVICE PAIRING ENDPOINTS (V2-01)
// ============================================================================

app.post('/api/auth/login', async (c) => {
  if (!isAllowedSessionMutationOrigin(c)) {
    return c.json({ error: 'Nguồn yêu cầu không hợp lệ', code: 'CSRF_ORIGIN_REJECTED' }, 403);
  }
  const body = await c.req.json().catch(() => ({}));
  const configuredToken = c.env.OWNER_API_TOKEN;
  if (!configuredToken) {
    return c.json({ error: 'OWNER_API_TOKEN chưa được cấu hình', code: 'AUTH_NOT_CONFIGURED' }, 503);
  }
  const passwordOrToken = body.token || body.password || '';
  if (passwordOrToken && passwordOrToken === configuredToken) {
    const sessionToken = generateRandomToken('qltc_web_');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OWNER_SESSION_TTL_SECONDS * 1000).toISOString();
    const sessionId = `web_${crypto.randomUUID()}`;
    await c.env.DB.prepare(
      `INSERT INTO web_sessions (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)`
    ).bind(sessionId, 'user_default', await sha256Hex(sessionToken), expiresAt).run();
    const response = c.json({
      success: true,
      role: 'owner',
      userId: 'user_default',
      expiresAt
    });
    response.headers.append('Set-Cookie', `${OWNER_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}; Path=/api; Max-Age=${OWNER_SESSION_TTL_SECONDS}; Expires=${new Date(expiresAt).toUTCString()}; HttpOnly; Secure; SameSite=Strict`);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  return c.json({ error: 'Thông tin xác thực không hợp lệ', code: 'UNAUTHORIZED' }, 401);
});

app.get('/api/auth/session', async (c) => {
  const principal = c.get('principal');
  return c.json({
    authenticated: true,
    userId: principal.userId,
    role: principal.role,
    deviceId: principal.deviceId || null
  });
});

app.post('/api/auth/logout', async (c) => {
  const sessionToken = readOwnerSessionCookie(c as any);
  if (sessionToken) {
    await c.env.DB.prepare('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), await sha256Hex(sessionToken)).run();
  }
  const response = c.json({ success: true });
  response.headers.append('Set-Cookie', `${OWNER_SESSION_COOKIE}=; Path=/api; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict`);
  response.headers.set('Cache-Control', 'no-store');
  return response;
});

app.post('/api/devices/pair-code', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const body = await c.req.json().catch(() => ({}));
  const deviceName = (body.deviceName || 'Android Listener').trim();
  const code = generatePairCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await db
    .prepare(
      `INSERT INTO device_pair_codes (code, user_id, device_name, expires_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(code, principal.userId, deviceName, expiresAt)
    .run();

  return c.json({
    success: true,
    code,
    deviceName,
    expiresAt
  });
});

app.post('/api/auth/pair-exchange', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  const deviceName = String(body.deviceName || '').trim();

  if (!code) {
    return c.json({ error: 'Thiếu mã ghép nối (code)', code: 'INVALID_PAIR_CODE' }, 400);
  }

  const pairRecord = await db
    .prepare('SELECT code, user_id, device_name, expires_at, used_at FROM device_pair_codes WHERE code = ? LIMIT 1')
    .bind(code)
    .first<{ code: string; user_id: string; device_name: string; expires_at: string; used_at: string | null }>();

  if (!pairRecord) {
    return c.json({ error: 'Mã ghép nối không tồn tại', code: 'INVALID_PAIR_CODE' }, 401);
  }
  if (pairRecord.used_at) {
    return c.json({ error: 'Mã ghép nối đã được sử dụng', code: 'PAIR_CODE_ALREADY_USED' }, 401);
  }
  if (new Date(pairRecord.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'Mã ghép nối đã hết hạn', code: 'PAIR_CODE_EXPIRED' }, 401);
  }

  const rawDeviceToken = generateRandomToken('qltc_dev_');
  const tokenHash = await sha256Hex(rawDeviceToken);
  const deviceId = body.deviceId ? String(body.deviceId).trim() : `dev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const finalDeviceName = deviceName || pairRecord.device_name || 'Android Listener';
  const nowIso = new Date().toISOString();

  await db.batch([
    db
      .prepare('UPDATE device_pair_codes SET used_at = ? WHERE code = ? AND used_at IS NULL')
      .bind(nowIso, code),
    db
      .prepare(
        `INSERT OR REPLACE INTO devices (id, user_id, device_name, token_hash, status, scopes, last_seen_at, created_at, revoked_at)
         VALUES (?, ?, ?, ?, 'active', 'notifications:ingest', ?, ?, NULL)`
      )
      .bind(deviceId, pairRecord.user_id, finalDeviceName, tokenHash, nowIso, nowIso)
  ]);

  return c.json({
    success: true,
    deviceId,
    deviceName: finalDeviceName,
    deviceToken: rawDeviceToken,
    scopes: ['notifications:ingest']
  });
});

app.get('/api/devices', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const { results } = await db
    .prepare(
      `SELECT id, device_name, status, scopes, last_seen_at, created_at, revoked_at
       FROM devices
       WHERE user_id = ?
       ORDER BY created_at DESC`
    )
    .bind(principal.userId)
    .all<any>();

  // Also fetch latest notification received_at for listener health status (V2-26)
  const latestNotif = await db
    .prepare(
      `SELECT received_at, parse_status FROM raw_notifications WHERE user_id = ? ORDER BY received_at DESC LIMIT 1`
    )
    .bind(principal.userId)
    .first<any>();

  return c.json({
    devices: results || [],
    lastNotificationAt: latestNotif?.received_at || null,
    lastParseStatus: latestNotif?.parse_status || null
  });
});

app.post('/api/devices/:id/revoke', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const deviceId = c.req.param('id');
  const nowIso = new Date().toISOString();

  await db
    .prepare(`UPDATE devices SET status = 'revoked', revoked_at = ? WHERE id = ? AND user_id = ?`)
    .bind(nowIso, deviceId, principal.userId)
    .run();

  return c.json({ success: true, deviceId, status: 'revoked', revokedAt: nowIso });
});

// ============================================================================
// NOTIFICATION INGEST & REPROCESS ENDPOINTS (V2-03, V2-04, V2-05, V2-06, V2-10)
// ============================================================================

async function ensureUnassignedAccount(db: D1Database, userId: string): Promise<string> {
  const placeholderId = 'acc_unassigned';
  const existing = await db.prepare('SELECT id, user_id, type, balance, is_active, include_in_net_worth FROM accounts WHERE id = ? LIMIT 1')
    .bind(placeholderId).first<any>();
  if (existing) {
    if (existing.user_id !== userId || existing.type !== 'unassigned' || Number(existing.balance) !== 0 ||
        Number(existing.is_active) !== 0 || Number(existing.include_in_net_worth) !== 0) {
      throw new Error('Unassigned placeholder ID is occupied by an incompatible account');
    }
    return placeholderId;
  }
  await db.batch([
    db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, include_in_net_worth, is_active, revision)
      VALUES (?, ?, ?, 'unassigned', 0, 0, 0, 1)`).bind(placeholderId, userId, 'Chưa xác định tài khoản'),
    db.prepare(`INSERT INTO ledger_baselines (account_id, user_id, baseline_amount_vnd, note)
      VALUES (?, ?, 0, 'Unassigned placeholder')`).bind(placeholderId, userId)
  ]);
  return placeholderId;
}

async function processNotificationToTransaction(
  db: D1Database,
  userId: string,
  rawId: string,
  appPackage: string,
  title: string,
  text: string,
  occurredAtOverride?: string | number | null
): Promise<{
  status: 'created' | 'duplicate' | 'ignored_otp' | 'unparsed' | 'invalid_time';
  transactionId?: string;
  parseStatus: string;
  needsAccountReview?: boolean;
  suggestedPairId?: string | null;
  reasonCode?: string;
}> {
  if (isOtpNotification(title, text)) {
    await db
      .prepare('UPDATE raw_notifications SET parse_status = ?, parse_error = ? WHERE id = ?')
      .bind('ignored_otp', 'OTP/Verification message ignored', rawId)
      .run();
    return { status: 'ignored_otp', parseStatus: 'ignored_otp' };
  }

  // Validate override timestamp format before parsing (V2-05 / AT2-11)
  if (occurredAtOverride !== undefined && occurredAtOverride !== null && occurredAtOverride !== '') {
    const timeCheck = canonicalizeOccurredAt(occurredAtOverride, null);
    if (timeCheck.invalidOverride) {
      await db
        .prepare('UPDATE raw_notifications SET parse_status = ?, parse_error = ? WHERE id = ?')
        .bind('failed', 'INVALID_TIME_FORMAT', rawId)
        .run();
      return { status: 'invalid_time', parseStatus: 'failed', reasonCode: 'INVALID_TIME_FORMAT' };
    }
  }

  // Check if primary transaction already exists for this raw_notification_id (idempotent reprocess)
  const existingForRaw = await db
    .prepare(
      'SELECT id, status, needs_account_review, suggested_pair_id FROM transactions WHERE raw_notification_id = ? AND is_synthetic = 0 AND deleted_at IS NULL LIMIT 1'
    )
    .bind(rawId)
    .first<any>();
  if (existingForRaw) {
    return {
      status: 'duplicate',
      transactionId: existingForRaw.id,
      parseStatus: 'parsed',
      needsAccountReview: Boolean(existingForRaw.needs_account_review),
      suggestedPairId: existingForRaw.suggested_pair_id || null
    };
  }

  const parsed = parseBankNotification(appPackage, title, text, occurredAtOverride ?? undefined);
  if (!parsed) {
    await db
      .prepare('UPDATE raw_notifications SET parse_status = ?, parse_error = ? WHERE id = ?')
      .bind('ignored', 'Could not extract amount/type', rawId)
      .run();
    return { status: 'unparsed', parseStatus: 'ignored' };
  }

  // Generate Dedupe Hash
  const dedupeHash = await generateDedupeHash(userId, parsed);
  const existingByHash = await db
    .prepare('SELECT id, needs_account_review, suggested_pair_id FROM transactions WHERE dedupe_hash = ? AND deleted_at IS NULL LIMIT 1')
    .bind(dedupeHash)
    .first<any>();
  if (existingByHash) {
    await db
      .prepare('UPDATE raw_notifications SET parse_status = ?, parse_error = ? WHERE id = ?')
      .bind('ignored', 'Duplicate transaction hash', rawId)
      .run();
    return {
      status: 'duplicate',
      transactionId: existingByHash.id,
      parseStatus: 'ignored',
      needsAccountReview: Boolean(existingByHash.needs_account_review),
      suggestedPairId: existingByHash.suggested_pair_id || null
    };
  }

  // V2-03: Strict Account Matching via matchAccountForNotification
  const { results: accRows } = await db
    .prepare(
      `SELECT id, name, type, bank_code, bank_name, account_number, account_number_mask, aliases_json, is_active
       FROM accounts
       WHERE user_id = ?`
    )
    .bind(userId)
    .all<AccountCandidate>();

  const matchResult = matchAccountForNotification(accRows || [], parsed, title, text);
  let accountId = matchResult.accountId;
  let needsAccountReview = matchResult.needsAccountReview || parsed.parseStatus === 'ambiguous';

  if (!accountId) {
    // A real, inactive zero-balance row satisfies the schema FK without representing user money.
    accountId = await ensureUnassignedAccount(db, userId);
    needsAccountReview = true;
  }

  // Apply Categorization Rules
  const { results: dbRules } = await db
    .prepare('SELECT * FROM rules WHERE user_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY priority DESC, created_at DESC')
    .bind(userId)
    .all<any>();

  let finalType: string = parsed.type;
  let jarId: string | null = null;
  let incomeSourceId: string | null = null;
  let toAccountId: string | null = null;

  const upperDesc = normalizeNotificationText(parsed.description).toUpperCase();
  for (const r of dbRules || []) {
    const pat = normalizeNotificationText(r.pattern || '').toUpperCase();
    if (!pat) continue;
    if (upperDesc.includes(pat)) {
      if (r.action_type === 'assign_jar' || r.target_id?.startsWith('jar_')) {
        jarId = r.target_id || r.jar_id || null;
        break;
      } else if (r.action_type === 'assign_income' || r.target_id?.startsWith('inc_')) {
        incomeSourceId = r.target_id || null;
        break;
      } else if (r.action_type === 'mark_transfer' && r.target_id) {
        toAccountId = r.target_id;
        break;
      } else if (r.jar_id || r.jar_code) {
        jarId = r.jar_id || `jar_${String(r.jar_code).toLowerCase()}`;
        break;
      }
    }
  }

  if (!jarId && finalType === 'expense') {
    const cat = categorizeTransaction(parsed.description, 'expense');
    if (cat && cat.jarCode && cat.confidence >= 0.8) {
      const matchedJar = await db
        .prepare('SELECT id FROM jars WHERE user_id = ? AND (LOWER(id) = ? OR UPPER(name) LIKE ?) LIMIT 1')
        .bind(userId, `jar_${cat.jarCode.toLowerCase()}`, `%${cat.jarCode.toUpperCase()}%`)
        .first<{ id: string }>();
      if (matchedJar) {
        jarId = matchedJar.id;
      }
    }
  }

  // Smart matching against Income Sources / Planned Expenses if rules didn't match
  const normDesc = normalizeNotificationText(parsed.description).toLowerCase();
  if (finalType === 'income' && !incomeSourceId) {
    const { results: sources } = await db
      .prepare('SELECT id, name FROM income_sources WHERE user_id = ? AND COALESCE(is_active, 1) = 1')
      .bind(userId)
      .all<{ id: string; name: string }>();
    if (sources) {
      for (const s of sources) {
        const kw = normalizeNotificationText(s.name).toLowerCase();
        if (kw.length >= 3 && normDesc.includes(kw)) {
          incomeSourceId = s.id;
          break;
        }
      }
    }
  } else if (finalType === 'expense' && !jarId) {
    const { results: plans } = await db
      .prepare('SELECT id, name, jar_id FROM planned_expenses WHERE user_id = ? AND COALESCE(is_active, 1) = 1')
      .bind(userId)
      .all<{ id: string; name: string; jar_id: string }>();
    if (plans) {
      for (const p of plans) {
        const kw = normalizeNotificationText(p.name).toLowerCase();
        if (kw.length >= 3 && normDesc.includes(kw) && p.jar_id) {
          jarId = p.jar_id;
          break;
        }
      }
    }
    if (!jarId) {
      const { results: jarsList } = await db
        .prepare('SELECT id, name FROM jars WHERE user_id = ? AND COALESCE(is_active, 1) = 1')
        .bind(userId)
        .all<{ id: string; name: string }>();
      if (jarsList) {
        for (const j of jarsList) {
          const kw = normalizeNotificationText(j.name).toLowerCase();
          if (kw.length >= 3 && normDesc.includes(kw)) {
            jarId = j.id;
            break;
          }
        }
      }
    }
  }

  // V2-10: Weak Transfer Detection -> Only suggest (`suggested_pair_id`), NEVER auto-convert or hide!
  let suggestedPairId: string | null = null;
  if ((finalType === 'income' || finalType === 'expense') && !needsAccountReview) {
    const oppositeType = finalType === 'income' ? 'expense' : 'income';
    const candidate = await db
      .prepare(
        `SELECT id, account_id, description
         FROM transactions
         WHERE user_id = ?
           AND amount = ?
           AND type = ?
           AND account_id != ?
           AND status IN ('pending', 'confirmed')
           AND transfer_pair_id IS NULL
           AND deleted_at IS NULL
           AND ABS(strftime('%s', occurred_at) - strftime('%s', ?)) <= 7200
         ORDER BY occurred_at DESC
         LIMIT 1`
      )
      .bind(userId, parsed.amount, oppositeType, accountId, parsed.occurredAt)
      .first<{ id: string; account_id: string; description: string }>();

    if (candidate) {
      suggestedPairId = candidate.id;
    }
  }

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const finalParseStatus = parsed.parseStatus === 'ambiguous' ? 'ambiguous' : 'parsed';

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO transactions (
          id, user_id, occurred_at, time_source, type, amount, account_id, to_account_id,
          jar_id, income_source_id, status, needs_account_review, source, description,
          raw_notification_id, dedupe_hash, suggested_pair_id,
          original_type, original_account_id, original_jar_id, original_income_source_id, original_description, original_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'notification', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      )
      .bind(
        txId,
        userId,
        parsed.occurredAt,
        parsed.timeSource || 'notification',
        finalType,
        parsed.amount,
        accountId,
        toAccountId,
        jarId,
        incomeSourceId,
        needsAccountReview ? 1 : 0,
        parsed.description,
        rawId,
        dedupeHash,
        suggestedPairId,
        finalType,
        accountId,
        jarId,
        incomeSourceId,
        parsed.description
      ),
    db
      .prepare('UPDATE raw_notifications SET parse_status = ?, parse_error = ? WHERE id = ?')
      .bind(finalParseStatus, parsed.reasonCode || matchResult.reasonCode || null, rawId)
  ];

  if (suggestedPairId) {
    stmts.push(
      db
        .prepare('UPDATE transactions SET suggested_pair_id = ? WHERE id = ? AND user_id = ? AND suggested_pair_id IS NULL')
        .bind(txId, suggestedPairId, userId)
    );
  }

  await db.batch(stmts);

  return {
    status: 'created',
    transactionId: txId,
    parseStatus: finalParseStatus,
    needsAccountReview,
    suggestedPairId,
    reasonCode: parsed.reasonCode || matchResult.reasonCode
  };
}

app.post('/api/notifications/ingest', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const deviceId = principal.deviceId || 'owner_manual';

  try {
    const body = await c.req.json();
    const appPackage = String(body.packageName || body.app_package || 'unknown').trim();
    const rawTitle = String(body.title || '');
    const rawText = String(body.text || body.bigText || '');
    const eventId = body.eventId || body.event_id ? String(body.eventId || body.event_id).trim() : null;
    const occurredAtOverride = body.occurredAt ?? body.timestamp ?? body.postTime ?? null;

    if (!rawText.trim()) {
      return c.json({ error: 'Nội dung thông báo trống', code: 'EMPTY_NOTIFICATION' }, 400);
    }

    // Update device last_seen_at if ingested by an Android device
    if (principal.deviceId) {
      await db
        .prepare('UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(principal.deviceId)
        .run();
    }

    // V2-04: Reject/Redact OTP BEFORE storing in raw_notifications!
    if (isOtpNotification(rawTitle, rawText)) {
      return c.json({
        status: 'ignored_otp',
        reason: 'OTP or verification notification skipped before storage'
      });
    }

    // Validate time override early (V2-05 / AT2-11)
    if (occurredAtOverride !== null && occurredAtOverride !== undefined && occurredAtOverride !== '') {
      const check = canonicalizeOccurredAt(occurredAtOverride, null);
      if (check.invalidOverride) {
        return c.json(
          {
            error: 'Định dạng thời gian không hợp lệ (cần ISO-8601 có múi giờ hoặc epoch milliseconds)',
            code: 'INVALID_TIME_FORMAT'
          },
          400
        );
      }
    }

    // Check eventId idempotency (V2-06 / AT2-13)
    if (eventId) {
      const existingRaw = await db
        .prepare(
          'SELECT id, parse_status FROM raw_notifications WHERE user_id = ? AND device_id = ? AND event_id = ? LIMIT 1'
        )
        .bind(userId, deviceId, eventId)
        .first<{ id: string; parse_status: string }>();

      if (existingRaw) {
        const existingTx = await db
          .prepare('SELECT id, needs_account_review, suggested_pair_id FROM transactions WHERE raw_notification_id = ? AND is_synthetic = 0 LIMIT 1')
          .bind(existingRaw.id)
          .first<any>();
        return c.json({
          status: 'duplicate_event',
          rawNotificationId: existingRaw.id,
          transactionId: existingTx?.id || null,
          parseStatus: existingRaw.parse_status
        });
      }
    }

    const sanitizedTitle = redactOtp(rawTitle);
    const sanitizedText = redactOtp(rawText);
    const sanitizedPayload = {
      ...body,
      title: sanitizedTitle,
      text: sanitizedText,
      bigText: body.bigText ? redactOtp(String(body.bigText)) : undefined
    };

    const rawId = `raw_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const canonicalTime = canonicalizeOccurredAt(occurredAtOverride, null);

    await db
      .prepare(
        `INSERT INTO raw_notifications (
          id, user_id, device_id, event_id, app_package, title, text,
          original_time_value, time_source, parse_status, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
      )
      .bind(
        rawId,
        userId,
        deviceId,
        eventId,
        appPackage,
        sanitizedTitle,
        sanitizedText,
        occurredAtOverride !== null && occurredAtOverride !== undefined ? String(occurredAtOverride) : canonicalTime.occurredAt,
        canonicalTime.timeSource,
        JSON.stringify(sanitizedPayload)
      )
      .run();

    const result = await processNotificationToTransaction(
      db,
      userId,
      rawId,
      appPackage,
      sanitizedTitle,
      sanitizedText,
      occurredAtOverride
    );

    return c.json({
      ...result,
      rawNotificationId: rawId
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'INGEST_ERROR' }, 500);
  }
});

app.post('/api/notifications/reprocess', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const { results: rawNotifs } = await db
      .prepare(
        `SELECT id, user_id, app_package, title, text, original_time_value, received_at, raw_json
         FROM raw_notifications
         WHERE user_id = ? AND parse_status IN ('pending', 'ignored', 'failed', 'ambiguous')
         ORDER BY received_at ASC`
      )
      .bind(userId)
      .all<any>();

    if (!rawNotifs || rawNotifs.length === 0) {
      return c.json({ status: 'ok', message: 'Không có thông báo nào cần xử lý lại', count: 0 });
    }

    let recoveredCount = 0;
    for (const notif of rawNotifs) {
      let timeOverride: string | number | null = notif.original_time_value || notif.received_at || null;
      if (!timeOverride && notif.raw_json) {
        try {
          const parsedRaw = JSON.parse(notif.raw_json);
          timeOverride = parsedRaw.occurredAt || parsedRaw.timestamp || parsedRaw.postTime || null;
        } catch {
          // Ignore malformed JSON
        }
      }

      const res = await processNotificationToTransaction(
        db,
        notif.user_id || userId,
        notif.id,
        notif.app_package,
        notif.title || '',
        notif.text || '',
        timeOverride
      );
      if (res.status === 'created') {
        recoveredCount++;
      }
    }

    return c.json({
      status: 'ok',
      message: `Đã khôi phục thành công ${recoveredCount} giao dịch`,
      count: recoveredCount
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// TRANSACTIONS & ATOMIC LEDGER ENDPOINTS (V2-02, V2-10, V2-20, V2-25)
// ============================================================================

app.get('/api/transactions', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  const status = c.req.query('status');
  const type = c.req.query('type');
  const jarId = c.req.query('jarId');
  const incomeSourceId = c.req.query('incomeSourceId');
  const accountId = c.req.query('accountId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const q = c.req.query('q');
  const includeHidden = c.req.query('includeHidden') === '1';
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 200), 1), 1000);
  const offset = Math.max(Number(c.req.query('offset') || 0), 0);
  const cursorParam = c.req.query('cursor');
  // A request without an explicit offset starts the additive cursor flow; explicit offset remains legacy-compatible.
  const cursorMode = cursorParam !== undefined || c.req.query('offset') === undefined;

  try {
    const whereClauses: string[] = ['t.user_id = ?', 't.deleted_at IS NULL'];
    const params: any[] = [userId];

    if (!includeHidden) whereClauses.push('COALESCE(t.history_hidden, 0) = 0');

    if (status) {
      whereClauses.push('t.status = ?');
      params.push(status);
    } else {
      whereClauses.push("t.status != 'paired_hidden'");
    }

    if (type) {
      whereClauses.push('t.type = ?');
      params.push(type);
    }

    if (jarId) {
      if (jarId === '__unassigned__') {
        whereClauses.push('(t.jar_id IS NULL OR t.jar_id = "")');
      } else if (jarId === '__orphaned__') {
        whereClauses.push('t.jar_id IS NOT NULL AND t.jar_id != "" AND j.id IS NULL');
      } else {
        whereClauses.push('t.jar_id = ?');
        params.push(jarId);
      }
    }

    if (incomeSourceId) {
      if (incomeSourceId === '__unassigned__') {
        whereClauses.push('(t.income_source_id IS NULL OR t.income_source_id = "")');
      } else if (incomeSourceId === '__orphaned__') {
        whereClauses.push('t.income_source_id IS NOT NULL AND t.income_source_id != "" AND inc.id IS NULL');
      } else {
        whereClauses.push('t.income_source_id = ?');
        params.push(incomeSourceId);
      }
    }

    if (accountId) {
      whereClauses.push('(t.account_id = ? OR t.to_account_id = ?)');
      params.push(accountId, accountId);
    }

    if (startDate) {
      whereClauses.push('t.occurred_at >= ?');
      params.push(startDate);
    }
    if (endDate) {
      whereClauses.push('t.occurred_at <= ?');
      params.push(endDate);
    }

    if (q && q.trim()) {
      whereClauses.push('(LOWER(t.description) LIKE ? OR CAST(t.amount AS TEXT) LIKE ?)');
      const pat = `%${q.trim().toLowerCase()}%`;
      params.push(pat, pat);
    }

    const whereSql = whereClauses.join(' AND ');
    const filterHash = await hashPayload({
      status: status || null,
      type: type || null,
      jarId: jarId || null,
      incomeSourceId: incomeSourceId || null,
      accountId: accountId || null,
      startDate: startDate || null,
      endDate: endDate || null,
      q: q?.trim() || null,
      includeHidden
    });
    const revisionRow = await db
      .prepare('SELECT revision FROM user_data_revisions WHERE user_id = ?')
      .bind(userId)
      .first<{ revision: number }>();
    const dataRevision = Number(revisionRow?.revision || 0);
    let cursor: ReturnType<typeof decodeTransactionCursor> = null;
    if (cursorMode && cursorParam) {
      cursor = decodeTransactionCursor(cursorParam);
      if (!cursor) return c.json({ error: 'Cursor không hợp lệ', code: 'INVALID_CURSOR' }, 400);
      if (cursor.filterHash !== filterHash) {
        return c.json({ error: 'Cursor không khớp với bộ lọc hiện tại', code: 'CURSOR_FILTER_MISMATCH' }, 400);
      }
      if (cursor.revision !== dataRevision) {
        return c.json({ error: 'Dữ liệu đã thay đổi trong khi đang phân trang', code: 'STALE_CURSOR', dataRevision }, 409);
      }
    }

    const countRow = await db
      .prepare(
        `SELECT COUNT(*) as totalCount,
                COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as totalIncome,
                COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as totalExpense
         FROM transactions t
         LEFT JOIN jars j ON t.jar_id = j.id
         LEFT JOIN income_sources inc ON t.income_source_id = inc.id
         WHERE ${whereSql}`
      )
      .bind(...params)
      .first<any>();

    const cursorWhereClauses = [...whereClauses];
    const cursorParams = [...params];
    if (cursor) {
      cursorWhereClauses.push('(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))');
      cursorParams.push(cursor.occurredAt, cursor.occurredAt, cursor.id);
    }
    const query = `
      SELECT t.*, j.name as jar_name, j.color as jar_color, j.icon as jar_icon,
             a.name as account_name, a2.name as to_account_name,
             inc.name as income_source_name,
             rn.app_package as app_package
      FROM transactions t
      LEFT JOIN jars j ON t.jar_id = j.id
      LEFT JOIN accounts a ON t.account_id = a.id
      LEFT JOIN accounts a2 ON t.to_account_id = a2.id
      LEFT JOIN income_sources inc ON t.income_source_id = inc.id
      LEFT JOIN raw_notifications rn ON t.raw_notification_id = rn.id
      WHERE ${cursorWhereClauses.join(' AND ')}
      ORDER BY t.occurred_at DESC, ${cursorMode ? 't.id' : 't.created_at'} DESC${cursorMode ? '' : ', t.id DESC'}
      LIMIT ?${cursorMode ? '' : ' OFFSET ?'}
    `;

    const queryResult = await db.prepare(query).bind(...cursorParams, cursorMode ? limit + 1 : limit, ...(cursorMode ? [] : [offset])).all<any>();
    const results = queryResult.results || [];
    const pageHasMore = cursorMode ? results.length > limit : offset + results.length < Number(countRow?.totalCount || 0);
    const pageRows = cursorMode && pageHasMore ? results.slice(0, limit) : results;
    const latestRevisionRow = await db
      .prepare('SELECT revision FROM user_data_revisions WHERE user_id = ?')
      .bind(userId)
      .first<{ revision: number }>();
    const latestDataRevision = Number(latestRevisionRow?.revision || 0);
    if (cursorMode && latestDataRevision !== dataRevision) {
      return c.json({ error: 'Dữ liệu đã thay đổi trong khi đang phân trang', code: 'STALE_CURSOR', dataRevision: latestDataRevision }, 409);
    }
    const totalCount = Number(countRow?.totalCount || 0);
    const lastRow = pageRows.length ? pageRows[pageRows.length - 1] : null;
    const nextCursor = cursorMode && pageHasMore && lastRow
      ? encodeTransactionCursor({ v: 1, occurredAt: lastRow.occurred_at, id: lastRow.id, revision: dataRevision, filterHash })
      : cursorMode ? null : pageHasMore ? offset + limit : null;

    return c.json({
      transactions: pageRows,
      pagination: {
        limit,
        offset,
        totalCount,
        hasMore: pageHasMore,
        nextCursor,
        dataRevision
      },
      aggregates: {
        totalIncome: Number(countRow?.totalIncome || 0),
        totalExpense: Number(countRow?.totalExpense || 0)
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create Manual Transaction (Atomic Batch V2-02)
app.post('/api/transactions', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  let replayInput: { operationId: string; body: any } | undefined;

  try {
    const body = await c.req.json();
    const operationId =
      body.operationId ||
      c.req.header('X-Operation-Id') ||
      `op_tx_create_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    replayInput = { operationId, body };

    const receiptCheck = await getMutationReceipt(db, operationId, userId, 'POST /api/transactions', body);
    if (receiptCheck.conflict) {
      return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    }
    if (receiptCheck.cachedResponse) {
      return c.json(receiptCheck.cachedResponse, (receiptCheck.statusCode || 200) as any);
    }

    const amount = Number(body.amount);
    if (!isValidVndAmount(amount)) {
      return c.json({ error: 'Số tiền không hợp lệ (cần số nguyên dương VND)', code: 'INVALID_AMOUNT' }, 400);
    }

    const type = body.type || 'expense';
    if (!['income', 'expense', 'transfer'].includes(type)) {
      return c.json({ error: 'Loại giao dịch không hợp lệ', code: 'INVALID_TYPE' }, 400);
    }

    const accountId = String(body.accountId || '').trim();
    if (!accountId) {
      return c.json({ error: 'Vui lòng chọn tài khoản hợp lệ', code: 'MISSING_ACCOUNT' }, 400);
    }

    // Verify account exists and is active for new transactions
    const sourceAcc = await db
      .prepare('SELECT id, is_active FROM accounts WHERE id = ? AND user_id = ? LIMIT 1')
      .bind(accountId, userId)
      .first<{ id: string; is_active: number }>();

    if (!sourceAcc) {
      return c.json({ error: 'Tài khoản không tồn tại', code: 'ACCOUNT_NOT_FOUND' }, 400);
    }
    if (sourceAcc.is_active === 0) {
      return c.json({ error: 'Không thể tạo giao dịch mới trên tài khoản đã lưu trữ (archived)', code: 'ACCOUNT_ARCHIVED' }, 400);
    }

    const toAccountId = type === 'transfer' && body.toAccountId ? String(body.toAccountId).trim() : null;
    if (type === 'transfer') {
      if (!toAccountId || toAccountId === accountId) {
        return c.json({ error: 'Giao dịch chuyển khoản nội bộ cần tài khoản đích khác tài khoản nguồn', code: 'INVALID_TRANSFER_TARGET' }, 400);
      }
      const destAcc = await db
        .prepare('SELECT id, is_active FROM accounts WHERE id = ? AND user_id = ? LIMIT 1')
        .bind(toAccountId, userId)
        .first<{ id: string; is_active: number }>();
      if (!destAcc || destAcc.is_active === 0) {
        return c.json({ error: 'Tài khoản đích không tồn tại hoặc đã lưu trữ', code: 'INVALID_TRANSFER_TARGET' }, 400);
      }
    }

    const status = body.status || 'confirmed';
    const txId = body.id || `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const occurredAt = body.occurredAt ? new Date(body.occurredAt).toISOString() : new Date().toISOString();
    const jarId = type === 'expense' ? body.jarId || null : null;
    const incomeSourceId = type === 'income' ? body.incomeSourceId || null : null;
    const description = body.description || 'Giao dịch thủ công';

    const newState: LedgerTxState = {
      status,
      type,
      amount,
      accountId,
      toAccountId
    };

    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `INSERT INTO transactions (
            id, user_id, occurred_at, time_source, type, amount, account_id, to_account_id,
            jar_id, income_source_id, status, source, description,
            original_type, original_account_id, original_jar_id, original_income_source_id, original_description, original_status,
            revision
          ) VALUES (?, ?, ?, 'user_input', ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(
          txId,
          userId,
          occurredAt,
          type,
          amount,
          accountId,
          toAccountId,
          jarId,
          incomeSourceId,
          status,
          description,
          type,
          accountId,
          jarId,
          incomeSourceId,
          description,
          status
        )
    ];

    const deltaPrimary = calculateBalanceDelta(null, newState, accountId);
    stmts.push(...buildLedgerDeltaStatements(db, userId, accountId, deltaPrimary, 'manual_create', operationId, txId));

    if (toAccountId && toAccountId !== accountId) {
      const deltaTarget = calculateBalanceDelta(null, newState, toAccountId);
      stmts.push(...buildLedgerDeltaStatements(db, userId, toAccountId, deltaTarget, 'manual_create_transfer', operationId, txId));
    }

    const responsePayload = {
      success: true,
      id: txId,
      operationId,
      status,
      revision: 1,
      serverTimestamp: new Date().toISOString()
    };

    const receiptStmt = buildMutationReceiptStatement(
      db,
      operationId,
      userId,
      'POST /api/transactions',
      receiptCheck.payloadHash,
      200,
      responsePayload
    );
    if (receiptStmt) stmts.unshift(receiptStmt);

    // Execute all statements atomically in a single batch!
    await db.batch(stmts);

    const updatedAccs = await db
      .prepare('SELECT id, balance, revision FROM accounts WHERE user_id = ? AND id IN (?, ?)')
      .bind(userId, accountId, toAccountId || accountId)
      .all<any>();

    return c.json({
      ...responsePayload,
      affectedAccounts: updatedAccs.results || []
    });
  } catch (err: any) {
    if (replayInput) {
      const replay = await getMutationReceipt(db, replayInput.operationId, userId, 'POST /api/transactions', replayInput.body);
      if (replay.conflict) return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      if (replay.cachedResponse) return c.json(replay.cachedResponse, (replay.statusCode || 200) as any);
    }
    return c.json({ error: err.message, code: 'TRANSACTION_CREATE_FAILED' }, 500);
  }
});

// Update / Confirm / Undo / Edit Transaction (Atomic Batch V2-02, V2-20)
app.put('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const requestedId = c.req.param('id');
  let replayInput: { operationId: string; body: any } | undefined;

  try {
    const body = await c.req.json();
    const operationId =
      body.operationId ||
      c.req.header('X-Operation-Id') ||
      `op_tx_update_${requestedId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    replayInput = { operationId, body };

    const receiptCheck = await getMutationReceipt(db, operationId, userId, `PUT /api/transactions/${requestedId}`, body);
    if (receiptCheck.conflict) {
      return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    }
    if (receiptCheck.cachedResponse) {
      return c.json(receiptCheck.cachedResponse, (receiptCheck.statusCode || 200) as any);
    }

    let oldTx = await db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(requestedId, userId)
      .first<any>();

    if (!oldTx) {
      return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);
    }

    // V2-10: If user targets a paired_hidden secondary leg, resolve to the primary leg in the same transfer_pair_id
    if (oldTx.status === 'paired_hidden' && oldTx.transfer_pair_id) {
      const primaryLeg = await db
        .prepare(
          `SELECT * FROM transactions
           WHERE user_id = ? AND transfer_pair_id = ? AND status != 'paired_hidden' AND deleted_at IS NULL
           LIMIT 1`
        )
        .bind(userId, oldTx.transfer_pair_id)
        .first<any>();
      if (primaryLeg) {
        oldTx = primaryLeg;
      }
    }

    const txId = oldTx.id;

    // Optimistic concurrency check (V2-02 / AT2-06)
    if (body.expectedRevision !== undefined && Number(body.expectedRevision) !== Number(oldTx.revision || 1)) {
      return c.json(
        {
          error: 'Dữ liệu giao dịch đã thay đổi ở phiên khác, vui lòng tải lại',
          code: 'REVISION_CONFLICT',
          currentRevision: oldTx.revision || 1
        },
        409
      );
    }

    const newStatus = body.status !== undefined ? body.status : oldTx.status;
    const newType = body.type !== undefined ? body.type : oldTx.type;
    const newAmount = body.amount !== undefined ? Number(body.amount) : Number(oldTx.amount);
    if (!isValidVndAmount(newAmount)) {
      return c.json({ error: 'Số tiền không hợp lệ', code: 'INVALID_AMOUNT' }, 400);
    }

    const newAccountId = body.accountId !== undefined ? String(body.accountId).trim() : String(oldTx.account_id);
    const newToAccountId =
      newType === 'transfer'
        ? body.toAccountId !== undefined
          ? body.toAccountId
          : oldTx.to_account_id
        : null;

    const newJarId = newType === 'expense' ? (body.jarId !== undefined ? body.jarId : oldTx.jar_id) : null;
    const newIncomeSourceId =
      newType === 'income' ? (body.incomeSourceId !== undefined ? body.incomeSourceId : oldTx.income_source_id) : null;
    const newDescription = body.description !== undefined ? body.description : oldTx.description;
    const newOccurredAt = body.occurredAt !== undefined ? new Date(body.occurredAt).toISOString() : oldTx.occurred_at;

    // If user explicitly assigns an accountId during review/edit, clear needs_account_review
    const needsAccountReview =
      body.accountId !== undefined && body.accountId !== 'acc_unassigned'
        ? 0
        : body.needsAccountReview !== undefined
          ? body.needsAccountReview
            ? 1
            : 0
          : Number(oldTx.needs_account_review || 0);

    // Block confirming an ambiguous transaction until a valid account is selected (V2-03 / AT2-07)
    if (newStatus === 'confirmed' && (needsAccountReview === 1 || newAccountId === 'acc_unassigned')) {
      return c.json(
        {
          error: 'Giao dịch chưa xác định rõ tài khoản ngân hàng. Vui lòng chọn tài khoản trước khi duyệt.',
          code: 'ACCOUNT_REVIEW_REQUIRED'
        },
        400
      );
    }

    if (newType === 'transfer' && (!newToAccountId || newToAccountId === newAccountId)) {
      return c.json(
        {
          error: 'Giao dịch chuyển khoản nội bộ cần tài khoản đích khác tài khoản nguồn',
          code: 'INVALID_TRANSFER_TARGET'
        },
        400
      );
    }

    const oldState: LedgerTxState = {
      status: oldTx.status,
      type: oldTx.type,
      amount: Number(oldTx.amount),
      accountId: oldTx.account_id,
      toAccountId: oldTx.to_account_id
    };

    const newState: LedgerTxState = {
      status: newStatus,
      type: newType,
      amount: newAmount,
      accountId: newAccountId,
      toAccountId: newToAccountId
    };

    const nextRevision = Number(oldTx.revision || 1) + 1;
    const stmts: D1PreparedStatement[] = [];

    // Atomic DB-level revision assertion inside batch
    stmts.push(
      buildBatchAssertion(
        db,
        'SELECT COUNT(*) FROM transactions WHERE id = ? AND user_id = ? AND COALESCE(revision, 1) = ? AND deleted_at IS NULL',
        [txId, userId, Number(oldTx.revision || 1)]
      )
    );

    stmts.push(
      db
        .prepare(
          `UPDATE transactions
           SET status = ?, type = ?, amount = ?, account_id = ?, to_account_id = ?,
               jar_id = ?, income_source_id = ?, description = ?, occurred_at = ?,
               needs_account_review = ?, revision = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ? AND COALESCE(revision, 1) = ?`
        )
        .bind(
          newStatus,
          newType,
          newAmount,
          newAccountId,
          newToAccountId,
          newJarId,
          newIncomeSourceId,
          newDescription,
          newOccurredAt,
          needsAccountReview,
          nextRevision,
          txId,
          userId,
          Number(oldTx.revision || 1)
        )
    );

    // Compute exact balance deltas across ALL affected accounts (old and new source/target accounts!)
    const candidateAccountIds = new Set<string>();
    if (oldTx.account_id) candidateAccountIds.add(oldTx.account_id);
    if (oldTx.to_account_id) candidateAccountIds.add(oldTx.to_account_id);
    if (newAccountId) candidateAccountIds.add(newAccountId);
    if (newToAccountId) candidateAccountIds.add(newToAccountId);

    const deltasByAccount: Record<string, number> = {};
    for (const accId of candidateAccountIds) {
      const delta = calculateBalanceDelta(oldState, newState, accId);
      if (delta !== 0) {
        deltasByAccount[accId] = delta;
        stmts.push(...buildLedgerDeltaStatements(db, userId, accId, delta, `tx_update_${newStatus}`, operationId, txId));
      }
    }

    // Auto-Learn Categorization Rule when confirming
    if (body.learnRule && body.pattern && newStatus === 'confirmed') {
      const targetId = newType === 'expense' ? newJarId : newType === 'income' ? newIncomeSourceId : newToAccountId;
      const actionType =
        newType === 'expense' ? 'assign_jar' : newType === 'income' ? 'assign_income' : 'mark_transfer';

      if (targetId) {
        const ruleId = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        stmts.push(
          db
            .prepare(
              `INSERT INTO rules (id, user_id, match_field, match_type, pattern, action_type, target_id)
               VALUES (?, ?, 'description', 'contains', ?, ?, ?)`
            )
            .bind(ruleId, userId, String(body.pattern).toUpperCase(), actionType, targetId)
        );
      }
    }

    const responsePayload = {
      success: true,
      id: txId,
      operationId,
      status: newStatus,
      revision: nextRevision,
      deltasByAccount,
      serverTimestamp: new Date().toISOString()
    };

    const receiptStmt = buildMutationReceiptStatement(
      db,
      operationId,
      userId,
      `PUT /api/transactions/${requestedId}`,
      receiptCheck.payloadHash,
      200,
      responsePayload
    );
    if (receiptStmt) stmts.unshift(receiptStmt);

    await db.batch(stmts);

    return c.json(responsePayload);
  } catch (err: any) {
    if (replayInput) {
      const replay = await getMutationReceipt(db, replayInput.operationId, userId, `PUT /api/transactions/${requestedId}`, replayInput.body);
      if (replay.conflict) return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      if (replay.cachedResponse) return c.json(replay.cachedResponse, (replay.statusCode || 200) as any);
    }
    if (String(err.message || '').includes('CHECK constraint failed')) {
      return c.json({ error: 'Xung đột phiên bản dữ liệu (Revision conflict)', code: 'REVISION_CONFLICT' }, 409);
    }
    return c.json({ error: err.message, code: 'TRANSACTION_UPDATE_FAILED' }, 500);
  }
});

// Delete Confirmed or Pending Transaction (Atomic Batch V2-02)
app.delete('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const txId = c.req.param('id');
  const operationId = c.req.header('X-Operation-Id') || `op_tx_del_${txId}_${Date.now()}`;

  try {
    const receiptCheck = await getMutationReceipt(db, operationId, userId, `DELETE /api/transactions/${txId}`, { txId });
    if (receiptCheck.conflict) {
      return c.json({ error: 'Operation ID conflict', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    }
    if (receiptCheck.cachedResponse) {
      return c.json(receiptCheck.cachedResponse, (receiptCheck.statusCode || 200) as any);
    }

    const oldTx = await db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(txId, userId)
      .first<any>();

    if (!oldTx) {
      return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);
    }

    const oldState: LedgerTxState = {
      status: oldTx.status,
      type: oldTx.type,
      amount: Number(oldTx.amount),
      accountId: oldTx.account_id,
      toAccountId: oldTx.to_account_id
    };

    const stmts: D1PreparedStatement[] = [];
    stmts.push(buildBatchAssertion(
      db,
      'SELECT COUNT(*) FROM transactions WHERE id = ? AND user_id = ? AND COALESCE(revision, 1) = ? AND deleted_at IS NULL',
      [txId, userId, Number(oldTx.revision || 1)]
    ));
    const candidateAccountIds = new Set<string>();
    if (oldTx.account_id) candidateAccountIds.add(oldTx.account_id);
    if (oldTx.to_account_id) candidateAccountIds.add(oldTx.to_account_id);

    for (const accId of candidateAccountIds) {
      const delta = calculateBalanceDelta(oldState, null, accId);
      if (delta !== 0) {
        stmts.push(...buildLedgerDeltaStatements(db, userId, accId, delta, 'tx_delete', operationId, txId));
      }
    }

    const nextRevision = Number(oldTx.revision || 1) + 1;
    stmts.push(
      db
        .prepare(
          `UPDATE transactions
           SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, revision = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND user_id = ? AND COALESCE(revision, 1) = ? AND deleted_at IS NULL`
        )
        .bind(nextRevision, txId, userId, Number(oldTx.revision || 1))
    );

    // If this transaction was part of a transfer pair, also clean up synthetic or restore paired leg
    if (oldTx.transfer_pair_id) {
      stmts.push(
        db
          .prepare(
            `UPDATE transactions
             SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND transfer_pair_id = ? AND is_synthetic = 1 AND id != ?`
          )
          .bind(userId, oldTx.transfer_pair_id, txId)
      );
    }

    const responsePayload = {
      success: true,
      id: txId,
      operationId,
      status: 'deleted',
      revision: nextRevision
    };

    const receiptStmt = buildMutationReceiptStatement(
      db,
      operationId,
      userId,
      `DELETE /api/transactions/${txId}`,
      receiptCheck.payloadHash,
      200,
      responsePayload
    );
    if (receiptStmt) stmts.unshift(receiptStmt);

    await db.batch(stmts);
    return c.json(responsePayload);
  } catch (err: any) {
    const replay = await getMutationReceipt(db, operationId, userId, `DELETE /api/transactions/${txId}`, { txId });
    if (replay.conflict) return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    if (replay.cachedResponse) return c.json(replay.cachedResponse, (replay.statusCode || 200) as any);
    if (String(err.message || '').includes('CHECK constraint failed')) {
      return c.json({ error: 'Xung đột phiên bản dữ liệu (Revision conflict)', code: 'REVISION_CONFLICT' }, 409);
    }
    return c.json({ error: err.message }, 500);
  }
});

// Pair Transfer Endpoints (V2-10 Atomic & Reversible)
app.post('/api/transactions/:id/pair-transfer', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const txId = c.req.param('id');

  try {
    const body = await c.req.json().catch(() => ({}));
    const operationId = body.operationId || c.req.header('X-Operation-Id') || `op_pair_${txId}_${Date.now()}`;

    const tx = await db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(txId, userId)
      .first<any>();
    if (!tx) return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);

    // Determine counterpart transaction (explicit counterpartTxId, suggested_pair_id, or search within 120 mins)
    let counterpart: any = null;
    const requestedCounterpartId = body.counterpartTxId || tx.suggested_pair_id;
    if (requestedCounterpartId) {
      counterpart = await db
        .prepare(
          `SELECT * FROM transactions
           WHERE id = ? AND user_id = ? AND id != ? AND deleted_at IS NULL`
        )
        .bind(requestedCounterpartId, userId, txId)
        .first<any>();
    }

    if (!counterpart && !body.toAccountId) {
      const oppositeType = tx.type === 'income' ? 'expense' : 'income';
      counterpart = await db
        .prepare(
          `SELECT * FROM transactions
           WHERE user_id = ?
             AND id != ?
             AND amount = ?
             AND type = ?
             AND account_id != ?
             AND status IN ('pending', 'confirmed')
             AND transfer_pair_id IS NULL
             AND deleted_at IS NULL
             AND ABS(strftime('%s', occurred_at) - strftime('%s', ?)) <= 7200
           ORDER BY occurred_at DESC
           LIMIT 1`
        )
        .bind(userId, txId, tx.amount, oppositeType, tx.account_id, tx.occurred_at)
        .first<any>();
    }

    const pairId = `pair_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const targetStatus = body.confirmImmediately ? 'confirmed' : tx.status === 'confirmed' ? 'confirmed' : 'pending';
    const stmts: D1PreparedStatement[] = [];

    if (counterpart) {
      const expenseLeg = tx.type === 'expense' ? tx : counterpart;
      const incomeLeg = tx.type === 'income' ? tx : counterpart;

      // Calculate ledger delta if either leg was already confirmed before pairing!
      const oldExpenseState: LedgerTxState = {
        status: expenseLeg.status,
        type: expenseLeg.type,
        amount: Number(expenseLeg.amount),
        accountId: expenseLeg.account_id,
        toAccountId: expenseLeg.to_account_id
      };
      const oldIncomeState: LedgerTxState = {
        status: incomeLeg.status,
        type: incomeLeg.type,
        amount: Number(incomeLeg.amount),
        accountId: incomeLeg.account_id,
        toAccountId: incomeLeg.to_account_id
      };

      const newPrimaryState: LedgerTxState = {
        status: targetStatus,
        type: 'transfer',
        amount: Number(expenseLeg.amount),
        accountId: expenseLeg.account_id,
        toAccountId: incomeLeg.account_id
      };
      const newHiddenState: LedgerTxState = {
        status: 'paired_hidden',
        type: incomeLeg.type,
        amount: Number(incomeLeg.amount),
        accountId: incomeLeg.account_id,
        toAccountId: null
      };

      // Net delta on expenseLeg.account_id and incomeLeg.account_id
      for (const accId of new Set([expenseLeg.account_id, incomeLeg.account_id])) {
        const deltaFromPrimary = calculateBalanceDelta(oldExpenseState, newPrimaryState, accId);
        const deltaFromHidden = calculateBalanceDelta(oldIncomeState, newHiddenState, accId);
        const netDelta = deltaFromPrimary + deltaFromHidden;
        if (netDelta !== 0) {
          stmts.push(...buildLedgerDeltaStatements(db, userId, accId, netDelta, 'pair_transfer', operationId, expenseLeg.id));
        }
      }

      stmts.push(
        db
          .prepare(
            `UPDATE transactions
             SET type = 'transfer',
                 to_account_id = ?,
                 status = ?,
                 transfer_pair_id = ?,
                 suggested_pair_id = NULL,
                 jar_id = NULL,
                 income_source_id = NULL,
                 original_type = COALESCE(original_type, ?),
                 original_account_id = COALESCE(original_account_id, ?),
                 original_jar_id = COALESCE(original_jar_id, ?),
                 original_income_source_id = COALESCE(original_income_source_id, ?),
                 original_description = COALESCE(original_description, ?),
                 original_status = COALESCE(original_status, ?),
                 revision = COALESCE(revision, 1) + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`
          )
          .bind(
            incomeLeg.account_id,
            targetStatus,
            pairId,
            expenseLeg.type,
            expenseLeg.account_id,
            expenseLeg.jar_id,
            expenseLeg.income_source_id,
            expenseLeg.description,
            expenseLeg.status,
            expenseLeg.id,
            userId
          )
      );

      stmts.push(
        db
          .prepare(
            `UPDATE transactions
             SET status = 'paired_hidden',
                 transfer_pair_id = ?,
                 suggested_pair_id = NULL,
                 original_type = COALESCE(original_type, ?),
                 original_account_id = COALESCE(original_account_id, ?),
                 original_jar_id = COALESCE(original_jar_id, ?),
                 original_income_source_id = COALESCE(original_income_source_id, ?),
                 original_description = COALESCE(original_description, ?),
                 original_status = COALESCE(original_status, ?),
                 revision = COALESCE(revision, 1) + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`
          )
          .bind(
            pairId,
            incomeLeg.type,
            incomeLeg.account_id,
            incomeLeg.jar_id,
            incomeLeg.income_source_id,
            incomeLeg.description,
            incomeLeg.status,
            incomeLeg.id,
            userId
          )
      );

      await db.batch(stmts);
      return c.json({
        success: true,
        paired: true,
        pairId,
        primaryTxId: expenseLeg.id,
        hiddenTxId: incomeLeg.id,
        status: targetStatus
      });
    } else {
      // Single-leg manual transfer conversion with synthetic counterpart
      let targetAccId = body.toAccountId;
      if (!targetAccId || targetAccId === tx.account_id) {
        return c.json(
          {
            error: 'Vui lòng chọn tài khoản đối ứng khác tài khoản nguồn để chuyển thành giao dịch nội bộ',
            code: 'MISSING_TARGET_ACCOUNT'
          },
          400
        );
      }

      const oldState: LedgerTxState = {
        status: tx.status,
        type: tx.type,
        amount: Number(tx.amount),
        accountId: tx.account_id,
        toAccountId: tx.to_account_id
      };

      const sourceAccId = tx.type === 'income' ? targetAccId : tx.account_id;
      const destAccId = tx.type === 'income' ? tx.account_id : targetAccId;

      const newState: LedgerTxState = {
        status: targetStatus,
        type: 'transfer',
        amount: Number(tx.amount),
        accountId: sourceAccId,
        toAccountId: destAccId
      };

      for (const accId of new Set([sourceAccId, destAccId])) {
        const delta = calculateBalanceDelta(oldState, newState, accId);
        if (delta !== 0) {
          stmts.push(...buildLedgerDeltaStatements(db, userId, accId, delta, 'pair_transfer_synthetic', operationId, tx.id));
        }
      }

      const syntheticId = `tx_syn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO transactions (
              id, user_id, occurred_at, time_source, type, amount, account_id,
              status, source, description, transfer_pair_id, is_synthetic, original_type, original_status
            ) VALUES (?, ?, ?, 'system', ?, ?, ?, 'paired_hidden', 'system', ?, ?, 1, ?, 'paired_hidden')`
          )
          .bind(
            syntheticId,
            userId,
            tx.occurred_at,
            tx.type === 'income' ? 'expense' : 'income',
            tx.amount,
            targetAccId,
            `[Đối ứng tự động] ${tx.description || ''}`,
            pairId,
            tx.type === 'income' ? 'expense' : 'income'
          )
      );

      stmts.push(
        db
          .prepare(
            `UPDATE transactions
             SET type = 'transfer',
                 account_id = ?,
                 to_account_id = ?,
                 status = ?,
                 transfer_pair_id = ?,
                 suggested_pair_id = NULL,
                 jar_id = NULL,
                 income_source_id = NULL,
                 original_type = COALESCE(original_type, ?),
                 original_account_id = COALESCE(original_account_id, ?),
                 original_jar_id = COALESCE(original_jar_id, ?),
                 original_income_source_id = COALESCE(original_income_source_id, ?),
                 original_description = COALESCE(original_description, ?),
                 original_status = COALESCE(original_status, ?),
                 revision = COALESCE(revision, 1) + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`
          )
          .bind(
            sourceAccId,
            destAccId,
            targetStatus,
            pairId,
            tx.type,
            tx.account_id,
            tx.jar_id,
            tx.income_source_id,
            tx.description,
            tx.status,
            tx.id,
            userId
          )
      );

      await db.batch(stmts);
      return c.json({
        success: true,
        paired: false,
        syntheticCreated: true,
        pairId,
        primaryTxId: tx.id,
        syntheticTxId: syntheticId,
        status: targetStatus
      });
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/transactions/:id/unpair', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const txId = c.req.param('id');

  try {
    const operationId = c.req.header('X-Operation-Id') || `op_unpair_${txId}_${Date.now()}`;
    const tx = await db
      .prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
      .bind(txId, userId)
      .first<any>();
    if (!tx) return c.json({ error: 'Transaction not found', code: 'NOT_FOUND' }, 404);

    const pairId = tx.transfer_pair_id;
    const stmts: D1PreparedStatement[] = [];

    if (pairId) {
      const { results: pairTxs } = await db
        .prepare('SELECT * FROM transactions WHERE user_id = ? AND transfer_pair_id = ? AND deleted_at IS NULL')
        .bind(userId, pairId)
        .all<any>();

      const primaryLeg = (pairTxs || []).find((p) => p.status !== 'paired_hidden') || tx;
      const oldPrimaryState: LedgerTxState = {
        status: primaryLeg.status,
        type: primaryLeg.type,
        amount: Number(primaryLeg.amount),
        accountId: primaryLeg.account_id,
        toAccountId: primaryLeg.to_account_id
      };

      // Reverse any confirmed transfer ledger effect first
      for (const accId of new Set([primaryLeg.account_id, primaryLeg.to_account_id].filter(Boolean))) {
        const revertDelta = calculateBalanceDelta(oldPrimaryState, null, accId);
        if (revertDelta !== 0) {
          stmts.push(...buildLedgerDeltaStatements(db, userId, accId, revertDelta, 'unpair_revert', operationId, primaryLeg.id));
        }
      }

      for (const p of pairTxs || []) {
        if (p.is_synthetic === 1 || String(p.id).startsWith('tx_syn_') || String(p.description || '').startsWith('[Đối ứng tự động]')) {
          stmts.push(
            db
              .prepare(`UPDATE transactions SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
              .bind(p.id, userId)
          );
        } else {
          const restoredType = p.original_type || (p.id === primaryLeg.id ? 'expense' : 'income');
          const restoredAccountId = p.original_account_id || p.account_id;
          const restoredJarId = p.original_jar_id || null;
          const restoredIncomeId = p.original_income_source_id || null;
          const restoredDesc = p.original_description || p.description;
          const restoredStatus = 'pending';

          stmts.push(
            db
              .prepare(
                `UPDATE transactions
                 SET type = ?,
                     account_id = ?,
                     to_account_id = NULL,
                     jar_id = ?,
                     income_source_id = ?,
                     description = ?,
                     status = ?,
                     transfer_pair_id = NULL,
                     revision = COALESCE(revision, 1) + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND user_id = ?`
              )
              .bind(
                restoredType,
                restoredAccountId,
                restoredJarId,
                restoredIncomeId,
                restoredDesc,
                restoredStatus,
                p.id,
                userId
              )
          );
        }
      }
    } else {
      const oldState: LedgerTxState = {
        status: tx.status,
        type: tx.type,
        amount: Number(tx.amount),
        accountId: tx.account_id,
        toAccountId: tx.to_account_id
      };
      for (const accId of new Set([tx.account_id, tx.to_account_id].filter(Boolean))) {
        const revertDelta = calculateBalanceDelta(oldState, null, accId);
        if (revertDelta !== 0) {
          stmts.push(...buildLedgerDeltaStatements(db, userId, accId, revertDelta, 'unpair_revert', operationId, tx.id));
        }
      }
      const restoredType = tx.original_type || 'expense';
      const restoredAccountId = tx.original_account_id || tx.account_id;
      stmts.push(
        db
          .prepare(
            `UPDATE transactions
             SET type = ?, account_id = ?, to_account_id = NULL, status = 'pending',
                 jar_id = ?, income_source_id = ?,
                 revision = COALESCE(revision, 1) + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`
          )
          .bind(restoredType, restoredAccountId, tx.original_jar_id || null, tx.original_income_source_id || null, tx.id, userId)
      );
    }

    if (stmts.length > 0) {
      await db.batch(stmts);
    }
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// OVERVIEW, ACCOUNTS, JARS, INCOME SOURCES & PLANNED EXPENSES (V2-08, V2-11, V2-16, V2-17)
// ============================================================================

app.get('/api/overview', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  const year = vnNow.getUTCFullYear();
  const month = String(vnNow.getUTCMonth() + 1).padStart(2, '0');
  const startOfMonth = `${year}-${month}-01T00:00:00.000Z`;

  try {
    // V2-11: Include all accounts with include_in_net_worth != 0 (including archived accounts that still hold balance!)
    const { results: allAccounts } = await db
      .prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY is_active DESC, created_at ASC')
      .bind(userId)
      .all<any>();

    const accounts = (allAccounts || []).filter((a) => a.is_active !== 0);
    const totalCash = (allAccounts || [])
      .filter((a) => a.include_in_net_worth !== 0 && (a.is_active !== 0 || Number(a.balance || 0) !== 0))
      .reduce((sum, a) => sum + Number(a.balance || 0), 0);

    const { results: holdings } = await db
      .prepare(
        `SELECT h.*, a.symbol, a.name as asset_name, a.asset_class, a.current_price, a.unit, a.quote_unit, a.price_as_of, a.sync_status
         FROM holdings h
         JOIN assets a ON h.asset_id = a.id
         WHERE h.user_id = ?`
      )
      .bind(userId)
      .all<any>();

    const totalInvestments = (holdings || []).reduce(
      (sum, h) => sum + Math.round(Number(h.quantity || 0) * Number(h.current_price || 0)),
      0
    );

    const { results: jars } = await db
      .prepare(
        `SELECT j.*, COALESCE(SUM(t.amount), 0) as spent_this_month
         FROM jars j
         LEFT JOIN transactions t
           ON j.id = t.jar_id
          AND t.user_id = ?
          AND t.status = 'confirmed'
          AND t.type = 'expense'
          AND t.deleted_at IS NULL
          AND COALESCE(t.history_hidden, 0) = 0
          AND t.occurred_at >= ?
         WHERE j.user_id = ? AND COALESCE(j.is_active, 1) = 1
         GROUP BY j.id
         ORDER BY j.sort_order ASC`
      )
      .bind(userId, startOfMonth, userId)
      .all<any>();

    const monthStats = await db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as income_this_month,
           COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as expense_this_month
         FROM transactions
         WHERE user_id = ? AND status = 'confirmed' AND deleted_at IS NULL AND COALESCE(history_hidden, 0) = 0 AND occurred_at >= ?`
      )
      .bind(userId, startOfMonth)
      .first<any>();

    return c.json({
      netWorth: totalCash + totalInvestments,
      totalCash,
      totalInvestments,
      incomeThisMonth: Number(monthStats?.income_this_month || 0),
      expenseThisMonth: Number(monthStats?.expense_this_month || 0),
      accounts,
      allAccounts: allAccounts || [],
      jars: jars || [],
      holdings: holdings || []
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.get('/api/accounts', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const includeArchived = c.req.query('includeArchived') === '1';

  try {
    const sql = includeArchived
      ? 'SELECT * FROM accounts WHERE user_id = ? ORDER BY is_active DESC, created_at ASC'
      : 'SELECT * FROM accounts WHERE user_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY created_at ASC';
    const { results } = await db.prepare(sql).bind(userId).all<any>();
    return c.json({ accounts: results || [] });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/accounts', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const body = await c.req.json();
    const id = body.id || `acc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const operationId = body.operationId || c.req.header('X-Operation-Id') || `op_acc_create_${id}`;
    const rawAccountNumber = body.accountNumber ? String(body.accountNumber).trim() : null;
    const explicitMask = body.accountNumberMask ? String(body.accountNumberMask).replace(/\D/g, '').slice(-4) : null;
    // V2-08: Never turn a 4-digit mask into a full accountNumber!
    const mask = explicitMask || (rawAccountNumber && rawAccountNumber.length >= 4 ? rawAccountNumber.slice(-4) : null);
    const initialBalance = Number(body.balance || 0);
    if (!Number.isSafeInteger(initialBalance)) {
      return c.json({ error: 'Số dư ban đầu không hợp lệ', code: 'INVALID_BALANCE' }, 400);
    }

    const aliasesJson = Array.isArray(body.aliases) ? JSON.stringify(body.aliases) : body.aliases_json || null;

    await db.batch([
      db
        .prepare(
          `INSERT INTO accounts (
            id, user_id, name, type, balance, account_number_mask, account_number,
            bank_code, bank_name, account_holder, branch, aliases_json, include_in_net_worth, is_active, revision
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
        )
        .bind(
          id,
          userId,
          body.name || 'Tài khoản mới',
          body.type || 'bank',
          initialBalance,
          mask,
          rawAccountNumber,
          body.bankCode || null,
          body.bankName || null,
          body.accountHolder || null,
          body.branch || null,
          aliasesJson,
          body.includeInNetWorth !== undefined ? (body.includeInNetWorth ? 1 : 0) : 1
        ),
      db
        .prepare(
          `INSERT OR REPLACE INTO ledger_baselines (account_id, user_id, baseline_amount_vnd, note)
           VALUES (?, ?, ?, ?)`
        )
        .bind(id, userId, initialBalance, `Opening balance (${operationId})`)
    ]);

    const created = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).first<any>();
    return c.json({ success: true, id, account: created });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.put('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const accId = c.req.param('id');

  try {
    const body = await c.req.json();
    const operationId = body.operationId || c.req.header('X-Operation-Id') || `op_acc_upd_${accId}_${Date.now()}`;

    const existing = await db
      .prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
      .bind(accId, userId)
      .first<any>();
    if (!existing) {
      return c.json({ error: 'Account not found', code: 'NOT_FOUND' }, 404);
    }

    if (body.expectedRevision !== undefined && Number(body.expectedRevision) !== Number(existing.revision || 1)) {
      return c.json({ error: 'Xung đột phiên bản tài khoản', code: 'REVISION_CONFLICT' }, 409);
    }

    // V2-08: Preserve full account_number vs account_number_mask cleanly!
    let nextAccountNumber = existing.account_number;
    let nextMask = existing.account_number_mask;

    if (body.accountNumber !== undefined) {
      const cleaned = body.accountNumber === null ? null : String(body.accountNumber).trim();
      // If user didn't pass a masked placeholder like "*6789"
      if (cleaned && !cleaned.startsWith('*')) {
        nextAccountNumber = cleaned;
        if (cleaned.length >= 4) {
          nextMask = cleaned.replace(/\D/g, '').slice(-4);
        }
      } else if (cleaned === '' || cleaned === null) {
        nextAccountNumber = null;
      }
    }
    if (body.accountNumberMask !== undefined) {
      nextMask = body.accountNumberMask ? String(body.accountNumberMask).replace(/\D/g, '').slice(-4) : null;
    }

    const targetBalance = body.balance !== undefined ? Number(body.balance) : Number(existing.balance || 0);
    if (!Number.isSafeInteger(targetBalance)) {
      return c.json({ error: 'Số dư không hợp lệ', code: 'INVALID_BALANCE' }, 400);
    }
    const delta = targetBalance - Number(existing.balance || 0);
    const nextRevision = Number(existing.revision || 1) + 1;

    const stmts: D1PreparedStatement[] = [
      db
        .prepare(
          `UPDATE accounts
           SET name = ?,
               type = ?,
               balance = ?,
               account_number_mask = ?,
               account_number = ?,
               bank_code = ?,
               bank_name = ?,
               account_holder = ?,
               branch = ?,
               aliases_json = ?,
               include_in_net_worth = ?,
               is_active = ?,
               revision = ?
           WHERE id = ? AND user_id = ?`
        )
        .bind(
          body.name !== undefined ? body.name : existing.name,
          body.type !== undefined ? body.type : existing.type,
          targetBalance,
          nextMask,
          nextAccountNumber,
          body.bankCode !== undefined ? body.bankCode : existing.bank_code,
          body.bankName !== undefined ? body.bankName : existing.bank_name,
          body.accountHolder !== undefined ? body.accountHolder : existing.account_holder,
          body.branch !== undefined ? body.branch : existing.branch,
          body.aliases !== undefined ? JSON.stringify(body.aliases) : existing.aliases_json,
          body.includeInNetWorth !== undefined ? (body.includeInNetWorth ? 1 : 0) : existing.include_in_net_worth ?? 1,
          body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active ?? 1,
          nextRevision,
          accId,
          userId
        )
    ];

    if (delta !== 0) {
      const postingId = `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      stmts.push(
        db
          .prepare(
            `INSERT INTO ledger_postings (id, user_id, account_id, transaction_id, operation_id, delta_vnd, reason)
             VALUES (?, ?, ?, NULL, ?, ?, 'manual_adjustment')`
          )
          .bind(postingId, userId, accId, operationId, delta)
      );
    }

    await db.batch(stmts);
    const updated = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').bind(accId, userId).first<any>();
    return c.json({ success: true, account: updated, revision: nextRevision });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// V2-11: Safe Account Archive / Delete (Never orphan historical transactions or vanish positive balance!)
app.delete('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const accId = c.req.param('id');

  try {
    const existing = await db
      .prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
      .bind(accId, userId)
      .first<any>();
    if (!existing) {
      return c.json({ error: 'Account not found', code: 'NOT_FOUND' }, 404);
    }

    const txCount = await db
      .prepare(
        'SELECT COUNT(*) as cnt FROM transactions WHERE user_id = ? AND (account_id = ? OR to_account_id = ?) AND deleted_at IS NULL'
      )
      .bind(userId, accId, accId)
      .first<{ cnt: number }>();

    const postingCount = await db
      .prepare('SELECT COUNT(*) as cnt FROM ledger_postings WHERE user_id = ? AND account_id = ?')
      .bind(userId, accId)
      .first<{ cnt: number }>();

    const hasHistory = (txCount?.cnt || 0) > 0 || (postingCount?.cnt || 0) > 0 || Number(existing.balance || 0) !== 0;

    if (hasHistory) {
      await db
        .prepare(
          `UPDATE accounts
           SET is_active = 0, archived_at = CURRENT_TIMESTAMP, revision = COALESCE(revision, 1) + 1
           WHERE id = ? AND user_id = ?`
        )
        .bind(accId, userId)
        .run();
      return c.json({
        success: true,
        action: 'archived',
        id: accId,
        balanceRemaining: Number(existing.balance || 0),
        message: 'Tài khoản có lịch sử giao dịch hoặc số dư nên đã được chuyển sang trạng thái Lưu trữ (Archived) để bảo toàn sổ cái.'
      });
    } else {
      await db.batch([
        db.prepare('DELETE FROM ledger_baselines WHERE account_id = ? AND user_id = ?').bind(accId, userId),
        db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(accId, userId)
      ]);
      return c.json({ success: true, action: 'deleted', id: accId });
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Income Sources & Planned Expenses with Plan Versioning (V2-16)
app.get('/api/income-sources', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  const { results: sources } = await db
    .prepare('SELECT * FROM income_sources WHERE user_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY created_at ASC')
    .bind(userId)
    .all<any>();
  const { results: plans } = await db
    .prepare(
      `SELECT p.*, j.name as jar_name, j.color as jar_color
       FROM planned_expenses p
       LEFT JOIN jars j ON p.jar_id = j.id
       WHERE p.user_id = ? AND COALESCE(p.is_active, 1) = 1
       ORDER BY p.due_day ASC, p.created_at ASC`
    )
    .bind(userId)
    .all<any>();

  return c.json({ incomeSources: sources || [], plannedExpenses: plans || [] });
});

app.post('/api/income-sources', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const body = await c.req.json();
  const id = body.id || `inc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cadence = body.cadence || 'monthly';
  const oneTimeDate = cadence === 'one_time' ? body.oneTimeDate : null;
  if (cadence === 'one_time' && !isValidIsoCalendarDate(oneTimeDate)) {
    return c.json({ error: 'Ngày khoản thu một lần bắt buộc đúng định dạng YYYY-MM-DD và phải là ngày hợp lệ', code: 'INVALID_ONE_TIME_DATE' }, 400);
  }
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO income_sources (id, user_id, name, expected_amount, cadence, one_time_date, expected_day, account_id, icon, color, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      .bind(
        id,
        userId,
        body.name,
        Number(body.expectedAmount || 0),
        cadence,
        oneTimeDate,
        body.expectedDay || 1,
        body.accountId || null,
        body.icon || 'payments',
        body.color || '#10B981'
      )
  ];

  const pvStmts = await buildPlanVersionStatements(db, userId, 'income_source', id, effectiveMonth, {
    id,
    name: body.name,
    expected_amount: Number(body.expectedAmount || 0),
    cadence,
    one_time_date: oneTimeDate,
    expected_day: body.expectedDay || 1,
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id });
});

app.put('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db
    .prepare('SELECT * FROM income_sources WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<any>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name !== undefined ? body.name : existing.name;
  const expectedAmount = body.expectedAmount !== undefined ? Number(body.expectedAmount) : Number(existing.expected_amount || 0);
  const cadence = body.cadence !== undefined ? body.cadence : existing.cadence;
  const oneTimeDate = cadence === 'one_time'
    ? body.oneTimeDate !== undefined ? body.oneTimeDate : existing.one_time_date
    : null;
  if (cadence === 'one_time' && !isValidIsoCalendarDate(oneTimeDate)) {
    return c.json({ error: 'Ngày khoản thu một lần bắt buộc đúng định dạng YYYY-MM-DD và phải là ngày hợp lệ', code: 'INVALID_ONE_TIME_DATE' }, 400);
  }
  const expectedDay = body.expectedDay !== undefined ? body.expectedDay : existing.expected_day;
  const icon = body.icon !== undefined ? body.icon : existing.icon || 'payments';
  const color = body.color !== undefined ? body.color : existing.color || '#10B981';
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  // Ensure initial historical snapshot exists before effectiveMonth if none was recorded yet
  const existingPvCount = await db
    .prepare('SELECT COUNT(*) as cnt FROM plan_versions WHERE user_id = ? AND entity_type = ? AND entity_id = ?')
    .bind(userId, 'income_source', id)
    .first<{ cnt: number }>();

  const stmts: D1PreparedStatement[] = [];
  if ((existingPvCount?.cnt || 0) === 0) {
    const seedMonth = historicalSeedMonth(existing.created_at, effectiveMonth);
    if (seedMonth) stmts.push(
      db
        .prepare(
          `INSERT INTO plan_versions (id, user_id, entity_type, entity_id, effective_from_month, effective_to_month_exclusive, payload_json)
           VALUES (?, ?, 'income_source', ?, ?, ?, ?)`
        )
        .bind(
          `pv_seed_inc_${id}`,
          userId,
          id,
          seedMonth,
          effectiveMonth > seedMonth ? effectiveMonth : null,
          JSON.stringify({
            id,
            name: existing.name,
            expected_amount: Number(existing.expected_amount || 0),
            cadence: existing.cadence || 'monthly',
            one_time_date: existing.one_time_date || null,
            expected_day: existing.expected_day || 1,
            is_active: existing.is_active ?? 1
          })
        )
    );
  }

  stmts.push(
    db
      .prepare(
        `UPDATE income_sources
         SET name = ?, expected_amount = ?, cadence = ?, one_time_date = ?, expected_day = ?, icon = ?, color = ?, revision = COALESCE(revision, 1) + 1
         WHERE id = ? AND user_id = ?`
      )
      .bind(name, expectedAmount, cadence, oneTimeDate, expectedDay, icon, color, id, userId)
  );

  const pvStmts = await buildPlanVersionStatements(db, userId, 'income_source', id, effectiveMonth, {
    id,
    name,
    expected_amount: expectedAmount,
    cadence,
    one_time_date: oneTimeDate,
    expected_day: expectedDay,
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id });
});

app.delete('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const id = c.req.param('id');
  const effectiveMonth = c.req.query('effectiveFromMonth') || getCurrentVnMonth();

  const stmts: D1PreparedStatement[] = [
    db.prepare('DELETE FROM income_sources WHERE id = ? AND user_id = ?').bind(id, userId),
    db
      .prepare(
        `UPDATE plan_versions
         SET effective_to_month_exclusive = ?
         WHERE user_id = ? AND entity_type = 'income_source' AND entity_id = ? AND effective_to_month_exclusive IS NULL`
      )
      .bind(effectiveMonth, userId, id)
  ];
  await db.batch(stmts);
  return c.json({ success: true });
});

app.post('/api/planned-expenses', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const body = await c.req.json();
  const id = body.id || `plan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const cadence = body.cadence || 'monthly';
  const oneTimeDate = cadence === 'one_time' ? body.oneTimeDate : null;
  if (cadence === 'one_time' && !isValidIsoCalendarDate(oneTimeDate)) {
    return c.json({ error: 'Ngày khoản chi một lần bắt buộc đúng định dạng YYYY-MM-DD và phải là ngày hợp lệ', code: 'INVALID_ONE_TIME_DATE' }, 400);
  }
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO planned_expenses (id, user_id, name, expected_amount, cadence, one_time_date, due_day, jar_id, account_id, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      .bind(
        id,
        userId,
        body.name,
        Number(body.expectedAmount || 0),
        cadence,
        oneTimeDate,
        body.dueDay || 1,
        body.jarId || 'jar_nec',
        body.accountId || null
      )
  ];

  const pvStmts = await buildPlanVersionStatements(db, userId, 'planned_expense', id, effectiveMonth, {
    id,
    name: body.name,
    expected_amount: Number(body.expectedAmount || 0),
    cadence,
    one_time_date: oneTimeDate,
    due_day: body.dueDay || 1,
    jar_id: body.jarId || 'jar_nec',
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id });
});

app.put('/api/planned-expenses/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const id = c.req.param('id');
  const body = await c.req.json();

  const existing = await db
    .prepare('SELECT * FROM planned_expenses WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<any>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const name = body.name !== undefined ? body.name : existing.name;
  const expectedAmount = body.expectedAmount !== undefined ? Number(body.expectedAmount) : Number(existing.expected_amount || 0);
  const cadence = body.cadence !== undefined ? body.cadence : existing.cadence;
  const oneTimeDate = cadence === 'one_time'
    ? body.oneTimeDate !== undefined ? body.oneTimeDate : existing.one_time_date
    : null;
  if (cadence === 'one_time' && !isValidIsoCalendarDate(oneTimeDate)) {
    return c.json({ error: 'Ngày khoản chi một lần bắt buộc đúng định dạng YYYY-MM-DD và phải là ngày hợp lệ', code: 'INVALID_ONE_TIME_DATE' }, 400);
  }
  const dueDay = body.dueDay !== undefined ? body.dueDay : existing.due_day;
  const jarId = body.jarId !== undefined ? body.jarId : existing.jar_id;
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  const existingPvCount = await db
    .prepare('SELECT COUNT(*) as cnt FROM plan_versions WHERE user_id = ? AND entity_type = ? AND entity_id = ?')
    .bind(userId, 'planned_expense', id)
    .first<{ cnt: number }>();

  const stmts: D1PreparedStatement[] = [];
  if ((existingPvCount?.cnt || 0) === 0) {
    const seedMonth = historicalSeedMonth(existing.created_at, effectiveMonth);
    if (seedMonth) stmts.push(
      db
        .prepare(
          `INSERT INTO plan_versions (id, user_id, entity_type, entity_id, effective_from_month, effective_to_month_exclusive, payload_json)
           VALUES (?, ?, 'planned_expense', ?, ?, ?, ?)`
        )
        .bind(
          `pv_seed_plan_${id}`,
          userId,
          id,
          seedMonth,
          effectiveMonth > seedMonth ? effectiveMonth : null,
          JSON.stringify({
            id,
            name: existing.name,
            expected_amount: Number(existing.expected_amount || 0),
            cadence: existing.cadence || 'monthly',
            one_time_date: existing.one_time_date || null,
            due_day: existing.due_day || 1,
            jar_id: existing.jar_id || 'jar_nec',
            is_active: existing.is_active ?? 1
          })
        )
    );
  }

  stmts.push(
    db
      .prepare(
        `UPDATE planned_expenses
         SET name = ?, expected_amount = ?, cadence = ?, one_time_date = ?, due_day = ?, jar_id = ?, revision = COALESCE(revision, 1) + 1
         WHERE id = ? AND user_id = ?`
      )
      .bind(name, expectedAmount, cadence, oneTimeDate, dueDay, jarId, id, userId)
  );

  const pvStmts = await buildPlanVersionStatements(db, userId, 'planned_expense', id, effectiveMonth, {
    id,
    name,
    expected_amount: expectedAmount,
    cadence,
    one_time_date: oneTimeDate,
    due_day: dueDay,
    jar_id: jarId,
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id });
});

app.delete('/api/planned-expenses/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const id = c.req.param('id');
  const effectiveMonth = c.req.query('effectiveFromMonth') || getCurrentVnMonth();

  await db.batch([
    db.prepare('DELETE FROM planned_expenses WHERE id = ? AND user_id = ?').bind(id, userId),
    db
      .prepare(
        `UPDATE plan_versions
         SET effective_to_month_exclusive = ?
         WHERE user_id = ? AND entity_type = 'planned_expense' AND entity_id = ? AND effective_to_month_exclusive IS NULL`
      )
      .bind(effectiveMonth, userId, id)
  ]);
  return c.json({ success: true });
});

// Jars CRUD & Largest Remainder Auto-Allocation (V2-17)
app.post('/api/jars', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const body = await c.req.json();
  const id = body.id || `jar_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO jars (id, user_id, name, icon, color, target_percent, monthly_limit, sort_order, is_active, revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1)`
      )
      .bind(
        id,
        userId,
        body.name,
        body.icon || 'account_balance_wallet',
        body.color || '#3B82F6',
        Number(body.targetPercent || 0),
        Number(body.monthlyLimit || 0),
        body.sortOrder || 10
      )
  ];

  const pvStmts = await buildPlanVersionStatements(db, userId, 'jar', id, effectiveMonth, {
    id,
    name: body.name,
    target_percent: Number(body.targetPercent || 0),
    monthly_limit: Number(body.monthlyLimit || 0),
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id });
});

app.put('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const jarId = c.req.param('id');
  const body = await c.req.json();

  const existing = await db.prepare('SELECT * FROM jars WHERE id = ? AND user_id = ?').bind(jarId, userId).first<any>();
  if (!existing) return c.json({ error: 'Jar not found' }, 404);

  const name = body.name !== undefined ? body.name : existing.name;
  const icon = body.icon !== undefined ? body.icon : existing.icon;
  const color = body.color !== undefined ? body.color : existing.color;
  const targetPercent = body.targetPercent !== undefined ? Number(body.targetPercent) : Number(existing.target_percent || 0);
  const monthlyLimit = body.monthlyLimit !== undefined ? Number(body.monthlyLimit) : Number(existing.monthly_limit || 0);
  const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `UPDATE jars
         SET name = ?, icon = ?, color = ?, target_percent = ?, monthly_limit = ?, revision = COALESCE(revision, 1) + 1
         WHERE id = ? AND user_id = ?`
      )
      .bind(name, icon, color, targetPercent, monthlyLimit, jarId, userId)
  ];

  const pvStmts = await buildPlanVersionStatements(db, userId, 'jar', jarId, effectiveMonth, {
    id: jarId,
    name,
    target_percent: targetPercent,
    monthly_limit: monthlyLimit,
    is_active: 1
  });
  stmts.push(...pvStmts);

  await db.batch(stmts);
  return c.json({ success: true, id: jarId });
});

app.delete('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const jarId = c.req.param('id');

  // Nullify references or soft-delete cleanly
  await db.batch([
    db.prepare('DELETE FROM jars WHERE id = ? AND user_id = ?').bind(jarId, userId)
  ]);
  return c.json({ success: true });
});

// V2-17: Exact Largest Remainder Allocation with 100% Weight & Safe Integer Validation
app.post('/api/jars/auto-allocate', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const body = await c.req.json();
    const totalIncome = Number(body.totalIncome);
    const previewOnly = Boolean(body.preview);
    const effectiveMonth = body.effectiveFromMonth || getCurrentVnMonth();

    if (!Number.isFinite(totalIncome) || !Number.isSafeInteger(totalIncome) || totalIncome < 0 || totalIncome > 10_000_000_000_000) {
      return c.json(
        {
          error: 'Tổng thu nhập phân bổ không hợp lệ (cần số nguyên không âm trong phạm vi an toàn)',
          code: 'INVALID_TOTAL_INCOME'
        },
        400
      );
    }

    const { results: jars } = await db
      .prepare('SELECT id, name, target_percent, sort_order FROM jars WHERE user_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY sort_order ASC, id ASC')
      .bind(userId)
      .all<{ id: string; name: string; target_percent: number; sort_order: number }>();

    if (!jars || jars.length === 0) {
      return c.json({ error: 'Không có hũ chi tiêu nào đang hoạt động để phân bổ', code: 'NO_ACTIVE_JARS' }, 400);
    }

    // Allow custom weights override in request or use jars' target_percent
    const items = jars.map((j) => {
      const overridePct = body.weights && body.weights[j.id] !== undefined ? Number(body.weights[j.id]) : Number(j.target_percent || 0);
      // Support both 0..1 (e.g. 0.55) and 0..100 (e.g. 55) representations
      const normalizedFraction = overridePct > 1.0001 ? overridePct / 100 : overridePct;
      const weightBps = Math.round(normalizedFraction * 10000);
      return { id: j.id, name: j.name, weightBps, targetPercent: normalizedFraction };
    });

    const validation = validateAllocationWeights(items);
    if (!validation.valid) {
      return c.json({ error: validation.error, code: 'INVALID_JAR_WEIGHTS' }, 400);
    }

    const allocated = allocateVndLargestRemainder(
      totalIncome,
      items.map((x) => ({ id: x.id, weightBps: x.weightBps }))
    );

    const allocationsMap: Record<string, number> = {};
    for (const item of items) {
      allocationsMap[item.id] = allocated[item.id] ?? 0;
    }

    if (previewOnly) {
      return c.json({
        success: true,
        preview: true,
        totalIncome,
        allocations: allocationsMap
      });
    }

    const stmts: D1PreparedStatement[] = [];
    for (const item of items) {
      const limitVnd = allocationsMap[item.id] ?? 0;
      stmts.push(
        db
          .prepare('UPDATE jars SET monthly_limit = ?, target_percent = ?, revision = COALESCE(revision, 1) + 1 WHERE id = ? AND user_id = ?')
          .bind(limitVnd, item.targetPercent, item.id, userId)
      );
      const pvStmts = await buildPlanVersionStatements(db, userId, 'jar', item.id, effectiveMonth, {
        id: item.id,
        name: item.name,
        target_percent: item.targetPercent,
        monthly_limit: limitVnd,
        is_active: 1
      });
      stmts.push(...pvStmts);
    }

    await db.batch(stmts);
    return c.json({
      success: true,
      totalIncome,
      allocations: allocationsMap
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'AUTO_ALLOCATE_FAILED' }, 400);
  }
});

// ============================================================================
// ANALYTICS SUMMARY WITH HISTORICAL PLAN VERSIONS & EXCLUSIVE BUCKETS (V2-12..V2-16)
// ============================================================================

function listMonthsBetween(startIso: string, endExclusiveIso: string): string[] {
  const start = new Date(startIso);
  const endExclusive = new Date(endExclusiveIso);
  if (isNaN(start.getTime()) || isNaN(endExclusive.getTime()) || start >= endExclusive) return [];

  // Evaluate the first and last included instants in Vietnam's UTC+7 calendar.
  const sVn = new Date(start.getTime() + 7 * 3600 * 1000);
  const eVn = new Date(endExclusive.getTime() - 1 + 7 * 3600 * 1000);

  const months: string[] = [];
  let y = sVn.getUTCFullYear();
  let m = sVn.getUTCMonth() + 1;
  const endY = eVn.getUTCFullYear();
  const endM = eVn.getUTCMonth() + 1;

  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    if (months.length > 240) break; // safety cap
  }
  return months;
}

function getPlannedAmountForMonth(item: any, targetMonth: string): number {
  const amount = Number(item.expected_amount || 0);
  if (amount <= 0) return 0;
  const cadence = item.cadence || 'monthly';
  const [, mmStr] = targetMonth.split('-');
  const monthNum = Number(mmStr);

  if (cadence === 'monthly') {
    return amount;
  }
  if (cadence === 'quarterly') {
    const monthInQuarter = (monthNum - 1) % 3 + 1;
    return Math.floor(amount / 3) + (monthInQuarter <= amount % 3 ? 1 : 0);
  }
  if (cadence === 'annual' || cadence === 'yearly') {
    const base = Math.floor(amount / 12);
    return base + (monthNum <= amount % 12 ? 1 : 0);
  }
  if (cadence === 'semiannual') {
    const monthInHalf = (monthNum - 1) % 6 + 1;
    return Math.floor(amount / 6) + (monthInHalf <= amount % 6 ? 1 : 0);
  }
  if (cadence === 'weekly') {
    const yearly = amount * 52;
    const base = Math.floor(yearly / 12);
    return base + (monthNum <= yearly % 12 ? 1 : 0);
  }
  if (cadence === 'one_time') {
    const oneTimeDate = String(item.one_time_date || '');
    if (oneTimeDate && oneTimeDate.startsWith(targetMonth)) {
      return amount;
    }
    return 0;
  }
  return 0;
}

app.get('/api/analytics/summary', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  const periodType = c.req.query('period') || 'month'; // 'month', 'quarter', 'year', 'all'
  const startDateParam = c.req.query('startDate');
  const endDateParam = c.req.query('endDate');
  const toExclusiveParam = c.req.query('toExclusive');

  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  const currYear = vnNow.getUTCFullYear();
  const currMonth = vnNow.getUTCMonth() + 1;

  let startDate = startDateParam || new Date(Date.UTC(currYear, currMonth - 1, 1) - 7 * 3600 * 1000).toISOString();
  let endDate = endDateParam || new Date(Date.UTC(currYear, currMonth, 1) - 7 * 3600 * 1000 - 1).toISOString();

  if (!startDateParam && !endDateParam) {
    if (periodType === 'quarter') {
      const qStartMonth = Math.floor((currMonth - 1) / 3) * 3 + 1;
      startDate = new Date(Date.UTC(currYear, qStartMonth - 1, 1) - 7 * 3600 * 1000).toISOString();
      endDate = new Date(Date.UTC(currYear, qStartMonth + 2, 1) - 7 * 3600 * 1000 - 1).toISOString();
    } else if (periodType === 'year') {
      startDate = new Date(Date.UTC(currYear, 0, 1) - 7 * 3600 * 1000).toISOString();
      endDate = new Date(Date.UTC(currYear + 1, 0, 1) - 7 * 3600 * 1000 - 1).toISOString();
    } else if (periodType === 'all') {
      startDate = '1970-01-01T00:00:00.000Z';
      endDate = '2099-12-31T23:59:59.999Z';
    }
  }

  const endExclusive = toExclusiveParam || new Date(Date.parse(endDate) + 1).toISOString();

  try {
    const startingRevision = await db.prepare('SELECT revision, plan_revision FROM user_data_revisions WHERE user_id = ?').bind(userId).first<any>();
    const dataRevision = Number(startingRevision?.revision || 0);
    const planRevision = Number(startingRevision?.plan_revision || 0);
    // 1. Fetch all active/current entities
    const { results: jars } = await db
      .prepare('SELECT * FROM jars WHERE user_id = ? ORDER BY sort_order ASC')
      .bind(userId)
      .all<any>();
    const { results: incomeSources } = await db
      .prepare('SELECT * FROM income_sources WHERE user_id = ? ORDER BY created_at ASC')
      .bind(userId)
      .all<any>();
    const { results: plannedExpenses } = await db
      .prepare('SELECT * FROM planned_expenses WHERE user_id = ? ORDER BY created_at ASC')
      .bind(userId)
      .all<any>();
    const { results: planVersions } = await db
      .prepare('SELECT * FROM plan_versions WHERE user_id = ? ORDER BY effective_from_month ASC, created_at ASC')
      .bind(userId)
      .all<any>();

    // 2. Exclusive ID-based grouping for confirmed transactions in range (V2-12, V2-13)
    const { results: confirmedTxs } = await db
      .prepare(
        `SELECT id, type, amount, jar_id, income_source_id, occurred_at, description, account_id, to_account_id
         FROM transactions
         WHERE user_id = ?
           AND status = 'confirmed'
           AND deleted_at IS NULL
           AND COALESCE(history_hidden, 0) = 0
           AND occurred_at >= ?
           AND occurred_at ${toExclusiveParam ? '<' : '<='} ?
         ORDER BY occurred_at DESC`
      )
      .bind(userId, startDate, toExclusiveParam || endDate)
      .all<any>();

    const jarMap = new Map<string, any>();
    for (const j of jars || []) {
      jarMap.set(j.id, {
        id: j.id,
        name: j.name,
        icon: j.icon,
        color: j.color,
        targetPercent: Number(j.target_percent || 0),
        monthlyLimit: Number(j.monthly_limit || 0),
        actualSpent: 0,
        txCount: 0
      });
    }

    const incomeMap = new Map<string, any>();
    for (const s of incomeSources || []) {
      incomeMap.set(s.id, {
        id: s.id,
        name: s.name,
        icon: s.icon || 'payments',
        color: s.color || '#10B981',
        expectedAmount: Number(s.expected_amount || 0),
        cadence: s.cadence || 'monthly',
        actualReceived: 0,
        txCount: 0
      });
    }

    let totalActualIncome = 0;
    let totalActualExpense = 0;
    let totalTransferVolume = 0;

    let unassignedIncome = 0;
    let unassignedIncomeCount = 0;
    let orphanedIncome = 0;
    let orphanedIncomeCount = 0;

    let unassignedExpense = 0;
    let unassignedExpenseCount = 0;
    let orphanedExpense = 0;
    let orphanedExpenseCount = 0;

    for (const tx of confirmedTxs || []) {
      const amt = Number(tx.amount || 0);
      if (tx.type === 'income') {
        totalActualIncome += amt;
        if (!tx.income_source_id) {
          unassignedIncome += amt;
          unassignedIncomeCount++;
        } else if (incomeMap.has(tx.income_source_id)) {
          const entry = incomeMap.get(tx.income_source_id);
          entry.actualReceived += amt;
          entry.txCount++;
        } else {
          orphanedIncome += amt;
          orphanedIncomeCount++;
        }
      } else if (tx.type === 'expense') {
        totalActualExpense += amt;
        if (!tx.jar_id) {
          unassignedExpense += amt;
          unassignedExpenseCount++;
        } else if (jarMap.has(tx.jar_id)) {
          const entry = jarMap.get(tx.jar_id);
          entry.actualSpent += amt;
          entry.txCount++;
        } else {
          orphanedExpense += amt;
          orphanedExpenseCount++;
        }
      } else if (tx.type === 'transfer') {
        totalTransferVolume += amt;
      }
    }

    // 3. Calculate Planned / Expected Totals using Historical Plan Versions (V2-15, V2-16)
    let plannedIncomeTotal: number | null = 0;
    let plannedExpenseTotal: number | null = 0;
    let plannedIncomeComplete = true;
    let plannedExpenseComplete = true;
    let usesCurrentPlanSnapshot = false;
    const currentPlanMonth = getCurrentVnMonth();

    if (periodType === 'all') {
      // V2-15 / AT2-27: "all" period has no single-month denominator!
      plannedIncomeTotal = null;
      plannedExpenseTotal = null;
    } else {
      const monthsInPeriod = listMonthsBetween(startDate, endExclusive);
      const pvByEntity = new Map<string, any[]>();
      for (const pv of planVersions || []) {
        const key = `${pv.entity_type}:${pv.entity_id}`;
        if (!pvByEntity.has(key)) pvByEntity.set(key, []);
        pvByEntity.get(key)!.push(pv);
      }

      for (const m of monthsInPeriod) {
        // Income Sources for month m
        const seenIncomeIds = new Set<string>();
        for (const [key, versions] of pvByEntity.entries()) {
          if (!key.startsWith('income_source:')) continue;
          const entityId = key.slice('income_source:'.length);
          seenIncomeIds.add(entityId);
          // Find version active in month m
          const activeVer = versions
            .filter(
              (v) =>
                v.effective_from_month <= m &&
                (!v.effective_to_month_exclusive || v.effective_to_month_exclusive > m)
            )
            .pop();
          if (activeVer) {
            try {
              const payload = JSON.parse(activeVer.payload_json);
              plannedIncomeTotal += getPlannedAmountForMonth(payload, m);
            } catch {
              // Ignore malformed json
            }
          }
        }
        // Fallback for income sources without plan_versions rows yet
        for (const s of incomeSources || []) {
          if (!seenIncomeIds.has(s.id)) {
            const createdMonth = getCreatedVnMonth(s.created_at);
            if (createdMonth && createdMonth > m) continue;
            if (m === currentPlanMonth) {
              plannedIncomeTotal! += getPlannedAmountForMonth(s, m);
              usesCurrentPlanSnapshot = true;
            } else {
              plannedIncomeComplete = false;
            }
          }
        }

        // Planned Expenses for month m
        const seenPlanIds = new Set<string>();
        for (const [key, versions] of pvByEntity.entries()) {
          if (!key.startsWith('planned_expense:')) continue;
          const entityId = key.slice('planned_expense:'.length);
          seenPlanIds.add(entityId);
          const activeVer = versions
            .filter(
              (v) =>
                v.effective_from_month <= m &&
                (!v.effective_to_month_exclusive || v.effective_to_month_exclusive > m)
            )
            .pop();
          if (activeVer) {
            try {
              const payload = JSON.parse(activeVer.payload_json);
              plannedExpenseTotal += getPlannedAmountForMonth(payload, m);
            } catch {
              // Ignore malformed json
            }
          }
        }
        for (const p of plannedExpenses || []) {
          if (!seenPlanIds.has(p.id)) {
            const createdMonth = getCreatedVnMonth(p.created_at);
            if (createdMonth && createdMonth > m) continue;
            if (m === currentPlanMonth) {
              plannedExpenseTotal! += getPlannedAmountForMonth(p, m);
              usesCurrentPlanSnapshot = true;
            } else {
              plannedExpenseComplete = false;
            }
          }
        }
      }
      if (!plannedIncomeComplete) plannedIncomeTotal = null;
      if (!plannedExpenseComplete) plannedExpenseTotal = null;
    }

    const jarBuckets = Array.from(jarMap.values());
    if (unassignedExpense > 0 || unassignedExpenseCount > 0) {
      jarBuckets.push({
        id: '__unassigned__',
        name: 'Chưa phân hũ',
        icon: 'help_outline',
        color: '#94A3B8',
        targetPercent: 0,
        monthlyLimit: 0,
        actualSpent: unassignedExpense,
        txCount: unassignedExpenseCount,
        isUnassigned: true
      });
    }
    if (orphanedExpense > 0 || orphanedExpenseCount > 0) {
      jarBuckets.push({
        id: '__orphaned__',
        name: 'Hũ đã xóa (Orphaned)',
        icon: 'archive',
        color: '#64748B',
        targetPercent: 0,
        monthlyLimit: 0,
        actualSpent: orphanedExpense,
        txCount: orphanedExpenseCount,
        isOrphaned: true
      });
    }

    const incomeBuckets = Array.from(incomeMap.values());
    if (unassignedIncome > 0 || unassignedIncomeCount > 0) {
      incomeBuckets.push({
        id: '__unassigned__',
        name: 'Chưa gán nguồn thu',
        icon: 'help_outline',
        color: '#94A3B8',
        expectedAmount: 0,
        cadence: 'monthly',
        actualReceived: unassignedIncome,
        txCount: unassignedIncomeCount,
        isUnassigned: true
      });
    }
    if (orphanedIncome > 0 || orphanedIncomeCount > 0) {
      incomeBuckets.push({
        id: '__orphaned__',
        name: 'Nguồn thu đã xóa (Orphaned)',
        icon: 'archive',
        color: '#64748B',
        expectedAmount: 0,
        cadence: 'monthly',
        actualReceived: orphanedIncome,
        txCount: orphanedIncomeCount,
        isOrphaned: true
      });
    }

    const endingRevision = await db.prepare('SELECT revision, plan_revision FROM user_data_revisions WHERE user_id = ?').bind(userId).first<any>();
    if (Number(endingRevision?.revision || 0) !== dataRevision || Number(endingRevision?.plan_revision || 0) !== planRevision) {
      return c.json({ error: 'Dữ liệu đã thay đổi trong khi tạo báo cáo; hãy tải lại', code: 'STALE_SUMMARY' }, 409);
    }

    return c.json({
      period: {
        type: periodType,
        startDate,
        endDate
      },
      totals: {
        actualIncome: totalActualIncome,
        actualExpense: totalActualExpense,
        netCashflow: totalActualIncome - totalActualExpense,
        transferVolume: totalTransferVolume,
        plannedIncome: plannedIncomeTotal,
        plannedExpense: plannedExpenseTotal,
        incomeCompletionPct:
          plannedIncomeTotal && plannedIncomeTotal > 0
            ? Number(((totalActualIncome / plannedIncomeTotal) * 100).toFixed(2))
            : null,
        expenseCompletionPct:
          plannedExpenseTotal && plannedExpenseTotal > 0
            ? Number(((totalActualExpense / plannedExpenseTotal) * 100).toFixed(2))
            : null
      },
      planCompleteness: {
        plannedIncomeComplete,
        plannedExpenseComplete,
        usesCurrentPlanSnapshot
      },
      dataRevision,
      planRevision,
      jarBuckets,
      incomeBuckets,
      unassigned: {
        income: unassignedIncome,
        incomeCount: unassignedIncomeCount,
        expense: unassignedExpense,
        expenseCount: unassignedExpenseCount
      },
      orphaned: {
        income: orphanedIncome,
        incomeCount: orphanedIncomeCount,
        expense: orphanedExpense,
        expenseCount: orphanedExpenseCount
      }
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// INVESTMENTS, MARKET PRICES & XIRR (V2-18, V2-19)
// ============================================================================

function parseExternalCashflowDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(text);
  const parsed = new Date(dateOnly ? `${text}T00:00:00.000Z` : text);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (dateOnly && parsed.toISOString().slice(0, 10) !== text) return null;
  return parsed.toISOString();
}

async function getPortfolioXirr(db: D1Database, userId: string) {
  const [flowRows, settings, holdingsRows, cashRows] = await Promise.all([
    db.prepare('SELECT id, type, amount_vnd, occurred_at, note, created_at FROM investment_cashflows WHERE user_id = ? ORDER BY occurred_at ASC, id ASC').bind(userId).all<any>(),
    db.prepare('SELECT complete_from FROM investment_cashflow_settings WHERE user_id = ?').bind(userId).first<any>(),
    db.prepare(`SELECT h.quantity, a.current_price, a.currency, a.price_as_of, a.sync_status, a.provider
      FROM holdings h JOIN assets a ON h.asset_id = a.id WHERE h.user_id = ?`).bind(userId).all<any>(),
    db.prepare(`SELECT balance, currency FROM accounts WHERE user_id = ? AND type IN ('securities', 'crypto')
      AND COALESCE(include_in_net_worth, 1) = 1`).bind(userId).all<any>()
  ]);

  const cashflows = flowRows.results || [];
  const historyCompleteFrom = settings?.complete_from || null;
  const valuationDate = new Date().toISOString();
  const today = valuationDate.slice(0, 10);
  let terminalValueVnd = 0;
  let valuationUnavailable = false;
  let valuationFailureCode: 'TERMINAL_VALUE_UNAVAILABLE' | 'UNSUPPORTED_CURRENCY' = 'TERMINAL_VALUE_UNAVAILABLE';
  let priceAsOfOldestMs: number | null = null;

  for (const holding of holdingsRows.results || []) {
    const quantity = Number(holding.quantity);
    const price = Number(holding.current_price);
    const priceAsOf = typeof holding.price_as_of === 'string' ? new Date(holding.price_as_of).getTime() : NaN;
    if (!Number.isFinite(quantity) || quantity < 0) {
      valuationUnavailable = true;
      break;
    }
    if (quantity === 0) continue;
    if (String(holding.currency || '').toUpperCase() !== 'VND') {
      valuationUnavailable = true;
      valuationFailureCode = 'UNSUPPORTED_CURRENCY';
      break;
    }
    const isExternalPriceFeed = Boolean(holding.provider && holding.provider !== 'manual');
    if (!Number.isFinite(price) || price <= 0 ||
        !Number.isFinite(priceAsOf) || priceAsOf > Date.now() + 60_000 ||
        (isExternalPriceFeed && ['stale', 'error'].includes(String(holding.sync_status)))) {
      valuationUnavailable = true;
      break;
    }
    priceAsOfOldestMs = priceAsOfOldestMs === null ? priceAsOf : Math.min(priceAsOfOldestMs, priceAsOf);
    terminalValueVnd += Math.round(quantity * price);
  }
  // Securities/crypto account balances are explicitly treated as uninvested cash, including negative balances.
  if (!valuationUnavailable) {
    for (const account of cashRows.results || []) {
      if (String(account.currency || '').toUpperCase() !== 'VND') {
        valuationUnavailable = true;
        valuationFailureCode = 'UNSUPPORTED_CURRENCY';
        break;
      }
      const balance = Number(account.balance);
      if (!Number.isFinite(balance)) {
        valuationUnavailable = true;
        break;
      }
      terminalValueVnd += balance;
    }
  }

  let reasonCode: string | null = null;
  let message = '';
  let rate: number | null = null;
  if (!historyCompleteFrom) {
    reasonCode = 'HISTORY_INCOMPLETE';
    message = 'Hãy ghi đủ mọi khoản góp/rút từ ngày bắt đầu và xác nhận mốc lịch sử đầy đủ trước khi xem XIRR.';
  } else if (cashflows.some((flow: any) => String(flow.occurred_at).slice(0, 10) < historyCompleteFrom)) {
    reasonCode = 'FLOW_BEFORE_COMPLETE_FROM';
    message = 'Có dòng tiền trước mốc lịch sử được xác nhận; hãy sửa mốc hoặc bổ sung lịch sử trước khi xem XIRR.';
  } else if (valuationUnavailable) {
    reasonCode = valuationFailureCode;
    message = valuationFailureCode === 'UNSUPPORTED_CURRENCY'
      ? 'Chưa thể tính XIRR: mọi giá trị cuối kỳ phải được quy đổi sang VND; hiện chưa có tỷ giá được xác minh cho currency của tài sản/tài khoản.'
      : 'Chưa thể xác định giá trị cuối kỳ vì thiếu giá/ngày giá hợp lệ hoặc nguồn giá tự động đang stale/lỗi.';
  } else if (cashflows.length === 0) {
    reasonCode = 'INSUFFICIENT_CASHFLOWS';
    message = 'Cần có ít nhất một khoản góp/rút đã ghi nhận để tính XIRR.';
  } else if (cashflows.some((flow: any) => String(flow.occurred_at) > valuationDate)) {
    reasonCode = 'FUTURE_CASHFLOW';
    message = 'Dòng tiền có ngày sau ngày định giá hiện tại.';
  } else {
    const solverFlows = cashflows.map((flow: any) => ({
      amount: flow.type === 'contribution' ? -Number(flow.amount_vnd) : Number(flow.amount_vnd),
      date: flow.occurred_at
    }));
    solverFlows.push({ amount: terminalValueVnd, date: valuationDate });
    const nonZeroSigns = solverFlows.map((flow) => Math.sign(flow.amount)).filter((sign) => sign !== 0);
    const signChanges = nonZeroSigns.slice(1).reduce((count, sign, index) => count + (sign !== nonZeroSigns[index] ? 1 : 0), 0);
    rate = signChanges <= 1 ? calculateXIRR(solverFlows) : null;
    const firstDate = Math.min(...solverFlows.map((flow) => new Date(flow.date).getTime()));
    const residual = rate === null || !Number.isFinite(rate) || rate <= -1 ? Infinity : solverFlows.reduce((sum, flow) => {
      const years = (new Date(flow.date).getTime() - firstDate) / (365 * 24 * 60 * 60 * 1000);
      return sum + flow.amount / Math.pow(1 + rate!, years);
    }, 0);
    const residualTolerance = Math.max(0.01, solverFlows.reduce((sum, flow) => sum + Math.abs(flow.amount), 0) * 1e-8);
    if (rate === null || !Number.isFinite(rate) || rate <= -1 || !Number.isFinite(residual) || Math.abs(residual) > residualTolerance) {
      rate = null;
      reasonCode = 'XIRR_UNDEFINED';
      message = 'Dòng tiền chưa có nghiệm XIRR xác định hoặc bộ giải không hội tụ.';
    } else {
      message = 'XIRR tính từ các khoản góp/rút đã ghi rõ, giá trị holdings theo giá đã lưu, và tiền chưa đầu tư trong tài khoản securities/crypto.';
    }
  }

  return {
    cashflows,
    historyCompleteFrom,
    xirr: {
      rate,
      annualizedPct: rate === null ? null : Number((rate * 100).toFixed(2)),
      reasonCode,
      message,
      terminalValueVnd: valuationUnavailable ? null : Math.round(terminalValueVnd),
      priceAsOfOldest: priceAsOfOldestMs === null ? null : new Date(priceAsOfOldestMs).toISOString(),
      valuationDate
    }
  };
}

app.get('/api/holdings', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const { results: holdings } = await db
      .prepare(
        `SELECT h.*, a.symbol, a.name as asset_name, a.asset_class, a.current_price,
                a.unit, a.quote_unit, a.provider, a.price_as_of, a.sync_status, a.updated_at as price_updated_at
         FROM holdings h
         JOIN assets a ON h.asset_id = a.id
         WHERE h.user_id = ?
         ORDER BY h.updated_at DESC`
      )
      .bind(userId)
      .all<any>();

    const { results: invTxs } = await db
      .prepare('SELECT * FROM investment_transactions WHERE user_id = ? ORDER BY occurred_at ASC')
      .bind(userId)
      .all<any>();

    // Enrich each holding with unrealized PnL, exact ROI (null if costBasis <= 0), and compute portfolio XIRR
    const enrichedHoldings = (holdings || []).map((h) => {
      const qty = Number(h.quantity || 0);
      const avgCost = Number(h.avg_cost || 0);
      const currentPrice = Number(h.current_price || 0);
      const costBasisVnd = Math.round(qty * avgCost);
      const marketValueVnd = Math.round(qty * currentPrice);
      const unrealizedPnlVnd = marketValueVnd - costBasisVnd;
      const simpleRoiPct = costBasisVnd > 0 ? Number(((unrealizedPnlVnd / costBasisVnd) * 100).toFixed(2)) : null;

      return {
        ...h,
        quantity: qty,
        avg_cost: avgCost,
        current_price: currentPrice,
        costBasisVnd,
        marketValueVnd,
        unrealizedPnlVnd,
        simpleRoiPct
      };
    });

    const portfolioXirr = await getPortfolioXirr(db, userId);

    return c.json({
      holdings: enrichedHoldings,
      investmentTransactions: invTxs || [],
      xirr: portfolioXirr.xirr
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Create or Edit Holding by Stable ID (V2-18: Renaming symbol updates in-place instead of duplicating!)
app.post('/api/holdings', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const body = await c.req.json();
    const holdingId = body.id ? String(body.id).trim() : null;
    const symbol = String(body.symbol || '').toUpperCase().trim();
    const name = String(body.name || symbol).trim();
    const assetClass = body.assetClass || 'stock';
    const unit = body.unit || (assetClass === 'gold' ? 'luong' : assetClass === 'fund' ? 'ccq' : assetClass === 'crypto' ? 'coin' : 'share');
    const quantity = Number(body.quantity);
    const avgCost = Number(body.avgCost);
    const currentPrice = body.currentPrice !== undefined ? Number(body.currentPrice) : avgCost;

    if (!symbol) {
      return c.json({ error: 'Vui lòng nhập mã tài sản (symbol)', code: 'MISSING_SYMBOL' }, 400);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ error: 'Số lượng nắm giữ phải lớn hơn 0', code: 'INVALID_QUANTITY' }, 400);
    }
    if (!Number.isFinite(avgCost) || avgCost < 0 || !Number.isFinite(currentPrice) || currentPrice < 0) {
      return c.json({ error: 'Giá vốn hoặc thị giá không hợp lệ', code: 'INVALID_PRICE' }, 400);
    }

    const nowIso = new Date().toISOString();

    // If holdingId is provided, update that exact holding!
    if (holdingId) {
      const existingHolding = await db
        .prepare('SELECT * FROM holdings WHERE id = ? AND user_id = ?')
        .bind(holdingId, userId)
        .first<any>();

      if (existingHolding) {
        // Ensure target asset exists or update existing asset
        let asset = await db.prepare('SELECT * FROM assets WHERE symbol = ?').bind(symbol).first<any>();
        let assetId = existingHolding.asset_id;

        if (!asset) {
          // Check if any other holding uses the old asset_id; if not, we can rename the asset symbol directly
          const otherCount = await db
            .prepare('SELECT COUNT(*) as cnt FROM holdings WHERE asset_id = ? AND id != ?')
            .bind(existingHolding.asset_id, holdingId)
            .first<{ cnt: number }>();

          if ((otherCount?.cnt || 0) === 0) {
            await db
              .prepare(
                `UPDATE assets
                 SET symbol = ?, name = ?, asset_class = ?, unit = ?, quote_unit = ?, current_price = ?, price_as_of = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`
              )
              .bind(symbol, name, assetClass, unit, unit, currentPrice, nowIso, existingHolding.asset_id)
              .run();
            assetId = existingHolding.asset_id;
          } else {
            assetId = `asset_${symbol.toLowerCase()}_${Date.now()}`;
            await db
              .prepare(
                `INSERT INTO assets (id, symbol, name, asset_class, unit, quote_unit, current_price, price_as_of, sync_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok')`
              )
              .bind(assetId, symbol, name, assetClass, unit, unit, currentPrice, nowIso)
              .run();
          }
        } else {
          assetId = asset.id;
          await db
            .prepare(
              `UPDATE assets
               SET name = ?, asset_class = ?, unit = ?, current_price = ?, price_as_of = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`
            )
            .bind(name, assetClass, unit, currentPrice, nowIso, assetId)
            .run();
        }

        await db
          .prepare(
            `UPDATE holdings
             SET asset_id = ?, quantity = ?, holding_unit = ?, avg_cost = ?, revision = COALESCE(revision, 1) + 1, updated_at = CURRENT_TIMESTAMP
             WHERE id = ? AND user_id = ?`
          )
          .bind(assetId, quantity, unit, avgCost, holdingId, userId)
          .run();

        return c.json({ success: true, id: holdingId, assetId, updated: true });
      }
    }

    // Upsert asset by symbol
    let asset = await db.prepare('SELECT * FROM assets WHERE symbol = ?').bind(symbol).first<any>();
    let assetId = asset?.id;

    if (!asset) {
      assetId = `asset_${symbol.toLowerCase()}_${Date.now()}`;
      await db
        .prepare(
          `INSERT INTO assets (id, symbol, name, asset_class, unit, quote_unit, provider, current_price, price_as_of, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, 'ok')`
        )
        .bind(assetId, symbol, name, assetClass, unit, unit, currentPrice, nowIso)
        .run();
    } else {
      await db
        .prepare(
          `UPDATE assets
           SET current_price = ?, name = ?, asset_class = ?, unit = ?, price_as_of = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(currentPrice, name, assetClass, unit, nowIso, assetId)
        .run();
    }

    const existingByAsset = await db
      .prepare('SELECT id FROM holdings WHERE user_id = ? AND asset_id = ?')
      .bind(userId, assetId)
      .first<any>();

    let finalHoldingId = existingByAsset?.id;
    if (existingByAsset) {
      await db
        .prepare(
          `UPDATE holdings
           SET quantity = ?, holding_unit = ?, avg_cost = ?, revision = COALESCE(revision, 1) + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(quantity, unit, avgCost, existingByAsset.id)
        .run();
    } else {
      finalHoldingId = holdingId || `hold_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await db
        .prepare(
          `INSERT INTO holdings (id, user_id, asset_id, quantity, holding_unit, avg_cost, revision)
           VALUES (?, ?, ?, ?, ?, ?, 1)`
        )
        .bind(finalHoldingId, userId, assetId, quantity, unit, avgCost)
        .run();
    }

    return c.json({ success: true, id: finalHoldingId, assetId });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete('/api/holdings/:id', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const holdId = c.req.param('id');
  try {
    await db
      .prepare(
        `DELETE FROM holdings
         WHERE user_id = ?
           AND (id = ? OR asset_id = ? OR asset_id IN (SELECT id FROM assets WHERE UPPER(symbol) = UPPER(?)))`
      )
      .bind(userId, holdId, holdId, holdId)
      .run();
    return c.json({ success: true });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Investment Cashflow Transactions (Buy / Sell / Dividend / Fee / Tax) (V2-19)
app.get('/api/investment-transactions', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const { results } = await db
    .prepare(
      `SELECT it.*, a.symbol, a.name as asset_name
       FROM investment_transactions it
       LEFT JOIN assets a ON it.asset_id = a.id
       WHERE it.user_id = ?
       ORDER BY it.occurred_at DESC`
    )
    .bind(userId)
    .all<any>();
  return c.json({ investmentTransactions: results || [] });
});

// Portfolio-level external cashflow history. These records never mutate account balances.
app.get('/api/investment-cashflows', async (c) => {
  try {
    return c.json(await getPortfolioXirr(c.env.DB, c.get('principal').userId));
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/investment-cashflows', async (c) => {
  const db = c.env.DB;
  const userId = c.get('principal').userId;
  try {
    const body = await c.req.json();
    const type = String(body.type || '');
    const amountVnd = Number(body.amountVnd);
    const occurredAt = parseExternalCashflowDate(body.occurredAt);
    const note = body.note === undefined || body.note === null ? null : String(body.note).trim();
    if (type !== 'contribution' && type !== 'withdrawal') {
      return c.json({ error: 'Loại dòng tiền phải là contribution hoặc withdrawal', code: 'INVALID_CASHFLOW_TYPE' }, 400);
    }
    if (!Number.isSafeInteger(amountVnd) || amountVnd <= 0) {
      return c.json({ error: 'Số tiền phải là số nguyên VND lớn hơn 0', code: 'INVALID_CASHFLOW_AMOUNT' }, 400);
    }
    if (!occurredAt) return c.json({ error: 'Ngày dòng tiền không hợp lệ', code: 'INVALID_CASHFLOW_DATE' }, 400);
    if (occurredAt > new Date().toISOString()) {
      return c.json({ error: 'Ngày dòng tiền không được ở tương lai', code: 'FUTURE_CASHFLOW' }, 400);
    }
    if (note && note.length > 500) return c.json({ error: 'Ghi chú tối đa 500 ký tự', code: 'CASHFLOW_NOTE_TOO_LONG' }, 400);
    const settings = await db.prepare('SELECT complete_from FROM investment_cashflow_settings WHERE user_id = ?').bind(userId).first<any>();
    if (settings?.complete_from && occurredAt.slice(0, 10) < settings.complete_from) {
      return c.json({ error: 'Ngày này trước mốc lịch sử đầy đủ; hãy xóa mốc xác nhận trước khi bổ sung lịch sử', code: 'FLOW_BEFORE_COMPLETE_FROM' }, 400);
    }
    const id = typeof body.id === 'string' && body.id.trim() ? body.id.trim() : `cashflow_${crypto.randomUUID()}`;
    await db.prepare(`INSERT INTO investment_cashflows (id, user_id, type, amount_vnd, occurred_at, note)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, userId, type, amountVnd, occurredAt, note || null).run();
    return c.json({ success: true, id, ...(await getPortfolioXirr(db, userId)) });
  } catch (err: any) {
    if (/UNIQUE constraint failed: investment_cashflows\.id/i.test(String(err?.message || err))) {
      return c.json({ error: 'Dòng tiền đã tồn tại', code: 'CASHFLOW_ID_CONFLICT' }, 409);
    }
    return c.json({ error: err.message }, 500);
  }
});

app.put('/api/investment-cashflows/completeness', async (c) => {
  const db = c.env.DB;
  const userId = c.get('principal').userId;
  try {
    const body = await c.req.json();
    if (body.completeFrom === null) {
      await db.prepare('DELETE FROM investment_cashflow_settings WHERE user_id = ?').bind(userId).run();
      return c.json({ success: true, ...(await getPortfolioXirr(db, userId)) });
    }
    const completeFrom = typeof body.completeFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.completeFrom)
      ? parseExternalCashflowDate(body.completeFrom)?.slice(0, 10) || null
      : null;
    if (!completeFrom) return c.json({ error: 'completeFrom phải là ngày hợp lệ dạng YYYY-MM-DD hoặc null', code: 'INVALID_COMPLETENESS_DATE' }, 400);
    if (completeFrom > new Date().toISOString().slice(0, 10)) {
      return c.json({ error: 'Mốc lịch sử đầy đủ không được ở tương lai', code: 'INVALID_COMPLETENESS_DATE' }, 400);
    }
    const earlier = await db.prepare('SELECT id FROM investment_cashflows WHERE user_id = ? AND substr(occurred_at, 1, 10) < ? LIMIT 1')
      .bind(userId, completeFrom).first<any>();
    if (earlier) return c.json({ error: 'Đã có dòng tiền trước mốc được xác nhận; hãy sửa mốc hoặc xóa/sửa dòng tiền', code: 'FLOW_BEFORE_COMPLETE_FROM' }, 400);
    await db.prepare(`INSERT INTO investment_cashflow_settings (user_id, complete_from, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET complete_from = excluded.complete_from, updated_at = CURRENT_TIMESTAMP`)
      .bind(userId, completeFrom).run();
    return c.json({ success: true, ...(await getPortfolioXirr(db, userId)) });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.delete('/api/investment-cashflows/:id', async (c) => {
  const db = c.env.DB;
  const userId = c.get('principal').userId;
  try {
    const id = c.req.param('id');
    const result = await db.prepare('DELETE FROM investment_cashflows WHERE id = ? AND user_id = ?').bind(id, userId).run();
    if (!result.meta?.changes) return c.json({ error: 'Không tìm thấy dòng tiền', code: 'CASHFLOW_NOT_FOUND' }, 404);
    return c.json({ success: true, ...(await getPortfolioXirr(db, userId)) });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/investment-transactions', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const body = await c.req.json();
    const operationId = body.operationId || c.req.header('X-Operation-Id') || `op_inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const type = String(body.type || 'buy'); // 'buy', 'sell', 'dividend', 'interest', 'fee', 'tax'
    if (!['buy', 'sell', 'dividend', 'interest', 'fee', 'tax'].includes(type)) {
      return c.json({ error: 'Loại giao dịch đầu tư không hợp lệ', code: 'INVALID_INV_TYPE' }, 400);
    }

    const symbol = String(body.symbol || '').toUpperCase().trim();
    let assetId = body.assetId;
    if (!assetId && symbol) {
      const asset = await db.prepare('SELECT id FROM assets WHERE symbol = ?').bind(symbol).first<{ id: string }>();
      if (asset) {
        assetId = asset.id;
      } else {
        assetId = `asset_${symbol.toLowerCase()}_${Date.now()}`;
        await db
          .prepare(
            `INSERT INTO assets (id, symbol, name, asset_class, unit, quote_unit, current_price, price_as_of)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
          )
          .bind(
            assetId,
            symbol,
            body.assetName || symbol,
            body.assetClass || 'stock',
            body.unit || 'share',
            body.unit || 'share',
            Number(body.unitPrice || 0)
          )
          .run();
      }
    }

    if (!assetId) {
      return c.json({ error: 'Thiếu thông tin tài sản đầu tư (assetId hoặc symbol)', code: 'MISSING_ASSET' }, 400);
    }

    const quantity = Number(body.quantity || 0);
    const unitPrice = Number(body.unitPrice || 0);
    const fee = Math.round(Number(body.fee || 0));
    const tax = Math.round(Number(body.tax || 0));
    const occurredAt = body.occurredAt ? new Date(body.occurredAt).toISOString() : new Date().toISOString();

    let totalAmountVnd = body.totalAmountVnd !== undefined ? Math.round(Number(body.totalAmountVnd)) : 0;
    if (!totalAmountVnd) {
      if (type === 'buy') {
        totalAmountVnd = Math.round(quantity * unitPrice) + fee + tax;
      } else if (type === 'sell') {
        totalAmountVnd = Math.round(quantity * unitPrice) - fee - tax;
      } else {
        totalAmountVnd = Math.round(Number(body.amount || 0));
      }
    }

    const existingHolding = await db
      .prepare('SELECT * FROM holdings WHERE user_id = ? AND asset_id = ? LIMIT 1')
      .bind(userId, assetId)
      .first<any>();

    const stmts: D1PreparedStatement[] = [];
    const invTxId = body.id || `invtx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    if (type === 'buy') {
      const oldQty = Number(existingHolding?.quantity || 0);
      const oldAvg = Number(existingHolding?.avg_cost || 0);
      const newQty = oldQty + quantity;
      const newAvg = newQty > 0 ? (oldQty * oldAvg + totalAmountVnd) / newQty : unitPrice;

      if (existingHolding) {
        stmts.push(
          db
            .prepare('UPDATE holdings SET quantity = ?, avg_cost = ?, revision = COALESCE(revision, 1) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(newQty, newAvg, existingHolding.id)
        );
      } else {
        stmts.push(
          db
            .prepare('INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost, revision) VALUES (?, ?, ?, ?, ?, 1)')
            .bind(`hold_${Date.now()}`, userId, assetId, newQty, newAvg)
        );
      }
    } else if (type === 'sell') {
      const oldQty = Number(existingHolding?.quantity || 0);
      if (quantity > oldQty + 1e-9) {
        return c.json({ error: 'Số lượng bán vượt quá số lượng đang nắm giữ', code: 'INSUFFICIENT_HOLDING_QTY' }, 400);
      }
      const remainingQty = Math.max(0, Number((oldQty - quantity).toFixed(8)));
      if (existingHolding) {
        stmts.push(
          db
            .prepare('UPDATE holdings SET quantity = ?, revision = COALESCE(revision, 1) + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(remainingQty, existingHolding.id)
        );
      }
    }

    // Optional cash account deduction/credit ONLY if explicitly requested and not already linked to a bank notification
    const accountId = body.accountId || null;
    const deductAccountCash = Boolean(body.affectCashAccount) && accountId && !body.linkedTransactionId;
    if (deductAccountCash) {
      const cashDelta = type === 'buy' || type === 'fee' || type === 'tax' ? -Math.abs(totalAmountVnd) : Math.abs(totalAmountVnd);
      stmts.push(...buildLedgerDeltaStatements(db, userId, accountId, cashDelta, `investment_${type}`, operationId, null));
    }

    stmts.push(
      db
        .prepare(
          `INSERT INTO investment_transactions (
            id, user_id, asset_id, account_id, type, occurred_at,
            quantity, unit_price, fee, tax, total_amount_vnd, linked_transaction_id, operation_id, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          invTxId,
          userId,
          assetId,
          accountId,
          type,
          occurredAt,
          quantity,
          unitPrice,
          fee,
          tax,
          totalAmountVnd,
          body.linkedTransactionId || null,
          operationId,
          body.note || null
        )
    );

    await db.batch(stmts);
    return c.json({ success: true, id: invTxId, totalAmountVnd });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// Market Sync Prices (V2-18: SJC never overwritten by BTMC gold ring; stale state surfaced on failure!)
async function syncMarketPrices(db: D1Database): Promise<{ updated: Record<string, number>; staleAssets: string[] }> {
  const { results: assets } = await db.prepare('SELECT * FROM assets').all<any>();
  if (!assets || assets.length === 0) return { updated: {}, staleAssets: [] };

  const updated: Record<string, number> = {};
  const staleAssets: string[] = [];
  const nowIso = new Date().toISOString();

  // 1. Gold prices (Separate SJC 9999 vs GOLD_RING / NHAN_TRON strictly!)
  const goldAssets = assets.filter((a) => a.asset_class === 'gold');
  for (const g of goldAssets) {
    const sym = String(g.symbol || '').toUpperCase();
    let fetchedPrice = 0;
    let providerName = 'btmc';

    try {
      const res = await fetch('http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1ll99t45h18hmn715p2v', {
        headers: { Accept: 'application/json' }
      });
      if (res.ok) {
        const text = await res.text();
        if (sym.includes('SJC')) {
          // Only match row containing SJC specifically
          const sjcMatch = text.match(/SJC[\s\S]{0,200}?pb="(\d{6,9})"/i);
          if (sjcMatch) {
            const rawPrice = parseInt(sjcMatch[1], 10);
            fetchedPrice = rawPrice < 20_000_000 ? rawPrice * 10 : rawPrice;
          }
        } else {
          // Gold ring / Nhan tron
          const ringMatch = text.match(/(?:Nhẫn tròn trơn|NHAN TRON|VRTL)[\s\S]{0,200}?pb="(\d{6,9})"/i);
          if (ringMatch) {
            const rawPrice = parseInt(ringMatch[1], 10);
            fetchedPrice = rawPrice < 20_000_000 ? rawPrice * 10 : rawPrice;
          }
        }
      }
    } catch {
      // External API unreachable
    }

    if (fetchedPrice > 0) {
      await db
        .prepare(
          `UPDATE assets
           SET current_price = ?, provider = ?, price_as_of = ?, sync_status = 'ok', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(fetchedPrice, providerName, nowIso, g.id)
        .run();
      updated[g.symbol] = fetchedPrice;
    } else {
      await db
        .prepare(`UPDATE assets SET sync_status = 'stale' WHERE id = ?`)
        .bind(g.id)
        .run();
      staleAssets.push(g.symbol);
    }
  }

  // 2. Stocks (VNDirect)
  const stockAssets = assets.filter((a) => a.asset_class === 'stock');
  for (const s of stockAssets) {
    let fetchedPrice = 0;
    try {
      const vndRes = await fetch(
        `https://finfo-api.vndirect.com.vn/v4/stock_prices/?q=code:${s.symbol.toUpperCase()}~date:gte:2025-01-01&size=1&sort=date`
      );
      if (vndRes.ok) {
        const vndData: any = await vndRes.json();
        if (vndData?.data?.length > 0) {
          const closePrice = Number(vndData.data[0].close);
          fetchedPrice = closePrice < 1000 ? Math.round(closePrice * 1000) : Math.round(closePrice);
        }
      }
    } catch {
      // Ignore network failure
    }

    if (fetchedPrice > 0) {
      await db
        .prepare(
          `UPDATE assets
           SET current_price = ?, provider = 'vndirect', price_as_of = ?, sync_status = 'ok', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(fetchedPrice, nowIso, s.id)
        .run();
      updated[s.symbol] = fetchedPrice;
    } else {
      await db.prepare(`UPDATE assets SET sync_status = 'stale' WHERE id = ?`).bind(s.id).run();
      staleAssets.push(s.symbol);
    }
  }

  // 3. Crypto (CoinGecko)
  const cryptoAssets = assets.filter((a) => a.asset_class === 'crypto');
  if (cryptoAssets.length > 0) {
    const cgMap: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      BNB: 'binancecoin',
      USDT: 'tether',
      XRP: 'ripple',
      ADA: 'cardano',
      DOGE: 'dogecoin',
      TON: 'the-open-network'
    };
    for (const ca of cryptoAssets) {
      const cgId = cgMap[ca.symbol.toUpperCase()] || ca.symbol.toLowerCase();
      let fetchedPrice = 0;
      try {
        const cgRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=vnd`);
        if (cgRes.ok) {
          const cgData: any = await cgRes.json();
          if (cgData?.[cgId]?.vnd) {
            fetchedPrice = Number(cgData[cgId].vnd);
          }
        }
      } catch {
        // Ignore network failure
      }

      if (fetchedPrice > 0) {
        await db
          .prepare(
            `UPDATE assets
             SET current_price = ?, provider = 'coingecko', price_as_of = ?, sync_status = 'ok', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .bind(fetchedPrice, nowIso, ca.id)
          .run();
        updated[ca.symbol] = fetchedPrice;
      } else {
        await db.prepare(`UPDATE assets SET sync_status = 'stale' WHERE id = ?`).bind(ca.id).run();
        staleAssets.push(ca.symbol);
      }
    }
  }

  return { updated, staleAssets };
}

app.post('/api/market/sync-prices', async (c) => {
  const db = c.env.DB;
  try {
    const { updated, staleAssets } = await syncMarketPrices(db);
    return c.json({
      success: true,
      updated,
      staleAssets,
      stale: staleAssets.length > 0,
      syncedAt: new Date().toISOString()
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ============================================================================
// RESET / ARCHIVE & FULL BACKUP / RESTORE ENDPOINTS (V2-09, V2-26)
// ============================================================================

app.post('/api/reset', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  let replayInput: { operationId: string; body: any } | undefined;

  try {
    const body = await c.req.json().catch(() => ({}));
    let targets: string[] = Array.isArray(body.targets) ? body.targets : [];
    if (targets.length === 0 && typeof body.scope === 'string') {
      const scope = body.scope;
      if (scope === 'transactions') targets = ['transactions'];
      else if (scope === 'balances') targets = ['balances'];
      else if (scope === 'holdings') targets = ['investments'];
      else if (scope === 'income') targets = ['income'];
      else if (scope === 'all') targets = ['transactions', 'balances', 'budgets', 'investments'];
    }
    const previewOnly = Boolean(body.preview);
    const mode = body.mode || 'revert_and_delete'; // 'hide_history' | 'revert_and_delete'
    const operationId = body.operationId || c.req.header('X-Operation-Id') || `op_reset_${Date.now()}`;
    if (!previewOnly) replayInput = { operationId, body };

    const receiptCheck = await getMutationReceipt(db, operationId, userId, 'POST /api/reset', body);
    if (receiptCheck.conflict) {
      return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
    }
    if (!previewOnly && receiptCheck.cachedResponse) {
      return c.json(receiptCheck.cachedResponse, (receiptCheck.statusCode || 200) as any);
    }

    // Read current state BEFORE building any mutation statements (fixes V2-09 bug where UPDATE ran before SELECT!)
    const { results: currentAccounts } = await db
      .prepare('SELECT id, name, balance, revision FROM accounts WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string; name: string; balance: number; revision: number }>();

    const { results: activeTxs } = await db
      .prepare('SELECT * FROM transactions WHERE user_id = ? AND deleted_at IS NULL')
      .bind(userId)
      .all<any>();

    const { results: holdingsList } = await db
      .prepare('SELECT * FROM holdings WHERE user_id = ?')
      .bind(userId)
      .all<any>();

    const totalAccountBalance = (currentAccounts || []).reduce((s, a) => s + Number(a.balance || 0), 0);
    const confirmedTxCount = (activeTxs || []).filter((t) => t.status === 'confirmed').length;
    const pendingTxCount = (activeTxs || []).filter((t) => t.status === 'pending').length;

    if (previewOnly) {
      return c.json({
        success: true,
        preview: true,
        targets,
        mode,
        summary: {
          accountsCount: (currentAccounts || []).length,
          totalAccountBalanceVnd: totalAccountBalance,
          transactionsCount: (activeTxs || []).length,
          confirmedTransactionsCount: confirmedTxCount,
          pendingTransactionsCount: pendingTxCount,
          holdingsCount: (holdingsList || []).length
        }
      });
    }

    const stmts: D1PreparedStatement[] = [];
    const balanceAdjustments: Array<{ accountId: string; oldBalance: number; deltaVnd: number }> = [];

    // 1. Transactions reset / hide_history
    if (targets.includes('transactions')) {
      if (mode === 'hide_history') {
        // Mark this exact set of existing rows. Later backdated imports remain visible and ledger state is untouched.
        stmts.push(
          db.prepare('UPDATE transactions SET history_hidden = 1, revision = COALESCE(revision, 1) + 1 WHERE user_id = ? AND deleted_at IS NULL AND COALESCE(history_hidden, 0) = 0').bind(userId),
          db.prepare('UPDATE users SET history_hidden_at = CURRENT_TIMESTAMP WHERE id = ?').bind(userId)
        );
      } else {
        // revert_and_delete: If balances are NOT simultaneously being zeroed out, revert confirmed transaction deltas
        if (!targets.includes('balances') && !targets.includes('accounts')) {
          for (const tx of activeTxs || []) {
            if (tx.status === 'confirmed') {
              const oldState: LedgerTxState = {
                status: tx.status,
                type: tx.type,
                amount: Number(tx.amount),
                accountId: tx.account_id,
                toAccountId: tx.to_account_id
              };
              for (const accId of new Set([tx.account_id, tx.to_account_id].filter(Boolean))) {
                const delta = calculateBalanceDelta(oldState, null, accId);
                if (delta !== 0) {
                  stmts.push(
                    ...buildLedgerDeltaStatements(db, userId, accId, delta, 'reset_revert_tx', operationId, tx.id)
                  );
                }
              }
            }
          }
        }
        stmts.push(
          db
            .prepare(
              `UPDATE transactions
               SET status = 'deleted', deleted_at = CURRENT_TIMESTAMP, revision = COALESCE(revision, 1) + 1
               WHERE user_id = ? AND deleted_at IS NULL`
            )
            .bind(userId)
        );
        stmts.push(
          db
            .prepare(`UPDATE raw_notifications SET parse_status = 'ignored' WHERE user_id = ?`)
            .bind(userId)
        );
      }
    }

    // 2. Zero out account balances with exact ledger adjustment postings from pre-update balance (V2-09 / AT2-05!)
    if (targets.includes('balances') && !targets.includes('accounts')) {
      for (const acc of currentAccounts || []) {
        const oldBal = Number(acc.balance || 0);
        const deltaVnd = -oldBal;
        balanceAdjustments.push({ accountId: acc.id, oldBalance: oldBal, deltaVnd });
        if (deltaVnd !== 0) {
          const postId = `post_rst_${acc.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          stmts.push(
            db
              .prepare(
                `INSERT INTO ledger_postings (id, user_id, account_id, transaction_id, operation_id, delta_vnd, reason)
                 VALUES (?, ?, ?, NULL, ?, ?, 'reset_adjustment')`
              )
              .bind(postId, userId, acc.id, operationId, deltaVnd)
          );
        }
        stmts.push(
          db
            .prepare('UPDATE accounts SET balance = 0, revision = COALESCE(revision, 1) + 1 WHERE id = ? AND user_id = ?')
            .bind(acc.id, userId)
        );
      }
    }

    // 3. Archive/Reset Accounts
    if (targets.includes('accounts')) {
      for (const acc of currentAccounts || []) {
        const oldBal = Number(acc.balance || 0);
        const deltaVnd = -oldBal;
        if (deltaVnd !== 0) {
          const postId = `post_rst_acc_${acc.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
          stmts.push(
            db
              .prepare(
                `INSERT INTO ledger_postings (id, user_id, account_id, transaction_id, operation_id, delta_vnd, reason)
                 VALUES (?, ?, ?, NULL, ?, ?, 'reset_adjustment')`
              )
              .bind(postId, userId, acc.id, operationId, deltaVnd)
          );
        }
        stmts.push(
          db
            .prepare(
              'UPDATE accounts SET balance = 0, is_active = 0, archived_at = CURRENT_TIMESTAMP, revision = COALESCE(revision, 1) + 1 WHERE id = ? AND user_id = ?'
            )
            .bind(acc.id, userId)
        );
      }
    }

    // 4. Jars & Rules
    if (targets.includes('jars')) {
      stmts.push(db.prepare('DELETE FROM rules WHERE user_id = ?').bind(userId));
      stmts.push(db.prepare('DELETE FROM jars WHERE user_id = ?').bind(userId));
    }

    // 5. Budgets (Income Sources & Planned Expenses)
    if (targets.includes('budgets')) {
      stmts.push(db.prepare('DELETE FROM planned_expenses WHERE user_id = ?').bind(userId));
      stmts.push(db.prepare('DELETE FROM income_sources WHERE user_id = ?').bind(userId));
    }

    // Income-only reset archives sources while retaining their transaction links and historical plan versions.
    if (targets.includes('income')) {
      const effectiveMonth = getCurrentVnMonth();
      stmts.push(
        db.prepare(`UPDATE plan_versions SET effective_to_month_exclusive = ?
          WHERE user_id = ? AND entity_type = 'income_source' AND effective_to_month_exclusive IS NULL
            AND effective_from_month < ?`).bind(effectiveMonth, userId, effectiveMonth),
        db.prepare(`DELETE FROM plan_versions
          WHERE user_id = ? AND entity_type = 'income_source' AND effective_from_month >= ?`).bind(userId, effectiveMonth),
        db.prepare(`UPDATE income_sources SET is_active = 0, revision = COALESCE(revision, 1) + 1
          WHERE user_id = ? AND COALESCE(is_active, 1) = 1`).bind(userId)
      );
    }

    // 6. Investments
    if (targets.includes('investments')) {
      stmts.push(db.prepare('DELETE FROM investment_transactions WHERE user_id = ?').bind(userId));
      stmts.push(db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(userId));
      stmts.push(db.prepare('DELETE FROM investment_cashflows WHERE user_id = ?').bind(userId));
      stmts.push(db.prepare('DELETE FROM investment_cashflow_settings WHERE user_id = ?').bind(userId));
    }

    const responsePayload = {
      success: true,
      resetTargets: targets,
      mode,
      operationId,
      balanceAdjustments
    };

    const receiptStmt = buildMutationReceiptStatement(
      db,
      operationId,
      userId,
      'POST /api/reset',
      receiptCheck.payloadHash,
      200,
      responsePayload
    );
    if (receiptStmt) stmts.unshift(receiptStmt);

    if (stmts.length > 0) {
      await db.batch(stmts);
    }

    return c.json(responsePayload);
  } catch (err: any) {
    if (replayInput) {
      const replay = await getMutationReceipt(db, replayInput.operationId, userId, 'POST /api/reset', replayInput.body);
      if (replay.conflict) return c.json({ error: 'Operation ID conflict with different payload', code: 'IDEMPOTENCY_CONFLICT' }, 409);
      if (replay.cachedResponse) return c.json(replay.cachedResponse, (replay.statusCode || 200) as any);
    }
    return c.json({ error: err.message }, 500);
  }
});

// V2-26: Full Backup Export & Restore with Schema Version & SHA-256 Checksum
app.get('/api/backup/export', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const includeRawNotifications = c.req.query('includeRawNotifications') === '1';

  try {
    const [
      accountsRes,
      jarsRes,
      incomeSourcesRes,
      plannedExpensesRes,
      planVersionsRes,
      transactionsRes,
      baselinesRes,
      postingsRes,
      assetsRes,
      holdingsRes,
      invTxsRes,
      cashflowsRes,
      cashflowSettingsRes,
      rulesRes,
      profileRes,
      rawNotificationsRes
    ] = await Promise.all([
      db.prepare('SELECT * FROM accounts WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM jars WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM income_sources WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM planned_expenses WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM plan_versions WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM transactions WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM ledger_baselines WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM ledger_postings WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM assets').all<any>(),
      db.prepare('SELECT * FROM holdings WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM investment_transactions WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT * FROM investment_cashflows WHERE user_id = ? ORDER BY occurred_at ASC, id ASC').bind(userId).all<any>(),
      db.prepare('SELECT * FROM investment_cashflow_settings WHERE user_id = ?').bind(userId).first<any>(),
      db.prepare('SELECT * FROM rules WHERE user_id = ?').bind(userId).all<any>(),
      db.prepare('SELECT id, email, name, phone, avatar, created_at FROM users WHERE id = ?').bind(userId).first<any>(),
      includeRawNotifications
        ? db.prepare('SELECT * FROM raw_notifications WHERE user_id = ?').bind(userId).all<any>()
        : Promise.resolve({ results: [] })
    ]);

    const data: any = {
      profile: profileRes ? {
        id: profileRes.id,
        email: profileRes.email,
        name: profileRes.name,
        phone: profileRes.phone || '',
        avatar: profileRes.avatar || '',
        created_at: profileRes.created_at
      } : null,
      accounts: accountsRes.results || [],
      jars: jarsRes.results || [],
      income_sources: incomeSourcesRes.results || [],
      planned_expenses: plannedExpensesRes.results || [],
      plan_versions: planVersionsRes.results || [],
      // Raw notification bodies are opt-in. Without them, remove dangling references only in this export copy.
      transactions: (transactionsRes.results || []).map((tx: any) => ({
        ...tx,
        raw_notification_id: includeRawNotifications ? tx.raw_notification_id : null
      })),
      ledger_baselines: baselinesRes.results || [],
      ledger_postings: postingsRes.results || [],
      assets: assetsRes.results || [],
      holdings: holdingsRes.results || [],
      investment_transactions: invTxsRes.results || [],
      investment_cashflows: cashflowsRes.results || [],
      investment_cashflow_settings: cashflowSettingsRes || null,
      rules: rulesRes.results || []
    };
    if (includeRawNotifications) data.raw_notifications = rawNotificationsRes.results || [];

    const counts: Record<string, number> = {};
    for (const [key, value] of Object.entries(data)) if (Array.isArray(value)) counts[key] = value.length;
    const checksum = await hashPayload(data);

    return c.json({
      app: 'QLTC_CA_NHAN',
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      userId,
      counts,
      options: { rawNotificationsIncluded: includeRawNotifications },
      checksum,
      data
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

app.post('/api/backup/restore', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;

  try {
    const body = await c.req.json();
    const dryRun = Boolean(body.dryRun);
    const schemaVersion = Number(body.schemaVersion);
    const data = body.data;

    if (!data || typeof data !== 'object' || schemaVersion !== 2) {
      return c.json({ error: 'File sao lưu không hợp lệ hoặc sai phiên bản schemaVersion (yêu cầu v2)', code: 'INVALID_BACKUP_SCHEMA' }, 400);
    }
    if (typeof body.checksum !== 'string' || !/^[a-f0-9]{64}$/i.test(body.checksum)) {
      return c.json({ error: 'File sao lưu thiếu checksum SHA-256 hợp lệ', code: 'CHECKSUM_REQUIRED' }, 400);
    }

    const computedChecksum = await hashPayload(data);
    if (body.checksum.toLowerCase() !== computedChecksum) {
      return c.json({ error: 'Checksum file sao lưu không khớp (dữ liệu đã bị hỏng hoặc chỉnh sửa)', code: 'CHECKSUM_MISMATCH' }, 400);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'raw_notifications') && !Array.isArray(data.raw_notifications)) {
      return c.json({ error: 'Danh sách raw_notifications trong file sao lưu không hợp lệ', code: 'INVALID_BACKUP_SCHEMA' }, 400);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'investment_cashflows') && !Array.isArray(data.investment_cashflows)) {
      return c.json({ error: 'Danh sách investment_cashflows trong file sao lưu không hợp lệ', code: 'INVALID_BACKUP_SCHEMA' }, 400);
    }
    if (Object.prototype.hasOwnProperty.call(data, 'investment_cashflow_settings') && data.investment_cashflow_settings !== null &&
        (!data.investment_cashflow_settings || typeof data.investment_cashflow_settings !== 'object')) {
      return c.json({ error: 'investment_cashflow_settings trong file sao lưu không hợp lệ', code: 'INVALID_BACKUP_SCHEMA' }, 400);
    }

    const profile = data.profile && typeof data.profile === 'object' ? data.profile : null;
    if (typeof profile?.email === 'string' && profile.email.trim()) {
      const conflictingUser = await db
        .prepare('SELECT id FROM users WHERE email = ? AND id <> ? LIMIT 1')
        .bind(profile.email.trim(), userId)
        .first<any>();
      if (conflictingUser) {
        return c.json({ error: 'Email trong bản sao lưu đã thuộc tài khoản khác', code: 'PROFILE_EMAIL_CONFLICT' }, 400);
      }
    }

    const hasRawNotifications = Array.isArray(data.raw_notifications);
    if (!hasRawNotifications) {
      // Legacy v2 backups did not contain notification rows. Preserve compatibility without restoring orphan refs.
      for (const tx of Array.isArray(data.transactions) ? data.transactions : []) tx.raw_notification_id = null;
    }

    // Validate all portable references before either dry-run success or restore mutations.
    const ids = (key: string) => new Set((Array.isArray(data[key]) ? data[key] : []).map((item: any) => item?.id).filter(Boolean));
    const accountIds = ids('accounts');
    const jarIds = ids('jars');
    const incomeSourceIds = ids('income_sources');
    const plannedExpenseIds = ids('planned_expenses');
    const transactionIds = ids('transactions');
    const assetIds = ids('assets');
    const rawNotificationIds = ids('raw_notifications');
    const cashflows = Array.isArray(data.investment_cashflows) ? data.investment_cashflows : [];
    for (const flow of cashflows) {
      const occurredAt = parseExternalCashflowDate(flow?.occurred_at ?? flow?.occurredAt);
      if (!flow || (flow.type !== 'contribution' && flow.type !== 'withdrawal') ||
          !Number.isSafeInteger(Number(flow.amount_vnd ?? flow.amountVnd)) || Number(flow.amount_vnd ?? flow.amountVnd) <= 0 || !occurredAt) {
        return c.json({ error: 'Dòng tiền đầu tư ngoài trong file sao lưu không hợp lệ', code: 'INVALID_BACKUP_SCHEMA' }, 400);
      }
    }
    const cashflowSettings = data.investment_cashflow_settings || null;
    if (cashflowSettings) {
      const completeFrom = parseExternalCashflowDate(cashflowSettings.complete_from ?? cashflowSettings.completeFrom);
      if (!completeFrom || completeFrom.slice(0, 10) > new Date().toISOString().slice(0, 10) || cashflows.some((flow: any) =>
        String(flow.occurred_at ?? flow.occurredAt).slice(0, 10) < completeFrom.slice(0, 10))) {
        return c.json({ error: 'Mốc lịch sử dòng tiền trong file sao lưu không hợp lệ', code: 'INVALID_BACKUP_SCHEMA' }, 400);
      }
    }
    let brokenReference: string | null = null;
    const validateReference = (
      rowType: string,
      rowId: unknown,
      field: string,
      value: unknown,
      allowedIds: Set<any>,
      optional = false
    ) => {
      if (value === null || value === undefined) {
        if (optional) return;
      }
      if (value === null || value === undefined || !allowedIds.has(value)) {
        brokenReference = `${rowType} ${String(rowId ?? '(unknown)')} references missing ${field} (${String(value ?? 'null')})`;
      }
    };
    const checkRows = (key: string, rowType: string, checks: Array<[string, Set<any>, boolean?]>) => {
      for (const row of (Array.isArray(data[key]) ? data[key] : [])) {
        for (const [field, allowedIds, optional] of checks) {
          validateReference(rowType, row?.id, field, row?.[field], allowedIds, optional);
          if (brokenReference) return;
        }
      }
    };

    checkRows('transactions', 'Transaction', [
      ['account_id', accountIds],
      ['to_account_id', accountIds, true],
      ['jar_id', jarIds, true],
      ['income_source_id', incomeSourceIds, true],
      ['planned_expense_id', plannedExpenseIds, true],
      ['raw_notification_id', rawNotificationIds, true],
      ['original_account_id', accountIds, true],
      ['original_jar_id', jarIds, true],
      ['original_income_source_id', incomeSourceIds, true]
    ]);
    if (!brokenReference) checkRows('income_sources', 'Income source', [['account_id', accountIds, true]]);
    if (!brokenReference) checkRows('planned_expenses', 'Planned expense', [['account_id', accountIds, true], ['jar_id', jarIds, true]]);
    if (!brokenReference) checkRows('ledger_baselines', 'Ledger baseline', [['account_id', accountIds]]);
    if (!brokenReference) checkRows('ledger_postings', 'Ledger posting', [['account_id', accountIds], ['transaction_id', transactionIds, true]]);
    if (!brokenReference) checkRows('holdings', 'Holding', [['asset_id', assetIds], ['account_id', accountIds, true]]);
    if (!brokenReference) checkRows('investment_transactions', 'Investment transaction', [['asset_id', assetIds], ['account_id', accountIds, true], ['linked_transaction_id', transactionIds, true]]);

    if (!brokenReference) {
      for (const pv of (Array.isArray(data.plan_versions) ? data.plan_versions : [])) {
        const entityIds = pv?.entity_type === 'income_source' ? incomeSourceIds
          : pv?.entity_type === 'planned_expense' ? plannedExpenseIds
            : pv?.entity_type === 'jar' ? jarIds : null;
        if (!entityIds || !entityIds.has(pv?.entity_id)) {
          brokenReference = `Plan version ${String(pv?.id ?? '(unknown)')} references missing entity ${String(pv?.entity_type)}:${String(pv?.entity_id)}`;
          break;
        }
      }
    }

    if (brokenReference) {
      return c.json({ error: brokenReference, code: 'BROKEN_FOREIGN_KEY' }, 400);
    }

    if (dryRun) {
      return c.json({
        success: true,
        dryRun: true,
        valid: true,
        checksum: computedChecksum
      });
    }

    const stmts: D1PreparedStatement[] = [
      db.prepare('DELETE FROM investment_cashflows WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM investment_cashflow_settings WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM investment_transactions WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM ledger_postings WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM ledger_baselines WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM plan_versions WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM planned_expenses WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM income_sources WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM rules WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM jars WHERE user_id = ?').bind(userId),
      db.prepare('DELETE FROM accounts WHERE user_id = ?').bind(userId)
    ];
    if (hasRawNotifications) stmts.push(db.prepare('DELETE FROM raw_notifications WHERE user_id = ?').bind(userId));
    if (profile) {
      const currentUser = await db.prepare('SELECT email, name, phone, avatar FROM users WHERE id = ?').bind(userId).first<any>();
      if (currentUser) {
        stmts.push(db.prepare('UPDATE users SET email = ?, name = ?, phone = ?, avatar = ? WHERE id = ?').bind(
          typeof profile.email === 'string' && profile.email.trim() ? profile.email.trim() : currentUser.email,
          Object.prototype.hasOwnProperty.call(profile, 'name') ? profile.name : currentUser.name,
          Object.prototype.hasOwnProperty.call(profile, 'phone') ? profile.phone : currentUser.phone,
          Object.prototype.hasOwnProperty.call(profile, 'avatar') ? profile.avatar : currentUser.avatar,
          userId
        ));
      }
    }

    for (const a of data.accounts || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO accounts (
              id, user_id, name, type, currency, balance, account_number_mask, account_number,
              bank_code, bank_name, account_holder, branch, aliases_json, include_in_net_worth, is_active, archived_at, revision, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            a.id,
            userId,
            a.name,
            a.type || 'bank',
            a.currency || 'VND',
            Number(a.balance || 0),
            a.account_number_mask || null,
            a.account_number || null,
            a.bank_code || null,
            a.bank_name || null,
            a.account_holder || null,
            a.branch || null,
            a.aliases_json || null,
            a.include_in_net_worth ?? 1,
            a.is_active ?? 1,
            a.archived_at || null,
            Number(a.revision || 1),
            a.created_at || new Date().toISOString()
          )
      );
    }

    for (const j of data.jars || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO jars (id, user_id, name, icon, color, target_percent, monthly_limit, rollover_enabled, is_active, revision, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            j.id,
            userId,
            j.name,
            j.icon || 'home',
            j.color || '#3B82F6',
            Number(j.target_percent || 0),
            Number(j.monthly_limit || 0),
            j.rollover_enabled ? 1 : 0,
            j.is_active ?? 1,
            Number(j.revision || 1),
            Number(j.sort_order || 0)
          )
      );
    }

    for (const s of data.income_sources || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO income_sources (id, user_id, name, expected_amount, cadence, one_time_date, expected_day, account_id, icon, color, is_active, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            s.id,
            userId,
            s.name,
            Number(s.expected_amount || 0),
            s.cadence || 'monthly',
            s.one_time_date || null,
            s.expected_day || 1,
            s.account_id || null,
            s.icon || 'payments',
            s.color || '#10B981',
            s.is_active ?? 1,
            Number(s.revision || 1)
          )
      );
    }

    for (const p of data.planned_expenses || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO planned_expenses (id, user_id, name, expected_amount, cadence, one_time_date, due_day, jar_id, account_id, is_active, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            p.id,
            userId,
            p.name,
            Number(p.expected_amount || 0),
            p.cadence || 'monthly',
            p.one_time_date || null,
            p.due_day || 1,
            p.jar_id || null,
            p.account_id || null,
            p.is_active ?? 1,
            Number(p.revision || 1)
          )
      );
    }

    for (const pv of data.plan_versions || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO plan_versions (id, user_id, entity_type, entity_id, effective_from_month, effective_to_month_exclusive, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            pv.id,
            userId,
            pv.entity_type,
            pv.entity_id,
            pv.effective_from_month,
            pv.effective_to_month_exclusive || null,
            pv.payload_json
          )
      );
    }

    for (const rn of data.raw_notifications || []) {
      stmts.push(
        db.prepare(
          `INSERT INTO raw_notifications (
            id, user_id, device_id, event_id, app_package, title, text, received_at,
            original_time_value, time_source, parse_status, parse_error, raw_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          rn.id,
          userId,
          rn.device_id || null,
          rn.event_id || null,
          rn.app_package,
          rn.title || null,
          rn.text,
          rn.received_at || new Date().toISOString(),
          rn.original_time_value || null,
          rn.time_source || 'notification',
          rn.parse_status || 'pending',
          rn.parse_error || null,
          rn.raw_json || null
        )
      );
    }

    for (const tx of data.transactions || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO transactions (
              id, user_id, occurred_at, time_source, type, amount, currency, account_id, to_account_id,
              jar_id, income_source_id, planned_expense_id, status, needs_account_review, source,
              description, counterparty, raw_notification_id, dedupe_hash, transfer_pair_id,
              suggested_pair_id, is_synthetic, original_type, original_account_id, original_jar_id,
              original_income_source_id, original_description, original_status, history_hidden, revision, deleted_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            tx.id,
            userId,
            tx.occurred_at,
            tx.time_source || 'user_input',
            tx.type,
            Number(tx.amount || 0),
            tx.currency || 'VND',
            tx.account_id,
            tx.to_account_id || null,
            tx.jar_id || null,
            tx.income_source_id || null,
            tx.planned_expense_id || null,
            tx.status || 'pending',
            tx.needs_account_review ? 1 : 0,
            tx.source || 'manual',
            tx.description || null,
            tx.counterparty || null,
            tx.raw_notification_id || null,
            tx.dedupe_hash || null,
            tx.transfer_pair_id || null,
            tx.suggested_pair_id || null,
            tx.is_synthetic ? 1 : 0,
            tx.original_type || null,
            tx.original_account_id || null,
            tx.original_jar_id || null,
            tx.original_income_source_id || null,
            tx.original_description || null,
            tx.original_status || null,
            tx.history_hidden ? 1 : 0,
            Number(tx.revision || 1),
            tx.deleted_at || null,
            tx.created_at || new Date().toISOString()
          )
      );
    }

    for (const b of data.ledger_baselines || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO ledger_baselines (account_id, user_id, baseline_amount_vnd, baseline_at, note)
             VALUES (?, ?, ?, ?, ?)`
          )
          .bind(b.account_id, userId, Number(b.baseline_amount_vnd || 0), b.baseline_at || new Date().toISOString(), b.note || null)
      );
    }

    for (const lp of data.ledger_postings || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO ledger_postings (id, user_id, account_id, transaction_id, operation_id, delta_vnd, reason, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            lp.id,
            userId,
            lp.account_id,
            lp.transaction_id || null,
            lp.operation_id || `op_restored_${lp.id}`,
            Number(lp.delta_vnd || 0),
            lp.reason || 'restored',
            lp.created_at || new Date().toISOString()
          )
      );
    }

    for (const ast of data.assets || []) {
      stmts.push(
        db
          .prepare(
            `INSERT OR REPLACE INTO assets (id, symbol, name, asset_class, unit, quote_unit, provider, currency, current_price, price_as_of, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            ast.id,
            ast.symbol,
            ast.name,
            ast.asset_class,
            ast.unit,
            ast.quote_unit || ast.unit,
            ast.provider || null,
            ast.currency || 'VND',
            Number(ast.current_price || 0),
            ast.price_as_of || null,
            ast.sync_status || 'ok'
          )
      );
    }

    for (const h of data.holdings || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO holdings (id, user_id, asset_id, account_id, quantity, holding_unit, avg_cost, note, revision)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            h.id,
            userId,
            h.asset_id,
            h.account_id || null,
            Number(h.quantity || 0),
            h.holding_unit || null,
            Number(h.avg_cost || 0),
            h.note || null,
            Number(h.revision || 1)
          )
      );
    }

    for (const it of data.investment_transactions || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO investment_transactions (
              id, user_id, asset_id, account_id, type, occurred_at, quantity, unit_price, fee, tax, total_amount_vnd, linked_transaction_id, operation_id, note
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            it.id,
            userId,
            it.asset_id,
            it.account_id || null,
            it.type,
            it.occurred_at,
            Number(it.quantity || 0),
            Number(it.unit_price || 0),
            Number(it.fee || 0),
            Number(it.tax || 0),
            Number(it.total_amount_vnd || 0),
            it.linked_transaction_id || null,
            it.operation_id || null,
            it.note || null
          )
      );
    }

    for (const flow of cashflows) {
      const amountVnd = Number(flow.amount_vnd ?? flow.amountVnd);
      const occurredAt = parseExternalCashflowDate(flow.occurred_at ?? flow.occurredAt)!;
      stmts.push(db.prepare(`INSERT INTO investment_cashflows (id, user_id, type, amount_vnd, occurred_at, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(flow.id || `cashflow_${crypto.randomUUID()}`, userId, flow.type, amountVnd, occurredAt, flow.note || null,
          flow.created_at || flow.createdAt || new Date().toISOString()));
    }
    if (cashflowSettings) {
      const completeFrom = parseExternalCashflowDate(cashflowSettings.complete_from ?? cashflowSettings.completeFrom)!.slice(0, 10);
      stmts.push(db.prepare(`INSERT INTO investment_cashflow_settings (user_id, complete_from, updated_at) VALUES (?, ?, ?)`)
        .bind(userId, completeFrom, cashflowSettings.updated_at || cashflowSettings.updatedAt || new Date().toISOString()));
    }

    for (const r of data.rules || []) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO rules (id, user_id, priority, match_field, match_type, pattern, action_type, target_id, confidence, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            r.id,
            userId,
            Number(r.priority || 1),
            r.match_field,
            r.match_type,
            r.pattern,
            r.action_type,
            r.target_id || null,
            Number(r.confidence || 1),
            r.is_active ?? 1
          )
      );
    }

    await db.batch(stmts);
    return c.json({
      success: true,
      restored: true,
      checksum: computedChecksum
    });
  } catch (err: any) {
    return c.json({ error: err.message, code: 'RESTORE_FAILED' }, 500);
  }
});

export default {
  fetch: app.fetch,
  async scheduled(_event: any, env: Bindings, ctx: any) {
    ctx.waitUntil(syncMarketPrices(env.DB));
  }
};

// ============================================================================
// ADDITIONAL COMPATIBILITY ENDPOINTS FOR FRONTEND (JARS, PLANNED EXPENSES, PROFILE, NOTIFICATIONS, FMARKET)
// ============================================================================

app.get('/api/jars', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const { results } = await db
    .prepare('SELECT * FROM jars WHERE user_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY sort_order ASC')
    .bind(userId)
    .all<any>();
  return c.json({ jars: results || [] });
});

app.get('/api/planned-expenses', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const { results } = await db
    .prepare(
      `SELECT p.*, j.name as jar_name, j.color as jar_color
       FROM planned_expenses p
       LEFT JOIN jars j ON p.jar_id = j.id
       WHERE p.user_id = ? AND COALESCE(p.is_active, 1) = 1
       ORDER BY p.due_day ASC, p.created_at ASC`
    )
    .bind(userId)
    .all<any>();
  return c.json({ plannedExpenses: results || [] });
});

app.get('/api/notifications/recent', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const limit = Math.min(Number(c.req.query('limit') || 30), 200);
  const { results } = await db
    .prepare(
      `SELECT id, device_id, event_id, app_package, title, text, received_at, original_time_value, time_source, parse_status, parse_error
       FROM raw_notifications
       WHERE user_id = ?
       ORDER BY received_at DESC
       LIMIT ?`
    )
    .bind(userId, limit)
    .all<any>();
  return c.json({ notifications: results || [] });
});

app.get('/api/user/profile', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const user = await db.prepare('SELECT id, email, name, phone, avatar, created_at FROM users WHERE id = ?').bind(userId).first<any>();
  return c.json({ user: user || { id: userId, email: 'admin@qltc.local', name: 'Chủ tài khoản' } });
});

app.put('/api/user/profile', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  const userId = principal.userId;
  const body = await c.req.json().catch(() => ({}));
  await db
    .prepare('UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email), phone = COALESCE(?, phone), avatar = COALESCE(?, avatar) WHERE id = ?')
    .bind(body.name || null, body.email || null, body.phone ?? null, body.avatar ?? null, userId)
    .run();
  return c.json({ success: true });
});

app.get('/api/market/fmarket-funds', async (c) => {
  try {
    // FireAnt's documented Fmarket product list supplies product identity, NAV and NAV date.
    const upstream = await fetch('https://api.fireant.vn/fmarket/markets/filter-products', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: 0, page_size: 200 })
    });
    if (!upstream.ok) throw new Error(`Fmarket upstream HTTP ${upstream.status}`);
    const payload: any = await upstream.json();
    if (!Array.isArray(payload?.items)) throw new Error('Fmarket upstream response invalid');
    const now = Date.now();
    const funds = payload.items.flatMap((item: any) => {
      const shortName = String(item.short_name || '').trim();
      const nav = Number(item.nav);
      const navDate = String(item.nav_date || '').trim();
      const updatedAt = Date.parse(navDate);
      if (!shortName || !Number.isFinite(nav) || nav <= 0 || !Number.isFinite(updatedAt)) return [];
      return [{
        shortName,
        name: String(item.name || shortName),
        nav,
        navDate,
        updatedAt,
        issuer: item.issuer_info?.name || null,
        stale: now - updatedAt > 7 * 24 * 60 * 60 * 1000
      }];
    });
    return c.json({ funds, source: 'FireAnt Fmarket', stale: funds.length === 0 || funds.every((fund: any) => fund.stale), fetchedAt: new Date(now).toISOString() });
  } catch {
    return c.json({ funds: [], source: 'FireAnt Fmarket', stale: true, error: 'NAV hiện không khả dụng' }, 503);
  }
});

app.post('/api/seed', async (c) => {
  const db = c.env.DB;
  const principal = c.get('principal');
  if (!isAuthorizedRole(principal, ['owner'])) {
    return c.json({ error: 'Chỉ chủ tài khoản được tạo dữ liệu mẫu', code: 'FORBIDDEN' }, 403);
  }

  const [accounts, jars, rules] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE user_id = ?').bind(principal.userId).first<any>(),
    db.prepare('SELECT COUNT(*) AS count FROM jars WHERE user_id = ?').bind(principal.userId).first<any>(),
    db.prepare('SELECT COUNT(*) AS count FROM rules WHERE user_id = ?').bind(principal.userId).first<any>()
  ]);
  if (Number(accounts?.count || 0) || Number(jars?.count || 0) || Number(rules?.count || 0)) {
    return c.json({ error: 'Tài khoản đã có dữ liệu; không ghi đè bằng dữ liệu mẫu', code: 'SEED_REQUIRES_EMPTY_PROFILE' }, 409);
  }

  const prefix = principal.userId === 'user_default' ? '' : `${principal.userId}_`;
  const idMap = new Map<string, string>();
  for (const item of [...BUNDLED_DEFAULTS.accounts, ...BUNDLED_DEFAULTS.jars, ...BUNDLED_DEFAULTS.rules]) {
    idMap.set(item.id, `${prefix}${item.id}`);
  }
  const stmts: D1PreparedStatement[] = [];
  for (const jar of BUNDLED_DEFAULTS.jars) {
    stmts.push(db.prepare(`INSERT INTO jars (id, user_id, name, icon, color, target_percent, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(idMap.get(jar.id), principal.userId, jar.name, jar.icon, jar.color, jar.target_percent, jar.sort_order));
  }
  for (const account of BUNDLED_DEFAULTS.accounts) {
    stmts.push(db.prepare(`INSERT INTO accounts (id, user_id, name, type, balance, account_number_mask, include_in_net_worth, is_active)
      VALUES (?, ?, ?, ?, ?, ?, 1, 1)`).bind(idMap.get(account.id), principal.userId, account.name, account.type, account.balance, account.mask));
    stmts.push(db.prepare(`INSERT INTO ledger_baselines (account_id, user_id, baseline_amount_vnd, note)
      VALUES (?, ?, ?, 'Initial explicit sample seed')`).bind(idMap.get(account.id), principal.userId, account.balance));
  }
  for (const rule of BUNDLED_DEFAULTS.rules) {
    const targetId = rule.target.startsWith('jar_') ? idMap.get(rule.target) : rule.target;
    stmts.push(db.prepare(`INSERT INTO rules (id, user_id, match_field, match_type, pattern, action_type, target_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(idMap.get(rule.id), principal.userId, rule.field, rule.type, rule.pattern, rule.action, targetId));
  }
  await db.batch(stmts);
  return c.json({ success: true, seeded: true, warning: 'Đã tạo dữ liệu mẫu; số dư không phải dữ liệu ngân hàng thật.' });
});
