import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseBankNotification } from './services/parser';
import { categorizeTransaction } from './services/rules';
import { generateDedupeHash } from './services/dedupe';
import {
  TxnState,
  getTxnContribution,
  calculateBalanceDelta,
  hashPayload,
  allocateVndLargestRemainder,
  calculateBudgetExpected
} from './services/ledger';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

// Helper idempotency receipt (V2-02, AT2-04, AT2-05)
async function processMutationReceipt(
  db: D1Database,
  userId: string,
  operationId: string | undefined,
  payload: any
): Promise<{ operationId: string; cachedAck?: any; conflict?: boolean; payloadHash: string }> {
  const opId = operationId || `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const pHash = await hashPayload(payload);

  if (operationId) {
    const existing = await db.prepare('SELECT payload_hash, ack_json FROM mutation_receipts WHERE user_id = ? AND operation_id = ?')
      .bind(userId, operationId).first<{ payload_hash: string; ack_json: string }>();
    if (existing) {
      if (existing.payload_hash === pHash) {
        try {
          return { operationId: opId, cachedAck: JSON.parse(existing.ack_json), payloadHash: pHash };
        } catch {
          return { operationId: opId, cachedAck: { success: true }, payloadHash: pHash };
        }
      } else {
        return { operationId: opId, conflict: true, payloadHash: pHash };
      }
    }
  }

  return { operationId: opId, payloadHash: pHash };
}

async function saveMutationReceipt(
  db: D1Database,
  userId: string,
  operationId: string,
  payloadHash: string,
  ack: any
) {
  try {
    await db.prepare(`
      INSERT INTO mutation_receipts (user_id, operation_id, payload_hash, ack_json)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, operation_id) DO UPDATE SET ack_json = excluded.ack_json
    `).bind(userId, operationId, payloadHash, JSON.stringify(ack)).run();
  } catch (e) {
    console.warn('Failed to save receipt:', e);
  }
}

// Helper hạch toán delta sổ cái bất biến (V2-02)
async function applyLedgerDelta(
  db: D1Database,
  userId: string,
  operationId: string,
  accountId: string,
  transactionId: string | undefined,
  deltaVnd: number
) {
  if (deltaVnd === 0) return;
  await db.prepare(`
    UPDATE accounts 
    SET balance = balance + ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ? AND user_id = ?
  `).bind(deltaVnd, accountId, userId).run();

  const postingId = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  await db.prepare(`
    INSERT INTO ledger_postings (id, user_id, operation_id, account_id, transaction_id, delta_vnd)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(postingId, userId, operationId, accountId, transactionId || null, deltaVnd).run();
}

// Enable CORS for web and mobile clients
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}));

// Hàm sinh mã code hũ duy nhất từ tên tiếng Việt (ví dụ "Chi tiêu công trình" -> "CTCT", "Chi tiêu gia đình" -> "CTGD")
export function generateUniqueCodeFromName(name: string, existingCodes: string[]): string {
  const clean = (name || 'JAR').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toUpperCase()
    .trim();

  const words = clean.split(/\s+/).filter(w => w.length > 0);
  let base = words.map(w => w[0]).join('').slice(0, 5);
  if (!base || base.length < 2) {
    base = clean.replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'JAR';
  }

  let finalCode = base;
  let counter = 2;
  const existingSet = new Set(existingCodes.map(c => (c || '').toUpperCase()));
  while (existingSet.has(finalCode)) {
    finalCode = `${base}${counter}`;
    counter++;
  }
  return finalCode;
}

let schemaInitialized = false;
async function ensureDatabaseSchema(db: D1Database) {
  if (schemaInitialized) return;
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS income_sources (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'fixed',
        recurrence TEXT DEFAULT 'Hàng tháng',
        expected_amount INTEGER DEFAULT 0,
        color TEXT DEFAULT '#8CC7AE',
        keywords TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS planned_expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        jar_code TEXT NOT NULL DEFAULT 'NEC',
        expected_amount INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT DEFAULT 'Hàng tháng',
        note TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS rules (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        pattern TEXT NOT NULL,
        category_name TEXT NOT NULL,
        jar_code TEXT NOT NULL,
        jar_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Bảng V2: Mutation receipts (chống lặp và bảo đảm tính nguyên tử - V2-02)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS mutation_receipts (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, operation_id)
      )
    `).run();

    // Bảng V2: Sổ cái hạch toán delta bất biến (V2-02)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS ledger_postings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        transaction_id TEXT,
        delta_vnd INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Bảng V2: Mốc số dư cơ sở cutover tài khoản (V2-02)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS ledger_baselines (
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        baseline_balance INTEGER NOT NULL DEFAULT 0,
        cutover_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, account_id)
      )
    `).run();

    // Bảng V2: Phiên bản kế hoạch tài chính (V2-16)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS plan_versions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        amount_vnd INTEGER NOT NULL,
        cadence TEXT NOT NULL,
        effective_from_month TEXT NOT NULL,
        effective_to_month_exclusive TEXT,
        one_time_date TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run();

    // Bảng V2: Quản lý thiết bị Android và xác thực (V2-01)
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        revoked_at DATETIME
      )
    `).run();

    const cols = [
      { t: 'users', c: 'phone', type: 'TEXT' },
      { t: 'users', c: 'avatar', type: 'TEXT' },
      { t: 'transactions', c: 'to_account_id', type: 'TEXT' },
      { t: 'transactions', c: 'balance_after', type: 'INTEGER' },
      { t: 'transactions', c: 'original_type', type: 'TEXT' },
      { t: 'transactions', c: 'income_source_id', type: 'TEXT' },
      { t: 'transactions', c: 'revision', type: 'INTEGER DEFAULT 1' },
      { t: 'transactions', c: 'deleted_at', type: 'DATETIME' },
      { t: 'transactions', c: 'history_hidden_at', type: 'DATETIME' },
      { t: 'transactions', c: 'is_synthetic', type: 'INTEGER DEFAULT 0' },
      { t: 'transactions', c: 'time_source', type: 'TEXT' },
      { t: 'jars', c: 'is_default', type: 'INTEGER DEFAULT 0' },
      { t: 'jars', c: 'is_active', type: 'INTEGER DEFAULT 1' },
      { t: 'holdings', c: 'auto_sync', type: 'INTEGER DEFAULT 1' },
      { t: 'assets', c: 'auto_sync', type: 'INTEGER DEFAULT 1' },
      { t: 'income_sources', c: 'color', type: "TEXT DEFAULT '#657D81'" },
      { t: 'income_sources', c: 'recurrence', type: "TEXT DEFAULT 'Hàng tháng'" },
      { t: 'income_sources', c: 'keywords', type: 'TEXT' },
      { t: 'planned_expenses', c: 'recurrence', type: "TEXT DEFAULT 'Hàng tháng'" },
      { t: 'planned_expenses', c: 'note', type: 'TEXT' },
      { t: 'plan_versions', c: 'revision', type: 'INTEGER DEFAULT 1' },
      { t: 'rules', c: 'category_name', type: "TEXT DEFAULT 'Chi tiêu'" },
      { t: 'rules', c: 'jar_code', type: "TEXT DEFAULT 'NEC'" },
      { t: 'rules', c: 'jar_id', type: 'TEXT' },
      { t: 'rules', c: 'created_at', type: 'DATETIME' },
      { t: 'accounts', c: 'account_number', type: 'TEXT' },
      { t: 'accounts', c: 'account_holder', type: 'TEXT' },
      { t: 'accounts', c: 'branch', type: 'TEXT' },
      { t: 'accounts', c: 'bank_bin', type: 'TEXT' },
      { t: 'accounts', c: 'revision', type: 'INTEGER DEFAULT 1' },
      { t: 'accounts', c: 'archived_at', type: 'DATETIME' },
      { t: 'accounts', c: 'reconciliation_status', type: 'TEXT' },
      { t: 'raw_notifications', c: 'device_id', type: 'TEXT' },
      { t: 'raw_notifications', c: 'event_id', type: 'TEXT' },
      { t: 'raw_notifications', c: 'original_time_value', type: 'TEXT' },
      { t: 'raw_notifications', c: 'parser_version', type: 'TEXT' },
      { t: 'raw_notifications', c: 'parse_status', type: 'TEXT' },
      { t: 'raw_notifications', c: 'reason_code', type: 'TEXT' }
    ];

    for (const col of cols) {
      try {
        await db.prepare(`ALTER TABLE ${col.t} ADD COLUMN ${col.c} ${col.type}`).run();
      } catch {
        // Cột đã tồn tại
      }
    }

    // Tự động khử trùng các hũ đang bị trùng mã code (ví dụ nhiều hũ code = 'CHI')
    const { results: dupJars } = await db.prepare(
      "SELECT id, name, code, sort_order FROM jars WHERE user_id = 'user_default' ORDER BY sort_order ASC, id ASC"
    ).all<{ id: string; name: string; code: string; sort_order: number }>();

    if (dupJars && dupJars.length > 0) {
      const seen = new Set<string>();
      for (const j of dupJars) {
        if (seen.has(j.code)) {
          const newCode = generateUniqueCodeFromName(j.name, Array.from(seen));
          await db.prepare('UPDATE jars SET code = ? WHERE id = ?').bind(newCode, j.id).run();
          seen.add(newCode);
        } else {
          seen.add(j.code);
        }
      }
    }

    schemaInitialized = true;
  } catch (err) {
    console.error('Lỗi khởi tạo schema DB:', err);
  }
}

app.use('*', async (c, next) => {
  if (c.env?.DB) {
    await ensureDatabaseSchema(c.env.DB);
  }
  await next();
});

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', service: 'QLTC Backend', version: '1.2.9', time: new Date().toISOString() });
});

// Seed data cơ bản nếu DB mới
app.post('/api/seed', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';

  // 1. Tạo user
  await db.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)')
    .bind(userId, 'duc@qltc.local', 'Anh Đức')
    .run();

  // 2. Tạo 6 hũ mặc định
  const defaultJars = [
    { code: 'NEC', name: 'Thiết yếu', pct: 0.55, limit: 25000000, color: '#657D81', order: 1 },
    { code: 'FFA', name: 'Tự do tài chính', pct: 0.10, limit: 4500000, color: '#8CC7AE', order: 2 },
    { code: 'LTSS', name: 'Tiết kiệm dài hạn', pct: 0.10, limit: 4500000, color: '#95B0B4', order: 3 },
    { code: 'EDU', name: 'Giáo dục', pct: 0.10, limit: 4500000, color: '#7A9599', order: 4 },
    { code: 'PLAY', name: 'Hưởng thụ', pct: 0.10, limit: 4500000, color: '#D4A373', order: 5 },
    { code: 'GIVE', name: 'Cho đi', pct: 0.05, limit: 2300000, color: '#B0C0C3', order: 6 },
  ];

  for (const j of defaultJars) {
    await db.prepare(`
      INSERT OR IGNORE INTO jars (id, user_id, code, name, target_percent, monthly_limit, color, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(`jar_${j.code.toLowerCase()}`, userId, j.code, j.name, j.pct, j.limit, j.color, j.order).run();
  }

  // 3. Tạo các tài khoản mẫu
  const sampleAccounts = [
    { id: 'acc_vcb', name: 'Vietcombank', type: 'bank', bank_code: 'VCB', mask: '0071', balance: 14520000 },
    { id: 'acc_tcb', name: 'Techcombank', type: 'bank', bank_code: 'TCB', mask: '1902', balance: 5200000 },
    { id: 'acc_mb', name: 'MB Bank', type: 'bank', bank_code: 'MB', mask: '0340', balance: 35000000 },
    { id: 'acc_cash', name: 'Tiền mặt ví', type: 'cash', bank_code: null, mask: null, balance: 1800000 },
    { id: 'acc_tcbs', name: 'TCBS Chứng khoán', type: 'securities', bank_code: 'TCBS', mask: '8812', balance: 185000000 },
  ];

  for (const a of sampleAccounts) {
    await db.prepare(`
      INSERT OR IGNORE INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(a.id, userId, a.name, a.type, a.bank_code, a.mask, a.balance).run();
  }

  // 4. Tạo tài sản đầu tư mẫu
  const sampleAssets = [
    { symbol: 'HPG', name: 'Tập đoàn Hòa Phát', cls: 'stock', price: 27350 },
    { symbol: 'FPT', name: 'Tập đoàn FPT', cls: 'stock', price: 128400 },
    { symbol: 'VCBF-BCF', name: 'Quỹ Cổ phiếu VCBF', cls: 'fund', price: 49820 },
    { symbol: 'BTC', name: 'Bitcoin', cls: 'crypto', price: 2542000000 },
    { symbol: 'SJC', name: 'Vàng nhẫn 9999 SJC (chỉ)', cls: 'gold', price: 8900000 },
  ];

  for (const ast of sampleAssets) {
    await db.prepare(`
      INSERT OR REPLACE INTO assets (id, symbol, name, asset_class, current_price, price_updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(`ast_${ast.symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`, ast.symbol, ast.name, ast.cls, ast.price).run();
  }

  return c.json({ success: true, message: 'Đã khởi tạo dữ liệu mẫu thành công.' });
});

