import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { parseBankNotification } from './services/parser';
import { categorizeTransaction } from './services/rules';
import { generateDedupeHash } from './services/dedupe';

export interface Env {
  DB: D1Database;
  KV: KVNamespace;
}

const app = new Hono<{ Bindings: Env }>();

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
        color TEXT DEFAULT '#657D81',
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

    const cols = [
      { t: 'users', c: 'phone', type: 'TEXT' },
      { t: 'users', c: 'avatar', type: 'TEXT' },
      { t: 'transactions', c: 'to_account_id', type: 'TEXT' },
      { t: 'transactions', c: 'balance_after', type: 'INTEGER' },
      { t: 'transactions', c: 'original_type', type: 'TEXT' },
      { t: 'transactions', c: 'income_source_id', type: 'TEXT' },
      { t: 'jars', c: 'is_default', type: 'INTEGER DEFAULT 0' },
      { t: 'holdings', c: 'auto_sync', type: 'INTEGER DEFAULT 1' },
      { t: 'assets', c: 'auto_sync', type: 'INTEGER DEFAULT 1' },
      { t: 'income_sources', c: 'color', type: "TEXT DEFAULT '#657D81'" },
      { t: 'income_sources', c: 'recurrence', type: "TEXT DEFAULT 'Hàng tháng'" },
      { t: 'planned_expenses', c: 'recurrence', type: "TEXT DEFAULT 'Hàng tháng'" },
      { t: 'planned_expenses', c: 'note', type: 'TEXT' },
      { t: 'rules', c: 'category_name', type: "TEXT DEFAULT 'Chi tiêu'" },
      { t: 'rules', c: 'jar_code', type: "TEXT DEFAULT 'NEC'" },
      { t: 'rules', c: 'jar_id', type: 'TEXT' },
      { t: 'rules', c: 'created_at', type: 'DATETIME' }
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
  return c.json({ status: 'ok', service: 'QLTC Backend', version: '1.2.3', time: new Date().toISOString() });
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

  // 6. Tạo giao dịch ở trạng thái "Chờ duyệt" (pending) kèm balance_after và original_type
  const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, type, amount, occurred_at, description,
      jar_id, dedupe_hash, status, raw_notification_id, balance_after, original_type, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).bind(
    txnId,
    userId,
    accountId,
    parsed.type,
    parsed.amount,
    parsed.occurredAt,
    parsed.description,
    jarId,
    dedupeHash,
    notifId,
    parsed.balanceAfter || null,
    parsed.type,
    cat.categoryName
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
        const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
          .bind(userId, cat.jarCode).first<{ id: string }>();
        const jarId = jar ? jar.id : 'jar_nec';

        const txnId = `txn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        await db.prepare(`
          INSERT INTO transactions (
            id, user_id, account_id, type, amount, occurred_at, description,
            jar_id, dedupe_hash, status, raw_notification_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).bind(
          txnId,
          userId,
          accountId,
          parsed.type,
          parsed.amount,
          parsed.occurredAt,
          parsed.description,
          jarId,
          dedupeHash,
          notif.id
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

// Lấy danh sách giao dịch
app.get('/api/transactions', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status'); // 'pending' | 'confirmed'
  const limit = parseInt(c.req.query('limit') || '500', 10);
  const userId = 'user_default';

  let query = `
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
    WHERE t.user_id = ?
      AND t.status != 'paired_hidden'
      AND NOT (t.transfer_pair_id IS NOT NULL AND t.original_type = 'income' AND t.to_account_id IS NOT NULL AND p.original_type = 'expense')
  `;
  const params: any[] = [userId];

  if (status) {
    query += ' AND t.status = ?';
    params.push(status);
  }

  query += ' ORDER BY t.occurred_at DESC LIMIT ?';
  params.push(limit);

  const { results } = await db.prepare(query).bind(...params).all();
  return c.json({ transactions: results });
});

// Duyệt / Sửa / Bỏ qua / Hoàn tác giao dịch (Swipe approve, Undo & Ledger consistency)
app.put('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
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
  }>();

  // 1. Đọc thông tin giao dịch hiện tại
  const currentTxn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!currentTxn) {
    return c.json({ success: false, message: 'Không tìm thấy giao dịch' }, 404);
  }

  const updates: string[] = [];
  const params: any[] = [];
  const finalAmount = body.amount !== undefined ? Math.round(body.amount) : currentTxn.amount;

  // L-01: Cập nhật Sổ cái Số dư (Account Ledger) chuẩn Delta hai chiều (hỗ trợ cả Duyệt và Hoàn tác Undo)
  if (body.status === 'confirmed' && currentTxn.status !== 'confirmed') {
    if (currentTxn.type === 'income') {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(finalAmount, currentTxn.account_id, userId).run();
    } else if (currentTxn.type === 'expense') {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(finalAmount, currentTxn.account_id, userId).run();
    } else if (currentTxn.type === 'transfer') {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(finalAmount, currentTxn.account_id, userId).run();
      if (currentTxn.to_account_id) {
        await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
          .bind(finalAmount, currentTxn.to_account_id, userId).run();
      }
    }
  } else if (currentTxn.status === 'confirmed' && (body.status === 'pending' || body.status === 'rejected')) {
    // Hoàn tác (Undo) từ confirmed về pending / rejected -> đảo ngược sổ cái
    if (currentTxn.type === 'income') {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(currentTxn.amount, currentTxn.account_id, userId).run();
    } else if (currentTxn.type === 'expense') {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(currentTxn.amount, currentTxn.account_id, userId).run();
    } else if (currentTxn.type === 'transfer') {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(currentTxn.amount, currentTxn.account_id, userId).run();
      if (currentTxn.to_account_id) {
        await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
          .bind(currentTxn.amount, currentTxn.to_account_id, userId).run();
      }
    }
  }

  // Cập nhật trạng thái (giữ chân phụ ở trạng thái paired_hidden để không nhân đôi dòng giao dịch)
  if (body.status) {
    updates.push('status = ?');
    params.push(body.status);

    if (currentTxn.transfer_pair_id) {
      const secondaryStatus = body.status === 'rejected' ? 'rejected' : 'paired_hidden';
      await db.prepare('UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE transfer_pair_id = ? AND id != ? AND user_id = ?')
        .bind(secondaryStatus, currentTxn.transfer_pair_id, id, userId).run();
    }
  }

  // L-13: Ưu tiên jarId chính xác tuyệt đối
  let resolvedJarId: string | null = null;
  let resolvedJarCode: string | null = body.jarCode || null;
  if (body.jarId) {
    updates.push('jar_id = ?');
    params.push(body.jarId);
    resolvedJarId = body.jarId;
    if (!resolvedJarCode) {
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

  // L-08: Gắn incomeSourceId (cho phép gán NULL nếu chọn "Thu nhập khác")
  if (body.incomeSourceId !== undefined) {
    updates.push('income_source_id = ?');
    params.push(body.incomeSourceId || null);
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

  // L-09: Tự học quy tắc phân loại hũ của người dùng (bọc try/catch an toàn & khử trùng pattern cũ)
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

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  params.push(userId);

  await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Đã cập nhật giao dịch' });
});

// Thêm giao dịch thủ công từ QuickAddModal (L-02: Hỗ trợ toAccountId cho chuyển tiền)
app.post('/api/transactions', async (c) => {
  const db = c.env.DB;
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
  }>();

  const txnId = body.id || `txn_man_${Date.now()}`;
  const cleanAmount = Math.round(body.amount || 0);
  let jarId = body.jarId || null;
  if (!jarId && body.jarCode && body.type === 'expense') {
    const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
      .bind(userId, body.jarCode).first<{ id: string }>();
    jarId = jar?.id || null;
  }

  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, to_account_id, type, amount, occurred_at, description,
      jar_id, income_source_id, status, notes, original_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
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
    body.type === 'income' ? (body.incomeSourceId || null) : null,
    body.categoryName || null,
    body.type === 'transfer' ? 'expense' : body.type
  ).run();

  // Cập nhật số dư sổ cái chính xác
  if (body.type === 'transfer' && body.accountId && body.toAccountId) {
    await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(cleanAmount, body.accountId, userId).run();
    await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(cleanAmount, body.toAccountId, userId).run();
  } else if (body.accountId) {
    const delta = body.type === 'income' ? cleanAmount : body.type === 'expense' ? -cleanAmount : 0;
    if (delta !== 0) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(delta, body.accountId, userId).run();
    }
  }

  return c.json({ success: true, id: txnId });
});

