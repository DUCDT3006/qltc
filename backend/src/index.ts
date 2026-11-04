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

// Health check
app.get('/api/health', (c) => {
  return c.json({ status: 'ok', service: 'QLTC Backend', version: '1.0.0', time: new Date().toISOString() });
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
  }>();

  const userId = body.userId || 'user_default';
  const notifId = `notif_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 1. Lưu log thông báo gốc (để debug và huấn luyện parser)
  await db.prepare(`
    INSERT INTO raw_notifications (id, user_id, package_name, title, raw_body, received_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).bind(notifId, userId, body.packageName || 'unknown', body.title || '', body.text || '').run();

  // 2. Parse nội dung
  const parsed = parseBankNotification(body.packageName, body.title, body.text);
  if (!parsed) {
    await db.prepare('UPDATE raw_notifications SET is_parsed = 0, parse_error = ? WHERE id = ?')
      .bind('Không khớp mẫu ngân hàng', notifId).run();
    return c.json({ success: false, message: 'Không thể parse thông báo' }, 400);
  }

  // 3. Chống trùng
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

  if (existing) {
    return c.json({ success: true, duplicate: true, message: 'Giao dịch đã được ghi nhận trước đó', txnId: existing.id });
  }

  // 4. Tìm tài khoản khớp số đuôi
  const account = await db.prepare(`
    SELECT id FROM accounts
    WHERE user_id = ? AND (bank_code = ? OR account_number_mask = ?) AND is_active = 1
    LIMIT 1
  `).bind(userId, parsed.bankCode, parsed.accountMask).first<{ id: string }>();

  const accountId = account ? account.id : 'acc_vcb';

  // 5. Tự động phân loại danh mục & hũ
  const cat = categorizeTransaction(parsed.description, parsed.type);

  // Lấy jar_id từ jarCode
  const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
    .bind(userId, cat.jarCode).first<{ id: string }>();

  const jarId = jar ? jar.id : 'jar_nec';

  // 6. Tạo giao dịch ở trạng thái "Chờ duyệt" (pending)
  const txnId = `txn_${Date.now()}`;
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
    notifId
  ).run();

  // Đánh dấu đã parse thành công
  await db.prepare('UPDATE raw_notifications SET is_parsed = 1 WHERE id = ?').bind(notifId).run();

  return c.json({
    success: true,
    duplicate: false,
    transaction: {
      id: txnId,
      amount: parsed.amount,
      type: parsed.type,
      description: parsed.description,
      bankCode: parsed.bankCode,
      suggestedCategory: cat.categoryName,
      jarCode: cat.jarCode,
      confidence: cat.confidence
    }
  });
});

// Lấy danh sách giao dịch
app.get('/api/transactions', async (c) => {
  const db = c.env.DB;
  const status = c.req.query('status'); // 'pending' | 'confirmed'
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const userId = 'user_default';

  let query = `
    SELECT t.*, a.name as account_name, a.bank_code, j.name as jar_name, j.color as jar_color
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN jars j ON t.jar_id = j.id
    WHERE t.user_id = ?
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

// Duyệt / Sửa / Bỏ qua giao dịch (Swipe approve)
app.put('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.json<{
    status?: 'confirmed' | 'rejected';
    jarId?: string;
    categoryId?: string;
    notes?: string;
  }>();

  const updates: string[] = [];
  const params: any[] = [];

  if (body.status) {
    updates.push('status = ?');
    params.push(body.status);
  }
  if (body.jarId) {
    updates.push('jar_id = ?');
    params.push(body.jarId);
  }
  if (body.categoryId) {
    updates.push('category_id = ?');
    params.push(body.categoryId);
  }
  if (body.notes !== undefined) {
    updates.push('notes = ?');
    params.push(body.notes);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Đã cập nhật giao dịch' });
});

// Thống kê tổng quan (Dashboard)
app.get('/api/overview', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';

  // Tổng số dư các tài khoản tiền mặt / ngân hàng
  const accountsResult = await db.prepare(`
    SELECT type, SUM(balance) as total_balance
    FROM accounts
    WHERE user_id = ? AND is_active = 1
    GROUP BY type
  `).bind(userId).all<{ type: string; total_balance: number }>();

  let liquidCash = 0;
  for (const row of accountsResult.results) {
    if (['bank', 'cash', 'ewallet'].includes(row.type)) {
      liquidCash += (row.total_balance || 0);
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

  const netWorth = liquidCash + totalInvestments;

  // Dòng tiền tháng hiện tại
  const monthStats = await db.prepare(`
    SELECT
      SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
      SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END) as total_expense
    FROM transactions
    WHERE user_id = ? AND status = 'confirmed'
      AND strftime('%Y-%m', occurred_at) = strftime('%Y-%m', 'now')
  `).bind(userId).first<{ total_income: number; total_expense: number }>();

  // Số lượng giao dịch chờ duyệt
  const pendingCount = await db.prepare(`
    SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND status = 'pending'
  `).bind(userId).first<{ count: number }>();

  // 6 hũ chi tiêu và mức tiêu tháng này
  const jarsStats = await db.prepare(`
    SELECT
      j.id, j.code, j.name, j.target_percent, j.monthly_limit, j.color,
      COALESCE(SUM(t.amount), 0) as spent_this_month
    FROM jars j
    LEFT JOIN transactions t ON t.jar_id = j.id
      AND t.type = 'expense'
      AND t.status = 'confirmed'
      AND strftime('%Y-%m', t.occurred_at) = strftime('%Y-%m', 'now')
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

// Danh sách các hũ
app.get('/api/jars', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT * FROM jars WHERE user_id = ? ORDER BY sort_order ASC
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

export default {
  fetch: app.fetch,
  // Cron Trigger để cập nhật giá cổ phiếu, coin, vàng
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    console.log('Chạy Cron cập nhật giá thị trường tự động...');
    // Cập nhật giá qua CoinGecko / API tài chính
  }
};