// Ingest thông báo từ Android
app.post('/api/notifications/ingest', async (c) => {
  const db = c.env.DB;
  const body = await c.req.json<{
    packageName: string;
    title: string;
    text: string;
    userId?: string;
    occurredAt?: string;
  }>();

  const userId = body.userId || 'user_default';
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. Lưu log thông báo gốc (để debug và huấn luyện parser)
  await db.prepare(`
    INSERT INTO raw_notifications (id, user_id, package_name, title, raw_body, received_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(notifId, userId, body.packageName || 'unknown', body.title || '', body.text || '').run();

  // 2. Parse nội dung (truyền occurredAt từ client nếu có)
  const parsed = parseBankNotification(body.packageName, body.title, body.text, body.occurredAt);
  if (!parsed) {
    await db.prepare('UPDATE raw_notifications SET is_parsed = 0, parse_error = ? WHERE id = ?')
      .bind('Không khớp mẫu ngân hàng', notifId).run();
    return c.json({ success: false, message: 'Không thể parse thông báo' }, 400);
  }

  // 3. Chống trùng (đưa thêm balanceAfter để không chặn nhầm 2 GD liên tiếp cùng số tiền)
  const dedupeHash = await generateDedupeHash(
    parsed.bankCode,
    parsed.accountMask,
    parsed.amount,
    parsed.type,
    parsed.occurredAt,
    parsed.description,
    parsed.balanceAfter
  );

  const existing = await db.prepare('SELECT id FROM transactions WHERE dedupe_hash = ?')
    .bind(dedupeHash).first();

  if (existing) {
    return c.json({ success: true, duplicate: true, message: 'Giao dịch đã được ghi nhận trước đó', txnId: existing.id });
  }

  // 4. Tìm tài khoản khớp số đuôi hoặc mã ngân hàng
  let account = await db.prepare(`
    SELECT id, balance, name, bank_code, account_number_mask FROM accounts
    WHERE user_id = ? AND (bank_code = ? OR account_number_mask = ?) AND is_active = 1
    LIMIT 1
  `).bind(userId, parsed.bankCode, parsed.accountMask).first<{ id: string; balance: number; name: string; bank_code: string | null; account_number_mask: string | null }>();

  // Nếu chưa tìm thấy theo bank_code hoặc mask, tìm kiếm thông minh theo tên tài khoản người dùng đã tạo (tránh tạo tài khoản trùng)
  if (!account) {
    const cleanBank = (parsed.bankCode || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const { results: existingAccounts } = await db.prepare(`
      SELECT id, balance, name, bank_code, account_number_mask FROM accounts
      WHERE user_id = ? AND is_active = 1
    `).bind(userId).all<{ id: string; balance: number; name: string; bank_code: string | null; account_number_mask: string | null }>();

    for (const a of (existingAccounts || [])) {
      const cleanName = (a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const isMatch =
        cleanName.includes(cleanBank) ||
        cleanBank.includes(cleanName) ||
        (cleanBank.startsWith('hd') && cleanName.startsWith('hd')) ||
        (cleanBank.startsWith('tcb') && cleanName.includes('tech')) ||
        (cleanBank.startsWith('tp') && cleanName.startsWith('tp')) ||
        (cleanBank.startsWith('mb') && cleanName.startsWith('mb')) ||
        (cleanBank.startsWith('vcb') && cleanName.includes('vietcom'));

      if (isMatch) {
        account = a;
        // Tự động bổ sung bank_code và số đuôi cho tài khoản hiện có của người dùng
        await db.prepare('UPDATE accounts SET bank_code = ?, account_number_mask = COALESCE(account_number_mask, ?) WHERE id = ?')
          .bind(parsed.bankCode, parsed.accountMask, a.id).run();
        break;
      }
    }
  }

  let accountId: string;
  if (account) {
    accountId = account.id;
    // L-01: KHÔNG sửa accounts.balance khi giao dịch đang ở trạng thái pending!
    // Số dư chỉ được cập nhật khi người dùng bấm Duyệt (confirmed).
  } else {
    // Chỉ tự tạo tài khoản mới nếu thực sự chưa có tài khoản nào của ngân hàng này
    accountId = `acc_${parsed.bankCode.toLowerCase()}_${parsed.accountMask}`;
    const accountName = `${parsed.bankCode} · *${parsed.accountMask}`;
    const initialBal = parsed.balanceAfter && parsed.balanceAfter > 0
      ? (parsed.type === 'expense' ? parsed.balanceAfter + parsed.amount : Math.max(0, parsed.balanceAfter - parsed.amount))
      : 0;
    await db.prepare(`
      INSERT OR IGNORE INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
      VALUES (?, ?, ?, 'bank', ?, ?, ?)
    `).bind(accountId, userId, accountName, parsed.bankCode, parsed.accountMask, initialBal).run();
  }

  // 5. Tự động phân loại danh mục & hũ (L-13 & L-09: load user-learned rules an toàn)
  let userRules: { pattern: string; categoryName: string; jarCode: string }[] = [];
  try {
    const rulesRes = await db.prepare(
      'SELECT pattern, category_name as categoryName, jar_code as jarCode FROM rules WHERE user_id = ? AND pattern IS NOT NULL'
    ).bind(userId).all<{ pattern: string; categoryName: string; jarCode: string }>();
    userRules = (rulesRes.results || []).filter(r => r.pattern && r.jarCode);
  } catch {
    userRules = [];
  }

  const cat = categorizeTransaction(parsed.description, parsed.type, userRules);

  // L-13: Lấy jar_id từ jarCode, hoặc ưu tiên hũ mặc định (is_default = 1), hoặc hũ đầu tiên của user
  let jar = parsed.type === 'expense'
    ? await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?').bind(userId, cat.jarCode).first<{ id: string }>()
    : null;

  if (parsed.type === 'expense' && !jar && cat.confidence < 0.6) {
    jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND is_default = 1')
      .bind(userId).first<{ id: string }>();
  }

  if (parsed.type === 'expense' && !jar) {
    jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? ORDER BY sort_order ASC LIMIT 1')
      .bind(userId).first<{ id: string }>();
  }

  const jarId = parsed.type === 'expense' ? (jar ? jar.id : 'jar_nec') : null;

  // Tự động nhận diện nguồn thu cho giao dịch cộng tiền (income) dựa trên tên nguồn thu hoặc từ khóa keywords
  let incomeSourceId: string | null = null;
  let incomeCategoryName: string = cat.categoryName;

  if (parsed.type === 'income') {
    try {
      await ensurePlanningTables(db);
      const { results: userIncomeSources } = await db.prepare(
        'SELECT id, name, keywords FROM income_sources WHERE user_id = ? AND is_active = 1'
      ).bind(userId).all<{ id: string; name: string; keywords: string | null }>();

      if (userIncomeSources && userIncomeSources.length > 0) {
        const cleanDesc = (parsed.description || '').toLowerCase();
        const normalizeStr = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const normDesc = normalizeStr(cleanDesc);

        for (const s of userIncomeSources) {
          const normName = normalizeStr(s.name || '');
          const kwList = (s.keywords || '')
            .split(',')
            .map(k => normalizeStr(k.trim()))
            .filter(Boolean);

          const matchName = normName.length >= 3 && normDesc.includes(normName);
          const matchKw = kwList.some(kw => kw.length >= 2 && normDesc.includes(kw));

          if (matchName || matchKw) {
            incomeSourceId = s.id;
            incomeCategoryName = s.name;
            break;
          }
        }
      }
    } catch (err) {
      console.error('Lỗi nhận diện nguồn thu tự động:', err);
    }
  }

  // 6. Tạo giao dịch ở trạng thái "Chờ duyệt" (pending) kèm balance_after và original_type
  const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, type, amount, occurred_at, description,
      jar_id, income_source_id, dedupe_hash, status, raw_notification_id, balance_after, original_type, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).bind(
    txnId,
    userId,
    accountId,
    parsed.type,
    parsed.amount,
    parsed.occurredAt,
    parsed.description,
    jarId,
    incomeSourceId,
    dedupeHash,
    notifId,
    parsed.balanceAfter || null,
    parsed.type,
    parsed.type === 'income' ? incomeCategoryName : cat.categoryName
  ).run();

  // Đánh dấu đã parse thành công và ghi mã ngân hàng
  await db.prepare('UPDATE raw_notifications SET is_parsed = 1, bank_code = ? WHERE id = ?')
    .bind(parsed.bankCode, notifId).run();

  // 7. TỰ ĐỘNG GHÉP CẶP CHUYỂN TIỀN NỘI BỘ (Phương án 1 & 3 - L-07: Cửa sổ thời gian <= 120 phút)
  let isAutoPaired = false;
  let pairId: string | null = null;
  const counterType = parsed.type === 'expense' ? 'income' : 'expense';

  // Tìm giao dịch pending đối ứng: Cùng số tiền, khác tài khoản, ngược loại income/expense, trong vòng 120 phút
  const candidate = await db.prepare(`
    SELECT t.id, t.account_id, t.description, t.occurred_at, a.bank_code, a.name as account_name
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE t.user_id = ?
      AND t.status = 'pending'
      AND t.transfer_pair_id IS NULL
      AND t.amount = ?
      AND t.account_id != ?
      AND t.type = ?
      AND ABS(julianday(t.occurred_at) - julianday(?)) * 1440 <= 120
    ORDER BY t.occurred_at DESC
    LIMIT 1
  `).bind(userId, parsed.amount, accountId, counterType, parsed.occurredAt).first<{
    id: string;
    account_id: string;
    description: string;
    occurred_at: string;
    bank_code: string;
    account_name: string;
  }>();

  if (candidate) {
    pairId = `pair_${Date.now()}`;
    const isCurrentExpense = parsed.type === 'expense';
    const primaryId = isCurrentExpense ? txnId : candidate.id;
    const secondaryId = isCurrentExpense ? candidate.id : txnId;
    const receiverAccountId = isCurrentExpense ? candidate.account_id : accountId;
    const senderBank = isCurrentExpense ? parsed.bankCode : candidate.bank_code;
    const receiverBank = isCurrentExpense ? candidate.bank_code : parsed.bankCode;
    const pairNote = `[Tự động ghép cặp] ${senderBank} ➔ ${receiverBank}`;

    // Chân trừ tiền (expense) làm bản ghi transfer chính (hiển thị 1 thẻ duy nhất trong Hộp thư, trừ nguồn -> cộng đích)
    await db.prepare(`
      UPDATE transactions 
      SET type = 'transfer', transfer_pair_id = ?, to_account_id = ?, jar_id = NULL, status = 'pending', notes = ?
      WHERE id = ?
    `).bind(pairId, receiverAccountId, pairNote, primaryId).run();

    // Chân cộng tiền (income) được ẩn đi để không hiện trùng 2 thẻ trong Hộp thư / Lịch sử (có thể khôi phục khi bấm Tách)
    await db.prepare(`
      UPDATE transactions 
      SET type = 'transfer', transfer_pair_id = ?, to_account_id = NULL, jar_id = NULL, status = 'paired_hidden', notes = ?
      WHERE id = ?
    `).bind(pairId, pairNote, secondaryId).run();

    isAutoPaired = true;
  }

  return c.json({
    success: true,
    duplicate: false,
    autoPaired: isAutoPaired,
    transferPairId: pairId,
    transaction: {
      id: txnId,
      amount: parsed.amount,
      type: isAutoPaired ? 'transfer' : parsed.type,
      description: parsed.description,
      bankCode: parsed.bankCode,
      suggestedCategory: isAutoPaired ? 'Chuyển khoản nội bộ' : cat.categoryName,
      jarCode: cat.jarCode,
      confidence: cat.confidence
    }
  });
});

// Xem nhật ký các thông báo Android gần đây (dùng để kiểm tra và debug trên app)
app.get('/api/notifications/recent', async (c) => {
  const db = c.env.DB;
  const limit = parseInt(c.req.query('limit') || '30', 10);
  const { results } = await db.prepare(`
    SELECT id, package_name, title, raw_body, bank_code, is_parsed, parse_error, received_at
    FROM raw_notifications
    ORDER BY received_at DESC
    LIMIT ?
  `).bind(limit).all();

  return c.json({ notifications: results });
});

// Xử lý lại (reprocess) các thông báo chưa parse được trong quá khứ
app.post('/api/notifications/reprocess', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';

  const { results } = await db.prepare(`
    SELECT id, package_name, title, raw_body FROM raw_notifications
    WHERE is_parsed = 0
    ORDER BY received_at ASC
  `).all<{ id: string; package_name: string; title: string; raw_body: string }>();

  let parsedCount = 0;
  const createdTxns: any[] = [];

  for (const notif of results) {
    const parsed = parseBankNotification(notif.package_name, notif.title, notif.raw_body);
    if (parsed) {
      const dedupeHash = await generateDedupeHash(
        parsed.bankCode,
        parsed.accountMask,
        parsed.amount,
        parsed.type,
        parsed.occurredAt,
        parsed.description
      );

      const existing = await db.prepare('SELECT id FROM transactions WHERE dedupe_hash = ?')
        .bind(dedupeHash).first();

      if (!existing) {
        // Tìm hoặc tạo tài khoản
        let account = await db.prepare(`
          SELECT id FROM accounts
          WHERE user_id = ? AND (bank_code = ? OR account_number_mask = ?)
          LIMIT 1
        `).bind(userId, parsed.bankCode, parsed.accountMask).first<{ id: string }>();

        let accountId: string;
        if (account) {
          accountId = account.id;
        } else {
          accountId = `acc_${parsed.bankCode.toLowerCase()}_${parsed.accountMask}`;
          const accountName = `${parsed.bankCode} · *${parsed.accountMask}`;
          await db.prepare(`
            INSERT OR IGNORE INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
            VALUES (?, ?, ?, 'bank', ?, ?, ?)
          `).bind(accountId, userId, accountName, parsed.bankCode, parsed.accountMask, parsed.balanceAfter || 0).run();
        }

        const cat = categorizeTransaction(parsed.description, parsed.type);
        const jar = parsed.type === 'expense'
          ? await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?').bind(userId, cat.jarCode).first<{ id: string }>()
          : null;
        const jarId = parsed.type === 'expense' ? (jar ? jar.id : 'jar_nec') : null;

        let incomeSourceId: string | null = null;
        let incomeCategoryName: string = cat.categoryName;

        if (parsed.type === 'income') {
          try {
            await ensurePlanningTables(db);
            const { results: userIncomeSources } = await db.prepare(
              'SELECT id, name, keywords FROM income_sources WHERE user_id = ? AND is_active = 1'
            ).bind(userId).all<{ id: string; name: string; keywords: string | null }>();

            if (userIncomeSources && userIncomeSources.length > 0) {
              const cleanDesc = (parsed.description || '').toLowerCase();
              const normalizeStr = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
              const normDesc = normalizeStr(cleanDesc);

              for (const s of userIncomeSources) {
                const normName = normalizeStr(s.name || '');
                const kwList = (s.keywords || '')
                  .split(',')
                  .map(k => normalizeStr(k.trim()))
                  .filter(Boolean);

                const matchName = normName.length >= 3 && normDesc.includes(normName);
                const matchKw = kwList.some(kw => kw.length >= 2 && normDesc.includes(kw));

                if (matchName || matchKw) {
                  incomeSourceId = s.id;
                  incomeCategoryName = s.name;
                  break;
                }
              }
            }
          } catch {}
        }

        const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await db.prepare(`
          INSERT INTO transactions (
            id, user_id, account_id, type, amount, occurred_at, description,
            jar_id, income_source_id, dedupe_hash, status, raw_notification_id, notes, original_type
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).bind(
          txnId,
          userId,
          accountId,
          parsed.type,
          parsed.amount,
          parsed.occurredAt,
          parsed.description,
          jarId,
          incomeSourceId,
          dedupeHash,
          notif.id,
          parsed.type === 'income' ? incomeCategoryName : cat.categoryName,
          parsed.type
        ).run();

        createdTxns.push({ id: txnId, bank: parsed.bankCode, amount: parsed.amount, desc: parsed.description });
      }

      await db.prepare('UPDATE raw_notifications SET is_parsed = 1, bank_code = ?, parse_error = NULL WHERE id = ?')
        .bind(parsed.bankCode, notif.id).run();
      parsedCount++;
    }
  }

  return c.json({
    success: true,
    reprocessed: results.length,
    parsedCount,
    createdTxns
  });
});