// Xóa giao dịch (L-01: Hoàn tác số dư tài khoản nếu giao dịch đã duyệt)
app.delete('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (txn && txn.status === 'confirmed') {
    if (txn.type === 'income') {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(txn.amount, txn.account_id, userId).run();
    } else if (txn.type === 'expense') {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(txn.amount, txn.account_id, userId).run();
    } else if (txn.type === 'transfer' && txn.to_account_id) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(txn.amount, txn.account_id, userId).run();
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(txn.amount, txn.to_account_id, userId).run();
    }
  }

  if (txn?.transfer_pair_id) {
    await db.prepare('DELETE FROM transactions WHERE transfer_pair_id = ? AND user_id = ?')
      .bind(txn.transfer_pair_id, userId).run();
  } else {
    await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  }
  return c.json({ success: true });
});

// Tách 2 giao dịch nếu auto-pairing bị nhầm (Unpair - L-07: Khôi phục cả 2 chân về pending độc lập & hoàn tác sổ cái nếu đã duyệt)
app.post('/api/transactions/:id/unpair', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!txn || !txn.transfer_pair_id) {
    return c.json({ success: false, message: 'Giao dịch này không nằm trong cặp chuyển khoản nào' }, 400);
  }

  // Nếu giao dịch chuyển nội bộ đã từng được duyệt, hoàn tác sổ cái trước khi tách về pending
  if (txn.status === 'confirmed' && txn.type === 'transfer') {
    await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(txn.amount, txn.account_id, userId).run();
    if (txn.to_account_id) {
      await db.prepare('UPDATE accounts SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(txn.amount, txn.to_account_id, userId).run();
    }
  }

  const pairId = txn.transfer_pair_id;
  const pairedTxns = await db.prepare(`
    SELECT t.id, t.raw_notification_id, t.original_type, r.raw_body, t.description
    FROM transactions t
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
    WHERE t.transfer_pair_id = ? AND t.user_id = ?
  `).bind(pairId, userId).all<{ id: string; raw_notification_id: string | null; original_type: string | null; raw_body: string | null; description: string }>();

  // Lấy hũ mặc định của user
  const defaultJar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND is_default = 1').bind(userId).first<{ id: string }>()
    || await db.prepare('SELECT id FROM jars WHERE user_id = ? ORDER BY sort_order ASC LIMIT 1').bind(userId).first<{ id: string }>();
  const fallbackJarId = defaultJar?.id || 'jar_nec';

  for (const t of pairedTxns.results) {
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
          notes = 'Đã tách thủ công từ cặp chuyển tiền'
      WHERE id = ? AND user_id = ?
    `).bind(origType, jarId, t.id, userId).run();
  }

  return c.json({
    success: true,
    message: 'Đã tách 2 giao dịch thành công'
  });
});

// Ghép cặp thủ công 1 giao dịch chi thành chuyển khoản sang tài khoản khác (Phương án 2)
app.post('/api/transactions/:id/pair-transfer', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  const { toAccountId } = await c.req.json<{ toAccountId: string }>();

  const txn = await db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<any>();

  if (!txn) {
    return c.json({ success: false, message: 'Không tìm thấy giao dịch' }, 404);
  }

  const targetAcc = await db.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?')
    .bind(toAccountId, userId).first<any>();

  if (!targetAcc) {
    return c.json({ success: false, message: 'Không tìm thấy tài khoản nhận' }, 404);
  }

  const pairId = `pair_${Date.now()}`;

  // Tìm xem có giao dịch nhận tiền pending trùng số tiền ở tài khoản đích chưa
  const existingCounter = await db.prepare(`
    SELECT id FROM transactions
    WHERE user_id = ? AND account_id = ? AND amount = ? AND type = 'income' AND status = 'pending' AND transfer_pair_id IS NULL
    ORDER BY occurred_at DESC LIMIT 1
  `).bind(userId, toAccountId, txn.amount).first<{ id: string }>();

  // 1. Cập nhật giao dịch nguồn thành transfer kèm to_account_id
  await db.prepare(`
    UPDATE transactions 
    SET type = 'transfer', to_account_id = ?, transfer_pair_id = ?, jar_id = NULL, original_type = COALESCE(original_type, 'expense'), notes = ?
    WHERE id = ? AND user_id = ?
  `).bind(toAccountId, pairId, `Chuyển sang ${targetAcc.name}`, id, userId).run();

  // Nếu giao dịch nguồn vốn đã ở trạng thái confirmed (khoản chi đã trừ tiền), cộng bổ sung vào tài khoản đích
  if (txn.status === 'confirmed') {
    await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .bind(txn.amount, toAccountId, userId).run();
  }

  // 2. Liên kết hoặc tạo chân đối ứng ẩn (paired_hidden) để hiển thị thông tin tài khoản đích & hỗ trợ Tách lại nếu cần
  if (existingCounter) {
    await db.prepare(`
      UPDATE transactions
      SET type = 'transfer', transfer_pair_id = ?, jar_id = NULL, status = 'paired_hidden', original_type = 'income', notes = ?
      WHERE id = ? AND user_id = ?
    `).bind(pairId, `Nhận từ đối ứng ${id}`, existingCounter.id, userId).run();
  } else {
    const counterTxnId = `txn_pair_${Date.now()}`;
    await db.prepare(`
      INSERT INTO transactions (
        id, user_id, account_id, type, amount, occurred_at, description,
        status, transfer_pair_id, original_type, notes
      ) VALUES (?, ?, ?, 'transfer', ?, ?, ?, 'paired_hidden', ?, 'income', ?)
    `).bind(
      counterTxnId,
      userId,
      toAccountId,
      txn.amount,
      txn.occurred_at,
      `Nhận chuyển khoản nội bộ vào ${targetAcc.name}`,
      pairId,
      `Nhận từ đối ứng ${id}`
    ).run();
  }

  return c.json({ success: true, message: 'Đã tạo chuyển khoản nội bộ thành công' });
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

// L-11: API Thống kê tổng hợp theo kỳ (Month / Quarter / Year) chuẩn UTC+7 không bị cắt bởi limit=250
app.get('/api/analytics/summary', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const period = c.req.query('period') || 'month'; // 'month' | 'quarter' | 'year'
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

  let dateClause = '';
  let dateBindings: any[] = [];
  if (period === 'month') {
    dateClause = `strftime('%Y-%m', datetime(t.occurred_at, '+7 hours')) = ?`;
    dateBindings = [yearMonthStr];
  } else if (period === 'quarter') {
    dateClause = `strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ? AND ((CAST(strftime('%m', datetime(t.occurred_at, '+7 hours')) AS INTEGER) - 1) / 3) = ?`;
    dateBindings = [yearStr, quarterZeroIdx];
  } else {
    dateClause = `strftime('%Y', datetime(t.occurred_at, '+7 hours')) = ?`;
    dateBindings = [yearStr];
  }

  const totalStats = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as total_income,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as total_expense
    FROM transactions t
    WHERE t.user_id = ? AND t.status = 'confirmed' AND ${dateClause}
  `).bind(userId, ...dateBindings).first<{ total_income: number; total_expense: number }>();

  const { results: jarBreakdown } = await db.prepare(`
    SELECT j.id, j.name, j.code, j.color, j.target_percent, j.monthly_limit,
           COALESCE(SUM(t.amount), 0) as spent
    FROM jars j
    LEFT JOIN transactions t ON t.jar_id = j.id AND t.type = 'expense' AND t.status = 'confirmed' AND ${dateClause}
    WHERE j.user_id = ?
    GROUP BY j.id
    ORDER BY j.sort_order ASC
  `).bind(...dateBindings, userId).all();

  const { results: incomeBreakdown } = await db.prepare(`
    SELECT COALESCE(t.income_source_id, 'other') as source_id,
           COALESCE(s.name, 'Thu nhập khác') as source_name,
           COALESCE(SUM(t.amount), 0) as total_amount
    FROM transactions t
    LEFT JOIN income_sources s ON t.income_source_id = s.id
    WHERE t.user_id = ? AND t.type = 'income' AND t.status = 'confirmed' AND ${dateClause}
    GROUP BY source_id
  `).bind(userId, ...dateBindings).all();

  return c.json({
    period,
    year: yearNum,
    month: monthNum,
    quarter: quarterNum,
    totalIncome: totalStats?.total_income || 0,
    totalExpense: totalStats?.total_expense || 0,
    jarBreakdown: jarBreakdown || [],
    incomeBreakdown: incomeBreakdown || []
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
  `).bind(userId).all();
  return c.json({ accounts: results });
});

// Thêm tài khoản mới (chấp nhận cả camelCase và snake_case)
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
    type?: string;
  }>();

  const id = body.id || `acc_${Date.now()}`;
  const bankCode = body.bankCode ?? body.bank_code ?? null;
  const mask = body.accountNumberMask ?? body.account_number_mask ?? null;
  const bal = Math.round(body.balance || 0);

  await db.prepare(`
    INSERT INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      type = excluded.type,
      bank_code = excluded.bank_code,
      account_number_mask = excluded.account_number_mask,
      balance = excluded.balance,
      updated_at = CURRENT_TIMESTAMP
  `).bind(
    id,
    userId,
    body.name,
    body.type || 'bank',
    bankCode,
    mask,
    bal
  ).run();

  return c.json({ success: true, id, message: 'Đã thêm tài khoản mới' });
});

// Chỉnh sửa tài khoản (Cập nhật số dư thực tế, tên... hỗ trợ camelCase & snake_case)
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
    type?: string;
  }>();

  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
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
  const mask = body.accountNumberMask !== undefined ? body.accountNumberMask : body.account_number_mask;
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

// Xóa tài khoản
app.delete('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true, message: 'Đã xóa tài khoản' });
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
app.delete('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  // Chuyển các giao dịch thuộc hũ này sang NULL trước khi xóa hũ
  await db.prepare('UPDATE transactions SET jar_id = NULL WHERE jar_id = ? AND user_id = ?')
    .bind(id, userId).run();

  await db.prepare('DELETE FROM jars WHERE id = ? AND user_id = ?')
    .bind(id, userId).run();

  return c.json({ success: true, message: 'Đã xóa hũ thành công' });
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
      color TEXT DEFAULT '#657D81',
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
}

// Danh sách Nguồn thu dự kiến
app.get('/api/income-sources', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const { results } = await db.prepare('SELECT * FROM income_sources WHERE user_id = ? AND is_active = 1 ORDER BY created_at ASC')
    .bind(userId).all();
  return c.json({ incomeSources: results });
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
  }>();
  const id = body.id || `inc_${Date.now()}`;
  const amt = Math.round(body.expectedAmount ?? body.expected_amount ?? 0);
  await db.prepare(`
    INSERT INTO income_sources (id, user_id, name, kind, expected_amount, recurrence, color, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      expected_amount = excluded.expected_amount,
      recurrence = excluded.recurrence,
      color = excluded.color
  `).bind(id, userId, body.name, body.kind || 'fixed', amt, body.recurrence || 'Hàng tháng', body.color || '#657D81').run();
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

  if (updates.length > 0) {
    params.push(id, userId);
    await db.prepare(`UPDATE income_sources SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`).bind(...params).run();
  }
  return c.json({ success: true, id });
});

app.delete('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);
  await db.prepare('UPDATE transactions SET income_source_id = NULL WHERE income_source_id = ? AND user_id = ?').bind(id, userId).run();
  await db.prepare('DELETE FROM income_sources WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true });
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

  const { results: assets } = await db.prepare('SELECT id, symbol, asset_class, current_price, source, auto_sync FROM assets').all<{
    id: string;
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
      // Nếu đơn vị là lượng thì nhân 10, mặc định chỉ
      const unit = (ast.source || 'chỉ').toLowerCase();
      newPrice = unit.includes('lượng') || unit.includes('cây') ? goldPerChi * 10 : goldPerChi;
    } else if (ast.asset_class === 'silver' && silverPerLuong > 0) {
      const unit = (ast.source || 'lượng').toLowerCase();
      newPrice = unit.includes('chỉ') ? Math.round(silverPerLuong / 10) : unit.includes('kg') ? Math.round(silverPerLuong * 26.666) : silverPerLuong;
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

// RESET & KHỞI TẠO TÀI CHÍNH THỰC TẾ (L-03: Tách bạch rõ ràng, không bao giờ xóa nhầm transactions khi reset income)
app.post('/api/reset', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'planned_expenses' | 'all';
    clearNotifications?: boolean;
  }>();

  if (body.scope === 'transactions' || body.scope === 'all') {
    await db.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId).run();
    if (body.clearNotifications || body.scope === 'all') {
      await db.prepare('DELETE FROM raw_notifications WHERE user_id = ?').bind(userId).run();
    }
  }

  if (body.scope === 'balances' || body.scope === 'all') {
    await db.prepare('UPDATE accounts SET balance = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').bind(userId).run();
  }

  if (body.scope === 'holdings' || body.scope === 'all') {
    await db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM assets').run();
  }

  if (body.scope === 'income' || body.scope === 'all') {
    await db.prepare('DELETE FROM income_sources WHERE user_id = ?').bind(userId).run();
    await db.prepare('UPDATE jars SET monthly_limit = 0 WHERE user_id = ?').bind(userId).run();
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
  const apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.3/qltc-v1.2.3.apk';
  const response = await fetch(apkUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'QLTC-Updater/1.2.3'
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
      'Content-Disposition': 'attachment; filename="qltc-v1.2.3.apk"',
      'Content-Length': contentLength,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
      'Cache-Control': 'public, max-age=3600'
    }
  });
});

// Thông tin phiên bản & link cập nhật (v1.2.3)
app.get('/api/version', (c) => {
  return c.json({
    version: '1.2.3',
    latestApkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.2.3/qltc-v1.2.3.apk',
    directDownloadUrl: 'https://qltc-backend.dtd-store.workers.dev/api/download-apk',
    releasePageUrl: 'https://github.com/DUCDT3006/qltc/releases/latest',
    otaUpdated: true,
    message: 'Giao diện web cập nhật tức thì qua mạng (OTA).'
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