// Lấy danh sách giao dịch (V2-14: Hỗ trợ phân trang cursor, bộ lọc và tính toán tổng)
app.get('/api/transactions', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const status = c.req.query('status'); // 'pending' | 'confirmed' | 'rejected'
  const type = c.req.query('type'); // 'income' | 'expense' | 'transfer'
  const jarId = c.req.query('jarId');
  const incomeSourceId = c.req.query('incomeSourceId');
  const accountId = c.req.query('accountId');
  const search = (c.req.query('search') || '').trim();
  const year = c.req.query('year');
  const month = c.req.query('month');
  const quarter = c.req.query('quarter');
  const cursor = c.req.query('cursor');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '500', 10), 1), 500);
  const userId = 'user_default';

  const whereClauses: string[] = [
    't.user_id = ?',
    't.deleted_at IS NULL',
    't.history_hidden_at IS NULL',
    "t.status != 'paired_hidden'",
    "NOT (t.transfer_pair_id IS NOT NULL AND t.original_type = 'income' AND t.to_account_id IS NOT NULL AND p.original_type = 'expense')"
  ];
  const params: any[] = [userId];

  if (status) {
    whereClauses.push('t.status = ?');
    params.push(status);
  }
  if (type) {
    whereClauses.push('t.type = ?');
    params.push(type);
  }
  if (jarId) {
    if (jarId === 'unassigned') {
      whereClauses.push('t.jar_id IS NULL');
    } else {
      whereClauses.push('t.jar_id = ?');
      params.push(jarId);
    }
  }
  if (incomeSourceId) {
    if (incomeSourceId === 'unassigned') {
      whereClauses.push('t.income_source_id IS NULL');
    } else {
      whereClauses.push('t.income_source_id = ?');
      params.push(incomeSourceId);
    }
  }
  if (accountId) {
    whereClauses.push('(t.account_id = ? OR t.to_account_id = ?)');
    params.push(accountId, accountId);
  }
  if (search) {
    whereClauses.push('(t.description LIKE ? OR t.notes LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  if (year && month) {
    whereClauses.push("strftime('%Y-%m', datetime(t.occurred_at, '+7 hours')) = ?");
    params.push(`${year}-${String(month).padStart(2, '0')}`);
  } else if (year && quarter) {
    whereClauses.push("strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ? AND ((CAST(strftime('%m', datetime(t.occurred_at, '+7 hours')) AS INTEGER) - 1) / 3) = ?");
    params.push(String(year), Math.max(0, parseInt(quarter, 10) - 1));
  } else if (year) {
    whereClauses.push("strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ?");
    params.push(String(year));
  }

  // Count & Total amount with current filters
  const countQuery = `
    SELECT COUNT(*) as total_count, COALESCE(SUM(t.amount), 0) as total_amount
    FROM transactions t
    LEFT JOIN transactions p ON (t.transfer_pair_id IS NOT NULL AND p.transfer_pair_id = t.transfer_pair_id AND p.id != t.id)
    WHERE ${whereClauses.join(' AND ')}
  `;
  const countStats = await db.prepare(countQuery).bind(...params).first<{ total_count: number; total_amount: number }>();

  // If cursor provided (V2-14: Base64 an toàn không xung đột ký tự gạch dưới trong ID)
  const queryParams = [...params];
  const queryWhereClauses = [...whereClauses];
  if (cursor) {
    let cursorOccurredAt: string | null = null;
    let cursorId: string | null = null;

    if (cursor.includes('#')) {
      const parts = cursor.split('#');
      cursorOccurredAt = parts[0];
      cursorId = parts.slice(1).join('#');
    } else {
      try {
        const decoded = atob(cursor);
        if (decoded.includes('#')) {
          const parts = decoded.split('#');
          cursorOccurredAt = parts[0];
          cursorId = parts.slice(1).join('#');
        }
      } catch {
        // Hỗ trợ định dạng cũ nếu có
        const lastUnder = cursor.lastIndexOf('_');
        if (lastUnder !== -1) {
          cursorOccurredAt = cursor.substring(0, lastUnder);
          cursorId = cursor.substring(lastUnder + 1);
        }
      }
    }

    if (cursorOccurredAt && cursorId) {
      queryWhereClauses.push('(t.occurred_at < ? OR (t.occurred_at = ? AND t.id < ?))');
      queryParams.push(cursorOccurredAt, cursorOccurredAt, cursorId);
    }
  }

  const selectQuery = `
    SELECT t.*, a.name as account_name, a.bank_code, a.account_number_mask,
           toa.name as to_account_name, toa.bank_code as to_bank_code, toa.account_number_mask as to_account_number_mask,
           j.name as jar_name, j.color as jar_color, j.code as jar_code,
           s.name as income_source_name,
           r.raw_body,
           p.id as paired_txn_id,
           pa.name as paired_account_name,
           pa.bank_code as paired_bank_code,
           pa.account_number_mask as paired_account_mask,
           p.type as paired_type
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN accounts toa ON t.to_account_id = toa.id
    LEFT JOIN jars j ON t.jar_id = j.id
    LEFT JOIN income_sources s ON t.income_source_id = s.id
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
    LEFT JOIN transactions p ON (t.transfer_pair_id IS NOT NULL AND p.transfer_pair_id = t.transfer_pair_id AND p.id != t.id)
    LEFT JOIN accounts pa ON p.account_id = pa.id
    WHERE ${queryWhereClauses.join(' AND ')}
    ORDER BY t.occurred_at DESC, t.id DESC
    LIMIT ?
  `;
  queryParams.push(limit + 1);

  const { results } = await db.prepare(selectQuery).bind(...queryParams).all<any>();
  let nextCursor: string | null = null;
  let items = results || [];
  if (items.length > limit) {
    const nextItem = items[limit - 1];
    nextCursor = btoa(`${nextItem.occurred_at}#${nextItem.id}`);
    items = items.slice(0, limit);
  }

  const revRow = await db.prepare('SELECT COALESCE(MAX(revision), 1) as max_rev FROM transactions WHERE user_id = ?')
    .bind(userId).first<{ max_rev: number }>();

  return c.json({
    items,
    nextCursor,
    totalCount: countStats?.total_count || 0,
    totalAmountVnd: countStats?.total_amount || 0,
    dataRevision: revRow?.max_rev || 1,
    transactions: items
  });
});

// Duyệt / Sửa / Bỏ qua / Hoàn tác giao dịch (V2-02: Idempotent & Chuẩn toán học Delta)
app.put('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const id = c.req.param('id');
  const userId = 'user_default';
  const body = await c.req.json<{
    status?: 'pending' | 'confirmed' | 'rejected';
    jarId?: string;
    jarCode?: string;
    categoryId?: string;
    categoryName?: string;
    incomeSourceId?: string | null;
    notes?: string;
    amount?: number;
    description?: string;
    operationId?: string;
  }>();

  const clientOpId = c.req.header('X-Operation-Id') || body.operationId;
  const { operationId, cachedAck, conflict, payloadHash } = await processMutationReceipt(
    db, userId, clientOpId, { path: `/api/transactions/${id}`, body }
  );

  if (conflict) {
    return c.json({ success: false, code: 'MUTATION_CONFLICT', message: 'Operation ID collision with different payload' }, 409);
  }
  if (cachedAck) {
    return c.json(cachedAck);
  }

  // 1. Đọc thông tin giao dịch hiện tại
  const currentTxn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!currentTxn) {
    return c.json({ success: false, message: 'Không tìm thấy giao dịch' }, 404);
  }

  const finalAmount = body.amount !== undefined ? Math.round(body.amount) : currentTxn.amount;
  const finalStatus = body.status !== undefined ? body.status : currentTxn.status;

  // 2. Tính Delta đóng góp số dư chuẩn xác theo V2-02
  const oldState: TxnState = {
    type: currentTxn.type,
    amount: currentTxn.amount,
    status: currentTxn.status,
    sourceAccountId: currentTxn.account_id,
    toAccountId: currentTxn.to_account_id,
    isPairedHidden: currentTxn.status === 'paired_hidden',
    deletedAt: currentTxn.deleted_at
  };

  const newState: TxnState = {
    type: currentTxn.type,
    amount: finalAmount,
    status: finalStatus,
    sourceAccountId: currentTxn.account_id,
    toAccountId: currentTxn.to_account_id,
    isPairedHidden: finalStatus === 'paired_hidden',
    deletedAt: currentTxn.deleted_at
  };

  const deltaSrc = calculateBalanceDelta(oldState, newState, currentTxn.account_id);
  await applyLedgerDelta(db, userId, operationId, currentTxn.account_id, id, deltaSrc);

  if (currentTxn.to_account_id) {
    const deltaDst = calculateBalanceDelta(oldState, newState, currentTxn.to_account_id);
    await applyLedgerDelta(db, userId, operationId, currentTxn.to_account_id, id, deltaDst);
  }

  const updates: string[] = [];
  const params: any[] = [];

  // Cập nhật trạng thái
  if (body.status) {
    updates.push('status = ?');
    params.push(body.status);

    if (currentTxn.transfer_pair_id) {
      const secondaryStatus = body.status === 'rejected' ? 'rejected' : 'paired_hidden';
      await db.prepare('UPDATE transactions SET status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE transfer_pair_id = ? AND id != ? AND user_id = ?')
        .bind(secondaryStatus, currentTxn.transfer_pair_id, id, userId).run();
    }
  }

  // Ưu tiên jarId chính xác tuyệt đối (chỉ áp dụng cho giao dịch Chi tiêu)
  let resolvedJarId: string | null = null;
  let resolvedJarCode: string | null = body.jarCode || null;
  if (currentTxn.type === 'expense') {
    if (body.jarId !== undefined) {
      updates.push('jar_id = ?');
      params.push(body.jarId || null);
      resolvedJarId = body.jarId || null;
      if (body.jarId && !resolvedJarCode) {
        const j = await db.prepare('SELECT code FROM jars WHERE id = ? AND user_id = ?')
          .bind(body.jarId, userId).first<{ code: string }>();
        resolvedJarCode = j?.code || null;
      }
    } else if (body.jarCode) {
      const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
        .bind(userId, body.jarCode).first<{ id: string }>();
      if (jar) {
        updates.push('jar_id = ?');
        params.push(jar.id);
        resolvedJarId = jar.id;
      }
    }
  } else {
    updates.push('jar_id = NULL');
  }

  // Gắn incomeSourceId (chỉ áp dụng cho giao dịch Thu nhập)
  if (currentTxn.type === 'income') {
    if (body.incomeSourceId !== undefined) {
      updates.push('income_source_id = ?');
      params.push(body.incomeSourceId || null);
    }
  } else {
    updates.push('income_source_id = NULL');
  }

  if (body.amount !== undefined) {
    updates.push('amount = ?');
    params.push(Math.round(body.amount));
  }
  if (body.description !== undefined) {
    updates.push('description = ?');
    params.push(body.description);
  }
  if (body.categoryId) {
    updates.push('category_id = ?');
    params.push(body.categoryId);
  }
  if (body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(body.notes);
  } else if (body.categoryName) {
    updates.push('notes = ?');
    params.push(body.categoryName);
  }

  // Tự học quy tắc phân loại hũ
  if ((resolvedJarCode || resolvedJarId) && currentTxn.type === 'expense') {
    try {
      const descWords = (body.description || currentTxn.description || '')
        .replace(/[^A-Za-z0-9À-ỹ\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join(' ');
      if (descWords.length >= 3) {
        await db.prepare('DELETE FROM rules WHERE user_id = ? AND UPPER(pattern) = UPPER(?)')
          .bind(userId, descWords).run();
        await db.prepare(`
          INSERT INTO rules (id, user_id, pattern, category_name, jar_code, jar_id)
          VALUES (?, ?, ?, ?, ?, ?)
        `).bind(
          `rule_${Date.now()}`,
          userId,
          descWords,
          body.categoryName || 'Chi tiêu',
          resolvedJarCode || 'NEC',
          resolvedJarId
        ).run();
      }
    } catch (ruleErr) {
      console.warn('Skip rule learning:', ruleErr);
    }
  }

  updates.push('revision = revision + 1');
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  params.push(userId);

  await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();

  const ack = { success: true, message: 'Đã cập nhật giao dịch', operationId, revision: (currentTxn.revision || 1) + 1 };
  await saveMutationReceipt(db, userId, operationId, payloadHash, ack);
  return c.json(ack);
});

// Thêm giao dịch thủ công (V2-02, V2-46)
app.post('/api/transactions', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const userId = 'user_default';
  const body = await c.req.json<{
    id?: string;
    accountId: string;
    toAccountId?: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    jarCode?: string;
    categoryName?: string;
    occurredAt?: string;
    incomeSourceId?: string;
    operationId?: string;
  }>();

  const rawAmt = Number(body.amount);
  if (!Number.isFinite(rawAmt) || isNaN(rawAmt) || rawAmt <= 0 || rawAmt > Number.MAX_SAFE_INTEGER) {
    return c.json({ success: false, code: 'INVALID_AMOUNT', message: 'Số tiền giao dịch không hợp lệ' }, 400);
  }

  const clientOpId = c.req.header('X-Operation-Id') || body.operationId;
  const { operationId, cachedAck, conflict, payloadHash } = await processMutationReceipt(
    db, userId, clientOpId, { path: '/api/transactions', body }
  );

  if (conflict) {
    return c.json({ success: false, code: 'MUTATION_CONFLICT', message: 'Operation ID collision with different payload' }, 409);
  }
  if (cachedAck) {
    return c.json(cachedAck);
  }

  const txnId = body.id || `txn_man_${Date.now()}`;
  const cleanAmount = Math.round(rawAmt);
  let jarId = body.type === 'expense' ? (body.jarId || null) : null;
  if (!jarId && body.jarCode && body.type === 'expense') {
    const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
      .bind(userId, body.jarCode).first<{ id: string }>();
    jarId = jar?.id || null;
  }
  const incomeSourceId = body.type === 'income' ? (body.incomeSourceId || null) : null;

  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, to_account_id, type, amount, occurred_at, description,
      jar_id, income_source_id, status, notes, original_type, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, 1)
  `).bind(
    txnId,
    userId,
    body.accountId,
    body.toAccountId || null,
    body.type,
    cleanAmount,
    body.occurredAt || new Date().toISOString(),
    body.description,
    body.type === 'transfer' ? null : jarId,
    incomeSourceId,
    body.categoryName || null,
    body.type === 'transfer' ? 'expense' : body.type
  ).run();

  // Hạch toán delta chuẩn xác
  const newTxnState: TxnState = {
    type: body.type,
    amount: cleanAmount,
    status: 'confirmed',
    sourceAccountId: body.accountId,
    toAccountId: body.toAccountId || null
  };

  const deltaSrc = calculateBalanceDelta(null, newTxnState, body.accountId);
  await applyLedgerDelta(db, userId, operationId, body.accountId, txnId, deltaSrc);

  if (body.type === 'transfer' && body.toAccountId) {
    const deltaDst = calculateBalanceDelta(null, newTxnState, body.toAccountId);
    await applyLedgerDelta(db, userId, operationId, body.toAccountId, txnId, deltaDst);
  }

  const ack = { success: true, id: txnId, operationId, revision: 1 };
  await saveMutationReceipt(db, userId, operationId, payloadHash, ack);
  return c.json(ack);
});

// Xóa giao dịch (V2-02: Hoàn tác sổ cái Delta hai chiều, soft delete và bảo toàn lịch sử)
app.delete('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const id = c.req.param('id');
  const userId = 'user_default';
  const clientOpId = c.req.header('X-Operation-Id');

  const { operationId, cachedAck, conflict, payloadHash } = await processMutationReceipt(
    db, userId, clientOpId, { deleteTxnId: id }
  );
  if (conflict) {
    return c.json({ success: false, code: 'MUTATION_CONFLICT', message: 'Operation ID collision with different payload' }, 409);
  }
  if (cachedAck) {
    return c.json(cachedAck);
  }

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!txn) {
    return c.json({ success: true, message: 'Giao dịch không tồn tại hoặc đã xóa' });
  }

  // Hoàn tác sổ cái số dư nếu giao dịch đang confirmed
  const oldState: TxnState = {
    type: txn.type,
    amount: txn.amount,
    status: txn.status,
    sourceAccountId: txn.account_id,
    toAccountId: txn.to_account_id,
    isPairedHidden: txn.status === 'paired_hidden',
    deletedAt: txn.deleted_at
  };

  const deltaSrc = calculateBalanceDelta(oldState, null, txn.account_id);
  await applyLedgerDelta(db, userId, operationId, txn.account_id, id, deltaSrc);

  if (txn.to_account_id) {
    const deltaDst = calculateBalanceDelta(oldState, null, txn.to_account_id);
    await applyLedgerDelta(db, userId, operationId, txn.to_account_id, id, deltaDst);
  }

  // Soft delete cả cặp nếu có transfer_pair_id (V2-02, AT2-21)
  if (txn.transfer_pair_id) {
    await db.prepare('UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE transfer_pair_id = ? AND user_id = ?')
      .bind(txn.transfer_pair_id, userId).run();
  } else {
    await db.prepare('UPDATE transactions SET deleted_at = CURRENT_TIMESTAMP, revision = revision + 1 WHERE id = ? AND user_id = ?')
      .bind(id, userId).run();
  }

  const ack = { success: true, operationId };
  await saveMutationReceipt(db, userId, operationId, payloadHash, ack);
  return c.json(ack);
});

// Tách 2 giao dịch (Unpair - V2-10, AT2-21: Xử lý chân synthetic không biến thành giao dịch thật)
app.post('/api/transactions/:id/unpair', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const id = c.req.param('id');
  const userId = 'user_default';
  const clientOpId = c.req.header('X-Operation-Id');

  const { operationId, cachedAck, conflict, payloadHash } = await processMutationReceipt(
    db, userId, clientOpId, { unpairTxnId: id }
  );
  if (conflict) {
    return c.json({ success: false, code: 'MUTATION_CONFLICT', message: 'Operation ID collision with different payload' }, 409);
  }
  if (cachedAck) {
    return c.json(cachedAck);
  }

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!txn || !txn.transfer_pair_id) {
    return c.json({ success: false, message: 'Giao dịch này không nằm trong cặp chuyển khoản nào' }, 400);
  }

  const pairId = txn.transfer_pair_id;

  // Nếu giao dịch chuyển nội bộ đã từng được duyệt, đảo ngược đóng góp chuyển khoản trước khi tách
  if (txn.status === 'confirmed' && txn.type === 'transfer') {
    const oldTransferState: TxnState = {
      type: 'transfer',
      amount: txn.amount,
      status: 'confirmed',
      sourceAccountId: txn.account_id,
      toAccountId: txn.to_account_id
    };
    const deltaSrc = calculateBalanceDelta(oldTransferState, null, txn.account_id);
    await applyLedgerDelta(db, userId, operationId, txn.account_id, id, deltaSrc);

    if (txn.to_account_id) {
      const deltaDst = calculateBalanceDelta(oldTransferState, null, txn.to_account_id);
      await applyLedgerDelta(db, userId, operationId, txn.to_account_id, id, deltaDst);
    }
  }

  const pairedTxns = await db.prepare(`
    SELECT t.id, t.raw_notification_id, t.original_type, r.raw_body, t.description, t.is_synthetic
    FROM transactions t
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
    WHERE t.transfer_pair_id = ? AND t.user_id = ?
  `).bind(pairId, userId).all<{ id: string; raw_notification_id: string | null; original_type: string | null; raw_body: string | null; description: string; is_synthetic: number | null }>();

  // Lấy hũ mặc định
  const defaultJar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND is_default = 1').bind(userId).first<{ id: string }>()
    || await db.prepare('SELECT id FROM jars WHERE user_id = ? ORDER BY sort_order ASC LIMIT 1').bind(userId).first<{ id: string }>();
  const fallbackJarId = defaultJar?.id || 'jar_nec';

  for (const t of pairedTxns.results) {
    // AT2-21: Chân synthetic (chân ảo tự tạo lúc ghép đơn lẻ) KHÔNG ĐƯỢC biến thành giao dịch thật sau khi tách
    if (t.is_synthetic === 1) {
      await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(t.id, userId).run();
      continue;
    }

    let origType = t.original_type;
    if (!origType) {
      const text = (t.raw_body || t.description || '').toLowerCase();
      origType = text.includes('+') || text.includes('cộng') || text.includes('nhận') ? 'income' : 'expense';
    }
    const jarId = origType === 'income' ? null : fallbackJarId;

    await db.prepare(`
      UPDATE transactions 
      SET transfer_pair_id = NULL,
          to_account_id = NULL,
          type = ?,
          jar_id = ?,
          status = 'pending',
          notes = 'Đã tách thủ công từ cặp chuyển tiền',
          revision = revision + 1,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).bind(origType, jarId, t.id, userId).run();
  }

  const ack = { success: true, message: 'Đã tách 2 giao dịch thành công', operationId };
  await saveMutationReceipt(db, userId, operationId, payloadHash, ack);
  return c.json(ack);
});

// Ghép cặp thủ công 1 giao dịch (thu hoặc chi) thành chuyển khoản nội bộ (V2-10, AT2-21)
app.post('/api/transactions/:id/pair-transfer', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const id = c.req.param('id');
  const userId = 'user_default';
  const { toAccountId, operationId: clientOpId } = await c.req.json<{ toAccountId: string; operationId?: string }>();

  const { operationId, cachedAck, conflict, payloadHash } = await processMutationReceipt(
    db, userId, clientOpId, { pairTxnId: id, toAccountId }
  );
  if (conflict) {
    return c.json({ success: false, code: 'MUTATION_CONFLICT', message: 'Operation ID collision with different payload' }, 409);
  }
  if (cachedAck) {
    return c.json(cachedAck);
  }

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!txn) {
    return c.json({ success: false, message: 'Không tìm thấy giao dịch' }, 404);
  }

  const selectedAcc = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
    .bind(toAccountId, userId).first<any>();

  if (!selectedAcc) {
    return c.json({ success: false, message: 'Không tìm thấy tài khoản đã chọn' }, 404);
  }

  if (toAccountId === txn.account_id) {
    return c.json({ success: false, message: 'Tài khoản chuyển và nhận phải khác nhau' }, 400);
  }

  const currentAcc = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
    .bind(txn.account_id, userId).first<any>();

  const isIncome = txn.type === 'income' || txn.original_type === 'income';
  const pairId = `pair_${Date.now()}`;

  if (isIncome) {
    const sourceAccountId = toAccountId;
    const destAccountId = txn.account_id;

    const existingCounter = await db.prepare(`
      SELECT id FROM transactions
      WHERE user_id = ? AND account_id = ? AND amount = ? AND type = 'expense' AND status = 'pending' AND transfer_pair_id IS NULL AND deleted_at IS NULL
      ORDER BY occurred_at DESC LIMIT 1
    `).bind(userId, sourceAccountId, txn.amount).first<{ id: string }>();

    if (existingCounter) {
      await db.prepare(`
        UPDATE transactions
        SET type = 'transfer', to_account_id = ?, transfer_pair_id = ?, jar_id = NULL, income_source_id = NULL, original_type = 'expense', notes = ?, revision = revision + 1
        WHERE id = ? AND user_id = ?
      `).bind(destAccountId, pairId, `Chuyển sang ${currentAcc?.name || 'tài khoản nhận'}`, existingCounter.id, userId).run();

      await db.prepare(`
        UPDATE transactions
        SET type = 'transfer', transfer_pair_id = ?, jar_id = NULL, income_source_id = NULL, status = 'paired_hidden', original_type = 'income', notes = ?, revision = revision + 1
        WHERE id = ? AND user_id = ?
      `).bind(pairId, `Nhận từ đối ứng ${existingCounter.id}`, id, userId).run();
    } else {
      await db.prepare(`
        UPDATE transactions
        SET account_id = ?, to_account_id = ?, type = 'transfer', transfer_pair_id = ?, jar_id = NULL, income_source_id = NULL, original_type = 'expense', notes = ?, revision = revision + 1
        WHERE id = ? AND user_id = ?
      `).bind(sourceAccountId, destAccountId, pairId, `Chuyển từ ${selectedAcc.name} sang ${currentAcc?.name || 'tài khoản nhận'}`, id, userId).run();

      const counterTxnId = `txn_pair_${Date.now()}`;
      await db.prepare(`
        INSERT INTO transactions (
          id, user_id, account_id, type, amount, occurred_at, description,
          status, transfer_pair_id, original_type, notes, is_synthetic, revision
        ) VALUES (?, ?, ?, 'transfer', ?, ?, ?, 'paired_hidden', ?, 'income', ?, 1, 1)
      `).bind(
        counterTxnId,
        userId,
        destAccountId,
        txn.amount,
        txn.occurred_at,
        `Nhận chuyển khoản nội bộ vào ${currentAcc?.name || 'tài khoản nhận'}`,
        pairId,
        `Nhận từ đối ứng ${id}`
      ).run();
    }

    if (txn.status === 'confirmed') {
      await applyLedgerDelta(db, userId, operationId, sourceAccountId, id, -txn.amount);
    }
  } else {
    const sourceAccountId = txn.account_id;
    const destAccountId = toAccountId;

    const existingCounter = await db.prepare(`
      SELECT id FROM transactions
      WHERE user_id = ? AND account_id = ? AND amount = ? AND type = 'income' AND status = 'pending' AND transfer_pair_id IS NULL AND deleted_at IS NULL
      ORDER BY occurred_at DESC LIMIT 1
    `).bind(userId, destAccountId, txn.amount).first<{ id: string }>();

    await db.prepare(`
      UPDATE transactions 
      SET type = 'transfer', to_account_id = ?, transfer_pair_id = ?, jar_id = NULL, income_source_id = NULL, original_type = COALESCE(original_type, 'expense'), notes = ?, revision = revision + 1
      WHERE id = ? AND user_id = ?
    `).bind(destAccountId, pairId, `Chuyển sang ${selectedAcc.name}`, id, userId).run();

    if (txn.status === 'confirmed') {
      await applyLedgerDelta(db, userId, operationId, destAccountId, id, txn.amount);
    }

    if (existingCounter) {
      await db.prepare(`
        UPDATE transactions
        SET type = 'transfer', transfer_pair_id = ?, jar_id = NULL, income_source_id = NULL, status = 'paired_hidden', original_type = 'income', notes = ?, revision = revision + 1
        WHERE id = ? AND user_id = ?
      `).bind(pairId, `Nhận từ đối ứng ${id}`, existingCounter.id, userId).run();
    } else {
      const counterTxnId = `txn_pair_${Date.now()}`;
      await db.prepare(`
        INSERT INTO transactions (
          id, user_id, account_id, type, amount, occurred_at, description,
          status, transfer_pair_id, original_type, notes, is_synthetic, revision
        ) VALUES (?, ?, ?, 'transfer', ?, ?, ?, 'paired_hidden', ?, 'income', ?, 1, 1)
      `).bind(
        counterTxnId,
        userId,
        destAccountId,
        txn.amount,
        txn.occurred_at,
        `Nhận chuyển khoản nội bộ vào ${selectedAcc.name}`,
        pairId,
        `Nhận từ đối ứng ${id}`
      ).run();
    }
  }

  const ack = { success: true, message: 'Đã tạo chuyển khoản nội bộ thành công', operationId };
  await saveMutationReceipt(db, userId, operationId, payloadHash, ack);
  return c.json(ack);
});

// Thống kê tổng quan (Dashboard - Chuẩn UTC+7 & Đầy đủ 6 lớp tài sản)
app.get('/api/overview', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';

  // Tổng số dư các tài khoản
  const accountsResult = await db.prepare(`
    SELECT type, SUM(balance) as total_balance
    FROM accounts
    WHERE user_id = ? AND is_active = 1
    GROUP BY type
  `).bind(userId).all<{ type: string; total_balance: number }>();

  let liquidCash = 0;
  let allCash = 0;
  for (const row of accountsResult.results) {
    const b = row.total_balance || 0;
    allCash += b;
    if (['bank', 'cash', 'ewallet', 'savings'].includes(row.type)) {
      liquidCash += b;
    }
  }

  // Danh mục đầu tư
  const holdingsResult = await db.prepare(`
    SELECT h.quantity, a.current_price, a.symbol, a.asset_class
    FROM holdings h
    JOIN assets a ON h.asset_id = a.id
    WHERE h.user_id = ?
  `).bind(userId).all<{ quantity: number; current_price: number; symbol: string; asset_class: string }>();

  let totalInvestments = 0;
  for (const h of holdingsResult.results) {
    totalInvestments += (h.quantity * h.current_price);
  }

  // L-04: Tổng tài sản ròng = toàn bộ số dư tài khoản + toàn bộ danh mục tài sản
  const netWorth = allCash + totalInvestments;

  // Dòng tiền tháng hiện tại (Múi giờ UTC+7 Việt Nam)
  const monthStats = await db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
      SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
    FROM transactions
    WHERE user_id = ? AND status = 'confirmed'
      AND strftime('%Y-%m', datetime(occurred_at, '+7 hours')) = strftime('%Y-%m', datetime('now', '+7 hours'))
  `).bind(userId).first<{ total_income: number; total_expense: number }>();

  // Số lượng giao dịch chờ duyệt
  const pendingCount = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND status = 'pending'
  `).bind(userId).first<{ count: number }>();

  // Các hũ chi tiêu và mức tiêu tháng này (Múi giờ UTC+7)
  const jarsStats = await db.prepare(`
    SELECT
      j.id, j.code, j.name, j.target_percent, j.monthly_limit, j.color, j.is_default,
      COALESCE(SUM(t.amount), 0) as spent_this_month
    FROM jars j
    LEFT JOIN transactions t ON t.jar_id = j.id
      AND t.type = 'expense'
      AND t.status = 'confirmed'
      AND strftime('%Y-%m', datetime(t.occurred_at, '+7 hours')) = strftime('%Y-%m', datetime('now', '+7 hours'))
    WHERE j.user_id = ?
    GROUP BY j.id
    ORDER BY j.sort_order ASC
  `).bind(userId).all();

  return c.json({
    netWorth,
    liquidCash,
    totalInvestments,
    currentMonth: {
      income: monthStats?.total_income || 0,
      expense: monthStats?.total_expense || 0,
      savingsRate: monthStats?.total_income
        ? Math.round(((monthStats.total_income - (monthStats.total_expense || 0)) / monthStats.total_income) * 100)
        : 0
    },
    pendingCount: pendingCount?.count || 0,
    jars: jarsStats.results
  });
});

// V2-14: API Analytics tổng hợp trên server với định dạng chuẩn FinanceSummary
app.get('/api/analytics/summary', async (c) => {
  const db = c.env.DB;
  await ensureDatabaseSchema(db);
  const userId = 'user_default';
  const period = c.req.query('period') || 'month'; // 'month' | 'quarter' | 'year' | 'all'
  const rawTarget = (c.req.query('target') || '').trim();
  const qYear = c.req.query('year');
  const qMonth = c.req.query('month');
  const qQuarter = c.req.query('quarter');

  // Tính năm/tháng/quý mặc định theo giờ Việt Nam (UTC+7)
  const vnNow = new Date(Date.now() + 7 * 3600 * 1000);
  const yearNum = qYear ? parseInt(qYear, 10) : (rawTarget.match(/^\d{4}/) ? parseInt(rawTarget.slice(0, 4), 10) : vnNow.getUTCFullYear());
  const monthNum = qMonth ? parseInt(qMonth, 10) : (rawTarget.match(/^\d{4}-(\d{2})$/) ? parseInt(rawTarget.slice(5, 7), 10) : (vnNow.getUTCMonth() + 1));
  const quarterNum = qQuarter ? parseInt(qQuarter, 10) : (Math.floor((monthNum - 1) / 3) + 1);

  const yearStr = String(yearNum);
  const yearMonthStr = `${yearStr}-${String(monthNum).padStart(2, '0')}`;
  const quarterZeroIdx = Math.max(0, Math.min(3, quarterNum - 1));

  let dateClause = '1=1';
  let dateBindings: any[] = [];
  if (period === 'month') {
    dateClause = `strftime('%Y-%m', datetime(t.occurred_at, '+7 hours')) = ?`;
    dateBindings = [yearMonthStr];
  } else if (period === 'quarter') {
    dateClause = `strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ? AND ((CAST(strftime('%m', datetime(t.occurred_at, '+7 hours')) AS INTEGER) - 1) / 3) = ?`;
    dateBindings = [yearStr, quarterZeroIdx];
  } else if (period === 'year') {
    dateClause = `strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ?`;
    dateBindings = [yearStr];
  }

  // 1. Tổng Thu & Chi
  const totalStats = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as total_expense
    FROM transactions t
    WHERE t.user_id = ? AND t.status = 'confirmed' AND t.deleted_at IS NULL AND t.history_hidden_at IS NULL AND ${dateClause}
  `).bind(userId, ...dateBindings).first<{ total_income: number; total_expense: number }>();

  // 2. Phân rã Chi tiêu theo Hũ (V2-13: Đầy đủ các hũ hoạt động + nhóm Chi chưa gắn hũ)
  const { results: jarsDb } = await db.prepare(`
    SELECT j.id, j.name, j.code, j.color, j.target_percent, j.monthly_limit,
           COALESCE(SUM(t.amount), 0) as spent,
           COUNT(t.id) as count
    FROM jars j
    LEFT JOIN transactions t ON t.jar_id = j.id AND t.type = 'expense' AND t.status = 'confirmed' AND t.deleted_at IS NULL AND t.history_hidden_at IS NULL AND ${dateClause}
    WHERE j.user_id = ? AND (j.is_active = 1 OR j.is_active IS NULL)
    GROUP BY j.id
    ORDER BY j.sort_order ASC
  `).bind(...dateBindings, userId).all<any>();

  const unassignedExpenseRow = await db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as spent, COUNT(t.id) as count
    FROM transactions t
    WHERE t.user_id = ? AND t.type = 'expense' AND t.status = 'confirmed' AND t.deleted_at IS NULL AND t.history_hidden_at IS NULL AND t.jar_id IS NULL AND ${dateClause}
  `).bind(userId, ...dateBindings).first<{ spent: number; count: number }>();

  const expenseBuckets: Array<{
    kind: 'assigned' | 'unassigned' | 'orphaned';
    jarId: string | null;
    jarCode?: string;
    jarName?: string;
    amountVnd: number;
    count: number;
  }> = (jarsDb || []).map((j: any) => ({
    kind: 'assigned' as const,
    jarId: j.id,
    jarCode: j.code,
    jarName: j.name,
    amountVnd: j.spent || 0,
    count: j.count || 0
  }));

  if (unassignedExpenseRow && (unassignedExpenseRow.spent > 0 || unassignedExpenseRow.count > 0)) {
    expenseBuckets.push({
      kind: 'unassigned',
      jarId: null,
      jarCode: 'UNASSIGNED',
      jarName: 'Chi chưa phân loại',
      amountVnd: unassignedExpenseRow.spent,
      count: unassignedExpenseRow.count
    });
  }

  // 3. Phân rã Thu nhập theo Nguồn thu (V2-12: Nguồn hoạt động + Thu ngoài dự kiến)
  const { results: sourcesDb } = await db.prepare(`
    SELECT s.id, s.name, s.color, s.expected_amount,
           COALESCE(SUM(t.amount), 0) as total_amount,
           COUNT(t.id) as count
    FROM income_sources s
    LEFT JOIN transactions t ON t.income_source_id = s.id AND t.type = 'income' AND t.status = 'confirmed' AND t.deleted_at IS NULL AND t.history_hidden_at IS NULL AND ${dateClause}
    WHERE s.user_id = ? AND (s.is_active = 1 OR s.is_active IS NULL)
    GROUP BY s.id
    ORDER BY s.created_at ASC
  `).bind(...dateBindings, userId).all<any>();

  const unassignedIncomeRow = await db.prepare(`
    SELECT COALESCE(SUM(t.amount), 0) as total_amount, COUNT(t.id) as count
    FROM transactions t
    WHERE t.user_id = ? AND t.type = 'income' AND t.status = 'confirmed' AND t.deleted_at IS NULL AND t.history_hidden_at IS NULL AND t.income_source_id IS NULL AND ${dateClause}
  `).bind(userId, ...dateBindings).first<{ total_amount: number; count: number }>();

  const incomeBuckets: Array<{
    kind: 'assigned' | 'unassigned' | 'orphaned';
    sourceId: string | null;
    sourceName?: string;
    amountVnd: number;
    count: number;
  }> = (sourcesDb || []).map((s: any) => ({
    kind: 'assigned' as const,
    sourceId: s.id,
    sourceName: s.name,
    amountVnd: s.total_amount || 0,
    count: s.count || 0
  }));

  if (unassignedIncomeRow && (unassignedIncomeRow.total_amount > 0 || unassignedIncomeRow.count > 0)) {
    incomeBuckets.push({
      kind: 'unassigned',
      sourceId: null,
      sourceName: 'Thu ngoài dự kiến / Khác',
      amountVnd: unassignedIncomeRow.total_amount,
      count: unassignedIncomeRow.count
    });
  }

  // 4. Lấy revision an toàn
  let dataRevision = 1;
  try {
    const dataRevRow = await db.prepare('SELECT COALESCE(MAX(revision), 1) as max_rev FROM transactions WHERE user_id = ?')
      .bind(userId).first<{ max_rev: number }>();
    dataRevision = dataRevRow?.max_rev || 1;
  } catch {}

  let planRevision = 1;
  try {
    const planRevRow = await db.prepare('SELECT COALESCE(MAX(revision), 1) as max_rev FROM plan_versions WHERE user_id = ?')
      .bind(userId).first<{ max_rev: number }>();
    planRevision = planRevRow?.max_rev || 1;
  } catch {}

  const totalIncomeVnd = totalStats?.total_income || 0;
  const totalExpenseVnd = totalStats?.total_expense || 0;

  return c.json({
    range: {
      mode: period,
      year: yearNum,
      month: monthNum,
      quarter: quarterNum
    },
    dataRevision,
    planRevision,
    totalIncomeVnd,
    totalExpenseVnd,
    incomeBuckets,
    expenseBuckets,
    complete: true,
    generatedAt: new Date().toISOString(),

    // Tương thích ngược với client cũ
    period,
    year: yearNum,
    month: monthNum,
    quarter: quarterNum,
    totalIncome: totalIncomeVnd,
    totalExpense: totalExpenseVnd,
    jarBreakdown: jarsDb || [],
    incomeBreakdown: (sourcesDb || []).map((s: any) => ({
      source_id: s.id,
      source_name: s.name,
      total_amount: s.total_amount
    }))
  });
});

// Thông tin hồ sơ người dùng
app.get('/api/user/profile', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  let user = await db.prepare('SELECT id, email, name, phone, avatar FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; email: string; name: string; phone: string | null; avatar: string | null }>();
  if (!user) {
    await db.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)')
      .bind(userId, 'duc@qltc.local', 'Anh Đức').run();
    user = { id: userId, email: 'duc@qltc.local', name: 'Anh Đức', phone: null, avatar: null };
  }
  return c.json({ user, profile: user });
});

// Cập nhật thông tin hồ sơ người dùng
app.put('/api/user/profile', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{ name?: string; email?: string; phone?: string; avatar?: string }>();
  
  const current = await db.prepare('SELECT id, email, name, phone, avatar FROM users WHERE id = ?')
    .bind(userId).first<{ id: string; email: string; name: string; phone: string | null; avatar: string | null }>();
  
  const newName = body.name !== undefined ? body.name.trim() : (current?.name || 'Anh Đức');
  const newEmail = body.email !== undefined ? body.email.trim() : (current?.email || 'duc@qltc.local');
  const newPhone = body.phone !== undefined ? body.phone.trim() : (current?.phone || null);
  const newAvatar = body.avatar !== undefined ? body.avatar : (current?.avatar || null);

  await db.prepare(`
    INSERT INTO users (id, name, email, phone, avatar)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      phone = excluded.phone,
      avatar = excluded.avatar
  `).bind(userId, newName, newEmail, newPhone, newAvatar).run();

  const updatedUser = {
    id: userId,
    name: newName,
    email: newEmail,
    phone: newPhone,
    avatar: newAvatar
  };

  return c.json({
    success: true,
    user: updatedUser,
    profile: updatedUser
  });
});

// Danh sách các hũ (Chuẩn múi giờ UTC+7)
app.get('/api/jars', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT j.*,
           COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.status = 'confirmed' AND strftime('%Y-%m', datetime(t.occurred_at, '+7 hours')) = strftime('%Y-%m', datetime('now', '+7 hours')) THEN t.amount ELSE 0 END), 0) as spent_this_month
    FROM jars j
    LEFT JOIN transactions t ON t.jar_id = j.id
    WHERE j.user_id = ?
    GROUP BY j.id
    ORDER BY j.sort_order ASC
  `).bind(userId).all();
  return c.json({ jars: results });
});

// Danh sách tài khoản
app.get('/api/accounts', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT * FROM accounts WHERE user_id = ? AND is_active = 1 ORDER BY type, name
  `).bind(userId).all<any>();

  const formatted = (results || []).map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    bankCode: a.bank_code,
    accountNumberMask: a.account_number_mask,
    accountNumber: a.account_number,
    accountHolder: a.account_holder,
    branch: a.branch,
    bankBin: a.bank_bin,
    balance: a.balance,
    isActive: a.is_active,
    bank_code: a.bank_code,
    account_number_mask: a.account_number_mask,
    account_number: a.account_number,
    account_holder: a.account_holder,
    bank_bin: a.bank_bin
  }));

  return c.json({ accounts: formatted });
});

// Thêm tài khoản mới (chấp nhận cả camelCase và snake_case, lưu đầy đủ thông tin ngân hàng & QR)
app.post('/api/accounts', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    id?: string;
    name: string;
    balance?: number;
    bank_code?: string;
    bankCode?: string;
    account_number_mask?: string;
    accountNumberMask?: string;
    account_number?: string;
    accountNumber?: string;
    account_holder?: string;
    accountHolder?: string;
    branch?: string;
    bank_bin?: string;
    bankBin?: string;
    type?: string;
  }>();

  const id = body.id || `acc_${Date.now()}`;
  const bankCode = body.bankCode ?? body.bank_code ?? null;
  const accountNumber = body.accountNumber ?? body.account_number ?? null;
  const accountHolder = (body.accountHolder ?? body.account_holder ?? '') ? (body.accountHolder ?? body.account_holder) : null;
  const branch = body.branch ?? null;
  const bankBin = body.bankBin ?? body.bank_bin ?? null;

  let mask = body.accountNumberMask ?? body.account_number_mask ?? null;
  if (!mask && accountNumber && accountNumber.length >= 4) {
    mask = accountNumber.slice(-4);
  }

  const bal = Math.round(body.balance || 0);

  await db.prepare(`
    INSERT INTO accounts (
      id, user_id, name, type, bank_code, account_number_mask, balance,
      account_number, account_holder, branch, bank_bin
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      bank_code = excluded.bank_code,
      account_number_mask = excluded.account_number_mask,
      balance = excluded.balance,
      account_number = excluded.account_number,
      account_holder = excluded.account_holder,
      branch = excluded.branch,
      bank_bin = excluded.bank_bin,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    userId,
    body.name,
    body.type || 'bank',
    bankCode,
    mask,
    bal,
    accountNumber,
    accountHolder,
    branch,
    bankBin
  ).run();

  return c.json({ success: true, id, message: 'Đã thêm tài khoản mới' });
});

// Chỉnh sửa tài khoản (Cập nhật số dư thực tế, tên, thông tin STK, chủ TK, chi nhánh... hỗ trợ camelCase & snake_case)
app.put('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  const body = await c.req.json<{
    name?: string;
    balance?: number;
    bank_code?: string;
    bankCode?: string;
    account_number_mask?: string;
    accountNumberMask?: string;
    account_number?: string;
    accountNumber?: string;
    account_holder?: string;
    accountHolder?: string;
    branch?: string;
    bank_bin?: string;
    bankBin?: string;
    type?: string;
  }>();

  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP', 'revision = revision + 1'];
  const params: any[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    params.push(body.name);
  }
  if (body.balance !== undefined) {
    updates.push('balance = ?');
    params.push(Math.round(body.balance));
  }
  const bankCode = body.bankCode !== undefined ? body.bankCode : body.bank_code;
  if (bankCode !== undefined) {
    updates.push('bank_code = ?');
    params.push(bankCode);
  }

  const accountNumber = body.accountNumber !== undefined ? body.accountNumber : body.account_number;
  if (accountNumber !== undefined) {
    updates.push('account_number = ?');
    params.push(accountNumber);
  }

  const accountHolder = body.accountHolder !== undefined ? body.accountHolder : body.account_holder;
  if (accountHolder !== undefined) {
    updates.push('account_holder = ?');
    params.push(accountHolder);
  }

  if (body.branch !== undefined) {
    updates.push('branch = ?');
    params.push(body.branch);
  }

  const bankBin = body.bankBin !== undefined ? body.bankBin : body.bank_bin;
  if (bankBin !== undefined) {
    updates.push('bank_bin = ?');
    params.push(bankBin);
  }

  let mask = body.accountNumberMask !== undefined ? body.accountNumberMask : body.account_number_mask;
  if (mask === undefined && accountNumber && accountNumber.length >= 4) {
    mask = accountNumber.slice(-4);
  }
  if (mask !== undefined) {
    updates.push('account_number_mask = ?');
    params.push(mask);
  }

  if (body.type !== undefined) {
    updates.push('type = ?');
    params.push(body.type);
  }

  params.push(id);
  params.push(userId);

  await db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  return c.json({ success: true, message: 'Đã cập nhật tài khoản' });
});

// Xóa hoặc Lưu trữ tài khoản (Tuân thủ đặc tả V2-11: Giữ toàn vẹn lịch sử, không tạo giao dịch mồ côi)
app.delete('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  // Kiểm tra xem tài khoản này đã phát sinh giao dịch nào chưa
  const txnCheck = await db.prepare(
    'SELECT COUNT(*) as count FROM transactions WHERE (account_id = ? OR to_account_id = ?) AND user_id = ?'
  ).bind(id, id, userId).first<{ count: number }>();

  if (txnCheck && txnCheck.count > 0) {
    // Đã có lịch sử giao dịch -> Chuyển sang lưu trữ (Archive) để bảo toàn báo cáo và đối soát
    await db.prepare(
      'UPDATE accounts SET is_active = 0, archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?'
    ).bind(id, userId).run();
    return c.json({
      success: true,
      archived: true,
      message: 'Tài khoản đã có lịch sử giao dịch nên được lưu trữ an toàn để bảo toàn báo cáo'
    });
  }

  // Chưa có giao dịch nào -> Cho phép xóa an toàn
  await db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true, archived: false, message: 'Đã xóa tài khoản' });
});

// Tạo hũ chi tiêu mới (L-13: Tự động sinh mã code duy nhất không trùng, hỗ trợ cả camelCase & snake_case)
app.post('/api/jars', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    id?: string;
    code?: string;
    name: string;
    targetPercent?: number;
    target_percent?: number;
    monthlyLimit?: number;
    monthly_limit?: number;
    color?: string;
    isDefault?: boolean;
    is_default?: boolean;
  }>();

  const jarId = body.id || `jar_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  
  // Lấy các mã hũ hiện có của user để chống trùng lặp tuyệt đối
  const { results: existingJars } = await db.prepare('SELECT code FROM jars WHERE user_id = ?').bind(userId).all<{ code: string }>();
  const existingCodes = (existingJars || []).map(j => j.code);
  const existingSet = new Set(existingCodes.map(c => (c || '').toUpperCase()));
  const code = (body.code && !existingSet.has(body.code.toUpperCase()))
    ? body.code.toUpperCase()
    : generateUniqueCodeFromName(body.name, existingCodes);
  const color = body.color || '#657D81';
  const targetPct = body.targetPercent ?? body.target_percent ?? 0.1;
  const monthlyLimit = Math.round(body.monthlyLimit ?? body.monthly_limit ?? 0);
  const isDefault = body.isDefault ?? body.is_default ?? false;

  // Lấy số thứ tự lớn nhất
  const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM jars WHERE user_id = ?').bind(userId).first<{ m: number }>();
  const sortOrder = (maxOrder?.m || 0) + 1;

  if (isDefault) {
    await db.prepare('UPDATE jars SET is_default = 0 WHERE user_id = ?').bind(userId).run();
  }

  await db.prepare(`
    INSERT INTO jars (id, user_id, code, name, target_percent, monthly_limit, color, sort_order, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      target_percent = excluded.target_percent,
      monthly_limit = excluded.monthly_limit,
      color = excluded.color,
      is_default = excluded.is_default
  `).bind(jarId, userId, code, body.name, targetPct, monthlyLimit, color, sortOrder, isDefault ? 1 : 0).run();

  return c.json({ success: true, jarId, code, message: 'Đã tạo hũ chi tiêu mới thành công' });
});

// Tự động phân bổ hạn mức các hũ theo % từ Tổng Thu Dự Kiến
app.post('/api/jars/auto-allocate', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{ totalIncome: number }>();
  const totalIncome = Math.max(0, Math.round(body.totalIncome || 0));

  const { results: jars } = await db.prepare('SELECT id, target_percent FROM jars WHERE user_id = ?')
    .bind(userId).all<{ id: string; target_percent: number }>();

  for (const j of (jars || [])) {
    const newLimit = Math.round(totalIncome * (j.target_percent || 0));
    await db.prepare('UPDATE jars SET monthly_limit = ? WHERE id = ? AND user_id = ?')
      .bind(newLimit, j.id, userId).run();
  }

  return c.json({ success: true, message: 'Đã phân bổ hạn mức các hũ theo % thu nhập dự kiến' });
});

// Cập nhật thông tin hũ chi tiêu (hạn mức, tỷ lệ %, tên, màu, hũ mặc định - hỗ trợ camelCase & snake_case)
app.put('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  const body = await c.req.json<{
    monthly_limit?: number;
    monthlyLimit?: number;
    target_percent?: number;
    targetPercent?: number;
    name?: string;
    color?: string;
    code?: string;
    isDefault?: boolean;
    is_default?: boolean;
  }>();

  const updates: string[] = [];
  const bindings: any[] = [];

  const monthlyLimit = body.monthlyLimit !== undefined ? body.monthlyLimit : body.monthly_limit;
  if (monthlyLimit !== undefined) {
    updates.push('monthly_limit = ?');
    bindings.push(Math.round(monthlyLimit));
  }
  const targetPercent = body.targetPercent !== undefined ? body.targetPercent : body.target_percent;
  if (targetPercent !== undefined) {
    updates.push('target_percent = ?');
    bindings.push(targetPercent);
  }
  if (body.name !== undefined) {
    updates.push('name = ?');
    bindings.push(body.name);
  }
  if (body.color !== undefined) {
    updates.push('color = ?');
    bindings.push(body.color);
  }
  if (body.code !== undefined) {
    updates.push('code = ?');
    bindings.push(body.code.toUpperCase());
  }
  const isDefault = body.isDefault !== undefined ? body.isDefault : body.is_default;
  if (isDefault !== undefined) {
    if (isDefault) {
      await db.prepare('UPDATE jars SET is_default = 0 WHERE user_id = ?').bind(userId).run();
    }
    updates.push('is_default = ?');
    bindings.push(isDefault ? 1 : 0);
  }

  if (updates.length > 0) {
    bindings.push(id, userId);
    await db.prepare(`UPDATE jars SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
      .bind(...bindings).run();
  }

  return c.json({ success: true, message: 'Đã cập nhật hũ chi tiêu thành công' });
});

// Xóa 1 hũ chi tiêu
// Xóa hoặc Lưu trữ Hũ chi tiêu (V2-11: Ưu tiên archive nếu đã có giao dịch)
app.delete('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  const txnCheck = await db.prepare(
    'SELECT COUNT(*) as count FROM transactions WHERE jar_id = ? AND user_id = ?'
  ).bind(id, userId).first<{ count: number }>();

  if (txnCheck && txnCheck.count > 0) {
    // Có giao dịch -> Đánh dấu rollover = 0 và không hiện ở danh sách tạo mới
    await db.prepare('UPDATE jars SET rollover = 0 WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return c.json({ success: true, archived: true, message: 'Đã lưu trữ hũ chi tiêu để bảo toàn lịch sử' });
  }

  await db.prepare('DELETE FROM jars WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true, archived: false, message: 'Đã xóa hũ thành công' });
});

// Khởi tạo bảng mở rộng cho Kế hoạch Thu/Chi dự kiến
async function ensurePlanningTables(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS income_sources (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'fixed',
      recurrence TEXT DEFAULT 'Hàng tháng',
      expected_amount INTEGER DEFAULT 0,
      color TEXT DEFAULT '#8CC7AE',
      keywords TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  try {
    await db.prepare('ALTER TABLE income_sources ADD COLUMN keywords TEXT').run();
  } catch {}

  // ĐẶC TẢ V2-09: Bỏ seed tự động. Trạng thái không có nguồn thu là hoàn toàn hợp lệ, không tự seed lại sau reset!

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS planned_expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      jar_code TEXT NOT NULL DEFAULT 'NEC',
      expected_amount INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT DEFAULT 'Hàng tháng',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

// Danh sách Nguồn thu
app.get('/api/income-sources', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const { results } = await db.prepare('SELECT id, name, kind, expected_amount as expectedAmount, recurrence, color, keywords FROM income_sources WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC')
    .bind(userId).all();
  return c.json({ incomeSources: results || [] });
});

app.post('/api/income-sources', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    id?: string;
    name: string;
    kind?: string;
    expectedAmount?: number;
    expected_amount?: number;
    recurrence?: string;
    color?: string;
    keywords?: string;
  }>();
  const id = body.id || `inc_${Date.now()}`;
  const amt = Math.round(body.expectedAmount ?? body.expected_amount ?? 0);
  await db.prepare(`
    INSERT INTO income_sources (id, user_id, name, kind, expected_amount, recurrence, color, keywords, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      expected_amount = excluded.expected_amount,
      recurrence = excluded.recurrence,
      color = excluded.color,
      keywords = excluded.keywords
  `).bind(id, userId, body.name, body.kind || 'fixed', amt, body.recurrence || 'Hàng tháng', body.color || '#8CC7AE', body.keywords || null).run();
  return c.json({ success: true, id });
});

app.put('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    name?: string;
    kind?: string;
    expectedAmount?: number;
    expected_amount?: number;
    recurrence?: string;
    color?: string;
    keywords?: string;
  }>();

  const updates: string[] = [];
  const params: any[] = [];
  if (body.name !== undefined) {
    updates.push('name = ?');
    params.push(body.name);
  }
  if (body.kind !== undefined) {
    updates.push('kind = ?');
    params.push(body.kind);
  }
  const amt = body.expectedAmount !== undefined ? body.expectedAmount : body.expected_amount;
  if (amt !== undefined) {
    updates.push('expected_amount = ?');
    params.push(Math.round(amt));
  }
  if (body.recurrence !== undefined) {
    updates.push('recurrence = ?');
    params.push(body.recurrence);
  }
  if (body.color !== undefined) {
    updates.push('color = ?');
    params.push(body.color);
  }
  if (body.keywords !== undefined) {
    updates.push('keywords = ?');
    params.push(body.keywords || null);
  }

  if (updates.length > 0) {
    params.push(id, userId);
    await db.prepare(`UPDATE income_sources SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  }
  return c.json({ success: true, id });
});

// Xóa hoặc Lưu trữ Nguồn thu (V2-11: Ưu tiên archive để bảo toàn báo cáo nguồn thu thực tế)
app.delete('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);

  const txnCheck = await db.prepare(
    'SELECT COUNT(*) as count FROM transactions WHERE income_source_id = ? AND user_id = ?'
  ).bind(id, userId).first<{ count: number }>();

  if (txnCheck && txnCheck.count > 0) {
    // Đã có giao dịch -> Soft archive (is_active = 0) để giữ lịch sử giao dịch
    await db.prepare('UPDATE income_sources SET is_active = 0 WHERE id = ? AND user_id = ?').bind(id, userId).run();
    return c.json({ success: true, archived: true, message: 'Đã lưu trữ nguồn thu' });
  }

  await db.prepare('DELETE FROM income_sources WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true, archived: false, message: 'Đã xóa nguồn thu' });
});

// Danh sách Khoản chi dự kiến
app.get('/api/planned-expenses', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const { results } = await db.prepare('SELECT * FROM planned_expenses WHERE user_id = ? ORDER BY created_at ASC')
    .bind(userId).all();
  return c.json({ plannedExpenses: results });
});

app.post('/api/planned-expenses', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    id?: string;
    name: string;
    jarCode?: string;
    jar_code?: string;
    expectedAmount?: number;
    expected_amount?: number;
    recurrence?: string;
    note?: string;
  }>();
  const id = body.id || `pexp_${Date.now()}`;
  const jarCode = body.jarCode ?? body.jar_code ?? 'NEC';
  const amt = Math.round(body.expectedAmount ?? body.expected_amount ?? 0);
  await db.prepare(`
    INSERT INTO planned_expenses (id, user_id, name, jar_code, expected_amount, recurrence, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      jar_code = excluded.jar_code,
      expected_amount = excluded.expected_amount,
      recurrence = excluded.recurrence,
      note = excluded.note
  `).bind(id, userId, body.name, jarCode, amt, body.recurrence || 'Hàng tháng', body.note || null).run();
  return c.json({ success: true, id });
});

app.put('/api/planned-expenses/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    name?: string;
    jarCode?: string;
    jar_code?: string;
    expectedAmount?: number;
    expected_amount?: number;
    recurrence?: string;
    note?: string;
  }>();

  const updates: string[] = [];
  const params: any[] = [];
  if (body.name !== undefined) {
    updates.push('name = ?');
    params.push(body.name);
  }
  const jarCode = body.jarCode !== undefined ? body.jarCode : body.jar_code;
  if (jarCode !== undefined) {
    updates.push('jar_code = ?');
    params.push(jarCode);
  }
  const amt = body.expectedAmount !== undefined ? body.expectedAmount : body.expected_amount;
  if (amt !== undefined) {
    updates.push('expected_amount = ?');
    params.push(Math.round(amt));
  }
  if (body.recurrence !== undefined) {
    updates.push('recurrence = ?');
    params.push(body.recurrence);
  }
  if (body.note !== undefined) {
    updates.push('note = ?');
    params.push(body.note);
  }

  if (updates.length > 0) {
    params.push(id, userId);
    await db.prepare(`UPDATE planned_expenses SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  }
  return c.json({ success: true, id });
});

app.delete('/api/planned-expenses/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);
  await db.prepare('DELETE FROM planned_expenses WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true });
});

// Lấy danh sách Quỹ mở trực tiếp từ Fmarket API
async function fetchFmarketFundsList(): Promise<Array<{ shortName: string; name: string; nav: number; updatedAt?: number }>> {
  try {
    const res = await fetch('https://api.fmarket.vn/res/products/filter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0'
      },
      body: JSON.stringify({
        types: ['NEW_FUND', 'TRADING_FUND'],
        issuerIds: [],
        sortOrder: 'DESC',
        sortField: 'annualizedReturn36Months',
        page: 1,
        pageSize: 100,
        isIpo: false,
        fundAssetTypes: [],
        bondRemainPeriods: [],
        searchField: '',
        isBuyByReward: false,
        thirdAppIds: []
      })
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const rows = json?.data?.rows || [];
    return rows.map((r: any) => ({
      shortName: String(r.shortName || '').toUpperCase(),
      name: r.name || r.shortName,
      nav: Number(r.nav) || 0,
      updatedAt: r.productNavChange?.updateAt
    }));
  } catch (e) {
    console.error('Fmarket fetch error:', e);
    return [];
  }
}

// Đồng bộ giá tài sản tự động theo ngày (Fmarket NAV + Vàng + Bạc + Crypto)
async function syncAllMarketPrices(db: D1Database) {
  const fmarketFunds = await fetchFmarketFundsList();
  const fundMap = new Map<string, { name: string; nav: number }>();
  for (const f of fmarketFunds) {
    if (f.shortName && f.nav > 0) {
      fundMap.set(f.shortName.toUpperCase(), { name: f.name, nav: f.nav });
    }
  }

  // Lấy giá Vàng, Bạc, Crypto từ CoinGecko
  let goldPerChi = 0;
  let silverPerLuong = 0;
  let btcVnd = 0;
  let ethVnd = 0;
  try {
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,pax-gold,kinesis-silver&vs_currencies=vnd',
      { headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    if (cgRes.ok) {
      const cg: any = await cgRes.json();
      if (cg['pax-gold']?.vnd) {
        // 1 troy oz = 8.29426 chỉ
        goldPerChi = Math.round(cg['pax-gold'].vnd / 8.29426);
      }
      if (cg['kinesis-silver']?.vnd) {
        // 1 troy oz = 0.829426 lượng
        silverPerLuong = Math.round(cg['kinesis-silver'].vnd / 0.829426);
      }
      if (cg['bitcoin']?.vnd) btcVnd = Math.round(cg['bitcoin'].vnd);
      if (cg['ethereum']?.vnd) ethVnd = Math.round(cg['ethereum'].vnd);
    }
  } catch (e) {
    console.error('CoinGecko error:', e);
  }

  const { results: assets } = await db.prepare('SELECT id, name, symbol, asset_class, current_price, source, auto_sync FROM assets').all<{
    id: string;
    name?: string | null;
    symbol: string;
    asset_class: string;
    current_price: number;
    source: string | null;
    auto_sync: number | null;
  }>();

  let updatedCount = 0;
  for (const ast of assets) {
    // L-10: Bỏ qua nếu tài sản đã tắt autoSync (bảo vệ giá Vàng SJC/Đất do người dùng tự nhập)
    if (ast.auto_sync === 0) continue;

    const sym = ast.symbol.toUpperCase();
    let newPrice: number | null = null;

    // 1. Nếu là quỹ trên Fmarket (hoặc trùng mã quỹ Fmarket)
    if (fundMap.has(sym)) {
      newPrice = fundMap.get(sym)!.nav;
    } else if (ast.asset_class === 'crypto') {
      if (sym === 'BTC' && btcVnd > 0) newPrice = btcVnd;
      if (sym === 'ETH' && ethVnd > 0) newPrice = ethVnd;
    } else if (ast.asset_class === 'gold' && goldPerChi > 0) {
      // V2-18: TUYỆT ĐỐI KHÔNG dùng giá PAXG để ghi đè Vàng miếng SJC trong nước!
      const isSjc = sym === 'SJC' || sym.includes('SJC') || (ast.name || '').toUpperCase().includes('SJC');
      if (!isSjc) {
        const unit = (ast.source || 'chỉ').toLowerCase();
        if (unit.includes('lượng') || unit.includes('cây')) {
          newPrice = goldPerChi * 10;
        } else if (unit.includes('gram') || unit.includes('g')) {
          // 1 chỉ = 3.75 gram -> 1 gram = 1 chỉ / 3.75
          newPrice = Math.round(goldPerChi / 3.75);
        } else {
          newPrice = goldPerChi;
        }
      }
    } else if (ast.asset_class === 'silver' && silverPerLuong > 0) {
      const unit = (ast.source || 'lượng').toLowerCase();
      if (unit.includes('chỉ')) {
        newPrice = Math.round(silverPerLuong / 10);
      } else if (unit.includes('kg')) {
        newPrice = Math.round(silverPerLuong * 26.666);
      } else if (unit.includes('gram') || unit.includes('g')) {
        // 1 lượng = 37.5 gram -> 1 gram = 1 lượng / 37.5
        newPrice = Math.round(silverPerLuong / 37.5);
      } else {
        newPrice = silverPerLuong;
      }
    }

    if (newPrice !== null && newPrice > 0) {
      await db.prepare('UPDATE assets SET current_price = ?, price_updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(newPrice, ast.id).run();
      updatedCount++;
    }
  }

  return {
    updatedCount,
    fmarketCount: fmarketFunds.length,
    goldPerChi,
    silverPerLuong,
    btcVnd
  };
}

// API lấy danh sách quỹ Fmarket trực tiếp
app.get('/api/market/fmarket-funds', async (c) => {
  const funds = await fetchFmarketFundsList();
  return c.json({ funds });
});

// API đồng bộ giá thị trường & Fmarket ngay lập tức (kèm danh sách holdings mới nhất)
app.post('/api/market/sync-prices', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const syncResult = await syncAllMarketPrices(db);
  const { results: holdings } = await db.prepare(`
    SELECT h.id, h.quantity, h.avg_cost, h.auto_sync, a.id as asset_id, a.symbol, a.name, a.asset_class, a.current_price, a.source as unit, a.price_updated_at
    FROM holdings h
    JOIN assets a ON h.asset_id = a.id
    WHERE h.user_id = ?
  `).bind(userId).all();

  return c.json({
    success: true,
    ...syncResult,
    holdings: holdings || [],
    message: `Đã cập nhật giá mới nhất cho ${syncResult.updatedCount} tài sản từ Fmarket & Thị trường`
  });
});

// Danh sách tài sản đầu tư
app.get('/api/holdings', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT h.id, h.quantity, h.avg_cost, h.auto_sync, a.id as asset_id, a.symbol, a.name, a.asset_class, a.current_price, a.source as unit, a.price_updated_at
    FROM holdings h
    JOIN assets a ON h.asset_id = a.id
    WHERE h.user_id = ?
  `).bind(userId).all();
  return c.json({ holdings: results });
});

// Lưu / cập nhật tài sản đầu tư (Quỹ Fmarket, Cổ phiếu, Vàng, Bạc, Đất, Crypto)
app.post('/api/holdings', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    symbol: string;
    name: string;
    assetClass: 'stock' | 'fund' | 'crypto' | 'gold' | 'silver' | 'land';
    quantity: number;
    avgCost: number;
    currentPrice: number;
    unit?: string;
    autoSync?: boolean;
  }>();

  const cleanSymbol = body.symbol.trim().toUpperCase();
  const assetId = `ast_${cleanSymbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const defaultUnit = body.unit || (
    body.assetClass === 'fund' ? 'CCQ' :
    body.assetClass === 'stock' ? 'CP' :
    body.assetClass === 'gold' ? 'chỉ' :
    body.assetClass === 'silver' ? 'lượng' :
    body.assetClass === 'land' ? 'm²' : 'Coin'
  );
  const autoSyncVal = body.autoSync === false ? 0 : 1;

  await db.prepare(`
    INSERT INTO assets (id, symbol, name, asset_class, current_price, source, auto_sync, price_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET
      current_price = excluded.current_price,
      name = excluded.name,
      asset_class = excluded.asset_class,
      source = excluded.source,
      auto_sync = excluded.auto_sync,
      price_updated_at = CURRENT_TIMESTAMP
  `).bind(assetId, cleanSymbol, body.name, body.assetClass, body.currentPrice, defaultUnit, autoSyncVal).run();

  const existingAsset = await db.prepare('SELECT id FROM assets WHERE symbol = ?').bind(cleanSymbol).first<{ id: string }>();
  const finalAssetId = existingAsset?.id || assetId;
  const holdingId = `hld_${finalAssetId}`;

  await db.prepare(`
    INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost, auto_sync, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      quantity = excluded.quantity,
      avg_cost = excluded.avg_cost,
      auto_sync = excluded.auto_sync,
      updated_at = CURRENT_TIMESTAMP
  `).bind(holdingId, userId, finalAssetId, body.quantity, body.avgCost, autoSyncVal).run();

  return c.json({ success: true, holdingId, message: 'Đã lưu tài sản thành công' });
});

// Xóa 1 tài sản đầu tư (theo holding id hoặc symbol)
app.delete('/api/holdings/:id', async (c) => {
  const db = c.env.DB;
  const idOrSymbol = c.req.param('id');
  const userId = 'user_default';

  await db.prepare('DELETE FROM holdings WHERE (id = ? OR asset_id = ?) AND user_id = ?')
    .bind(idOrSymbol, `ast_${idOrSymbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`, userId).run();

  const asset = await db.prepare('SELECT id FROM assets WHERE symbol = ?').bind(idOrSymbol.toUpperCase()).first<{ id: string }>();
  if (asset) {
    await db.prepare('DELETE FROM holdings WHERE asset_id = ? AND user_id = ?').bind(asset.id, userId).run();
  }

  return c.json({ success: true, message: 'Đã xóa tài sản' });
});

// RESET & KHỞI TẠO TÀI CHÍNH (Tuân thủ đặc tả V2-09: Tường minh theo scope, không ảnh hưởng chéo)
app.post('/api/reset', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'planned_expenses' | 'all';
    clearNotifications?: boolean;
    mode?: 'hide_history' | 'hard_delete';
  }>();

  if (body.scope === 'transactions' || body.scope === 'all') {
    if (body.mode === 'hard_delete' || body.scope === 'all') {
      await db.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId).run();
    } else {
      // Mặc định: Ẩn lịch sử nhưng bảo toàn số dư (history_hidden_at)
      await db.prepare('UPDATE transactions SET history_hidden_at = CURRENT_TIMESTAMP WHERE user_id = ? AND history_hidden_at IS NULL').bind(userId).run();
    }

    if (body.clearNotifications || body.scope === 'all') {
      await db.prepare('DELETE FROM raw_notifications WHERE user_id = ?').bind(userId).run();
    }
  }

  if (body.scope === 'balances' || body.scope === 'all') {
    // Cập nhật số dư về 0 và tăng revision
    await db.prepare('UPDATE accounts SET balance = 0, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').bind(userId).run();
    // Ghi nhận audit adjustment vào ledger_postings
    const { results: accs } = await db.prepare('SELECT id, balance FROM accounts WHERE user_id = ?').bind(userId).all<{ id: string; balance: number }>();
    if (accs && accs.length > 0) {
      for (const a of accs) {
        await db.prepare(
          `INSERT INTO ledger_postings (id, user_id, operation_id, account_id, delta_vnd) VALUES (?, ?, ?, ?, ?)`
        ).bind(`post_adj_${Date.now()}_${a.id}`, userId, `reset_balance_${Date.now()}`, a.id, -a.balance).run();
      }
    }
  }

  if (body.scope === 'holdings' || body.scope === 'all') {
    // V2-09: Chỉ xóa danh mục sở hữu holdings thuộc user, KHÔNG xóa bảng assets chung
    await db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(userId).run();
  }

  if (body.scope === 'income' || body.scope === 'all') {
    // V2-09: Chỉ xóa nguồn thu, TUYỆT ĐỐI KHÔNG tự ý reset monthly_limit của các hũ chi tiêu!
    await db.prepare('DELETE FROM income_sources WHERE user_id = ?').bind(userId).run();
  }

  if (body.scope === 'planned_expenses' || body.scope === 'all') {
    await db.prepare('DELETE FROM planned_expenses WHERE user_id = ?').bind(userId).run();
  }

  return c.json({
    success: true,
    message: 'Đã thiết lập lại dữ liệu thành công',
    scope: body.scope
  });
});

// Tải trực tiếp file APK có hỗ trợ CORS và báo Content-Length cho thanh tiến trình %
app.get('/api/download-apk', async (c) => {
  const apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.3.0/qltc-v1.3.0.apk';
  const response = await fetch(apkUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'QLTC-Updater/1.3.0'
    }
  });

  if (!response.ok) {
    return c.text('Không thể tải file APK từ GitHub', 502);
  }

  const contentLength = response.headers.get('content-length') || '5634252';

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="qltc-v1.3.0.apk"',
      'Content-Length': contentLength,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
      'Cache-Control': 'public, max-age=3600'
    }
  });
});

// Thông tin phiên bản & link cập nhật (v1.3.0 V2 Core)
app.get('/api/version', (c) => {
  return c.json({
    version: '1.3.0',
    versionCode: 21,
    latestApkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.3.0/qltc-v1.3.0.apk',
    directDownloadUrl: 'https://qltc-backend.dtd-store.workers.dev/api/download-apk',
    releasePageUrl: 'https://github.com/DUCDT3006/qltc/releases/latest',
    otaUpdated: true,
    message: 'Nâng cấp toàn diện kiến trúc V2: Sổ cái delta bất biến, chống lặp idempotency, bảo vệ vàng SJC, phân bổ VND chính xác.'
  });
});

export default {
  fetch: app.fetch,
  // Cron Trigger chạy tự động hàng ngày để cập nhật giá Quỹ Fmarket, Vàng, Bạc, Crypto
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log('Chạy Cron cập nhật giá Fmarket & thị trường tự động...');
    await syncAllMarketPrices(env.DB);
  }
};
