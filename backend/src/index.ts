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

  // 4. Tìm tài khoản khớp số đuôi hoặc mã ngân hàng (nếu chưa có thì tự động tạo mới)
  let account = await db.prepare(`
    SELECT id, balance FROM accounts
    WHERE user_id = ? AND (bank_code = ? OR account_number_mask = ?) AND is_active = 1
    LIMIT 1
  `).bind(userId, parsed.bankCode, parsed.accountMask).first<{ id: string; balance: number }>();

  let accountId: string;
  if (account) {
    accountId = account.id;
    // Cập nhật số dư tài khoản nếu thông báo có chứa số dư sau GD
    if (parsed.balanceAfter !== undefined && parsed.balanceAfter > 0) {
      await db.prepare('UPDATE accounts SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .bind(parsed.balanceAfter, accountId).run();
    }
  } else {
    // Tự động thêm tài khoản ngân hàng mới vào danh sách tài khoản
    accountId = `acc_${parsed.bankCode.toLowerCase()}_${parsed.accountMask}`;
    const accountName = `${parsed.bankCode} · *${parsed.accountMask}`;
    await db.prepare(`
      INSERT OR IGNORE INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
      VALUES (?, ?, ?, 'bank', ?, ?, ?)
    `).bind(accountId, userId, accountName, parsed.bankCode, parsed.accountMask, parsed.balanceAfter || 0).run();
  }

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

  // Đánh dấu đã parse thành công và ghi mã ngân hàng
  await db.prepare('UPDATE raw_notifications SET is_parsed = 1, bank_code = ? WHERE id = ?')
    .bind(parsed.bankCode, notifId).run();

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
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const userId = 'user_default';

  let query = `
    SELECT t.*, a.name as account_name, a.bank_code, a.account_number_mask,
           j.name as jar_name, j.color as jar_color, j.code as jar_code,
           r.raw_body
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN jars j ON t.jar_id = j.id
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
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
  const userId = 'user_default';
  const body = await c.req.json<{
    status?: 'confirmed' | 'rejected';
    jarId?: string;
    jarCode?: string;
    categoryId?: string;
    categoryName?: string;
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
  } else if (body.jarCode) {
    const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
      .bind(userId, body.jarCode).first<{ id: string }>();
    if (jar) {
      updates.push('jar_id = ?');
      params.push(jar.id);
    }
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
    SELECT j.*,
           COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.status = 'confirmed' AND strftime('%Y-%m', t.occurred_at) = strftime('%Y-%m', 'now') THEN t.amount ELSE 0 END), 0) as spent_this_month
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

// Thêm tài khoản mới
app.post('/api/accounts', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    name: string;
    balance?: number;
    bank_code?: string;
    account_number_mask?: string;
    type?: string;
  }>();

  const id = `acc_${Date.now()}`;
  await db.prepare(`
    INSERT INTO accounts (id, user_id, name, type, bank_code, account_number_mask, balance)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    userId,
    body.name,
    body.type || 'bank',
    body.bank_code || null,
    body.account_number_mask || null,
    body.balance || 0
  ).run();

  return c.json({ success: true, id, message: 'Đã thêm tài khoản mới' });
});

// Chỉnh sửa tài khoản (Cập nhật số dư thực tế, tên...)
app.put('/api/accounts/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  const body = await c.req.json<{
    name?: string;
    balance?: number;
    bank_code?: string;
    account_number_mask?: string;
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
    params.push(body.balance);
  }
  if (body.bank_code !== undefined) {
    updates.push('bank_code = ?');
    params.push(body.bank_code);
  }
  if (body.account_number_mask !== undefined) {
    updates.push('account_number_mask = ?');
    params.push(body.account_number_mask);
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

// Tạo hũ chi tiêu mới
app.post('/api/jars', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    code?: string;
    name: string;
    targetPercent?: number; // e.g. 0.1 for 10%
    monthlyLimit?: number;
    color?: string;
  }>();

  const jarId = `jar_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const code = (body.code || body.name.substring(0, 4)).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'JAR';
  const color = body.color || '#657D81';

  // Lấy số thứ tự lớn nhất
  const maxOrder = await db.prepare('SELECT MAX(sort_order) as m FROM jars WHERE user_id = ?').bind(userId).first<{ m: number }>();
  const sortOrder = (maxOrder?.m || 0) + 1;

  await db.prepare(`
    INSERT INTO jars (id, user_id, code, name, target_percent, monthly_limit, color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(jarId, userId, code, body.name, body.targetPercent || 0.1, body.monthlyLimit || 0, color, sortOrder).run();

  return c.json({ success: true, jarId, message: 'Đã tạo hũ chi tiêu mới thành công' });
});

// Cập nhật thông tin hũ chi tiêu (hạn mức, tỷ lệ %, tên, màu)
app.put('/api/jars/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  const body = await c.req.json<{
    monthly_limit?: number;
    target_percent?: number;
    name?: string;
    color?: string;
  }>();

  const updates: string[] = [];
  const bindings: any[] = [];

  if (body.monthly_limit !== undefined) {
    updates.push('monthly_limit = ?');
    bindings.push(body.monthly_limit);
  }
  if (body.target_percent !== undefined) {
    updates.push('target_percent = ?');
    bindings.push(body.target_percent);
  }
  if (body.name !== undefined) {
    updates.push('name = ?');
    bindings.push(body.name);
  }
  if (body.color !== undefined) {
    updates.push('color = ?');
    bindings.push(body.color);
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

// Danh sách tài sản đầu tư
app.get('/api/holdings', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT h.id, h.quantity, h.avg_cost, a.id as asset_id, a.symbol, a.name, a.asset_class, a.current_price
    FROM holdings h
    JOIN assets a ON h.asset_id = a.id
    WHERE h.user_id = ?
  `).bind(userId).all();
  return c.json({ holdings: results });
});

// Lưu / cập nhật tài sản đầu tư
app.post('/api/holdings', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    symbol: string;
    name: string;
    assetClass: 'stock' | 'fund' | 'crypto' | 'gold';
    quantity: number;
    avgCost: number;
    currentPrice: number;
  }>();

  const assetId = `ast_${body.symbol.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  await db.prepare(`
    INSERT INTO assets (id, symbol, name, asset_class, current_price, price_updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET current_price = excluded.current_price, name = excluded.name
  `).bind(assetId, body.symbol.toUpperCase(), body.name, body.assetClass, body.currentPrice).run();

  const holdingId = `hld_${assetId}`;
  await db.prepare(`
    INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET quantity = excluded.quantity, avg_cost = excluded.avg_cost
  `).bind(holdingId, userId, assetId, body.quantity, body.avgCost).run();

  return c.json({ success: true, message: 'Đã lưu tài sản đầu tư' });
});

// Xóa 1 tài sản đầu tư
app.delete('/api/holdings/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await db.prepare('DELETE FROM holdings WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true, message: 'Đã xóa tài sản đầu tư' });
});

// RESET & KHỞI TẠO TÀI CHÍNH THỰC TẾ
app.post('/api/reset', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    scope: 'transactions' | 'balances' | 'holdings' | 'all';
    clearNotifications?: boolean;
  }>();

  if (body.scope === 'transactions' || body.scope === 'all') {
    // 1. Xóa sạch lịch sử giao dịch
    await db.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId).run();
    if (body.clearNotifications || body.scope === 'all') {
      await db.prepare('DELETE FROM raw_notifications WHERE user_id = ?').bind(userId).run();
    }
  }

  if (body.scope === 'balances' || body.scope === 'all') {
    // 2. Đặt toàn bộ số dư tài khoản về 0
    await db.prepare('UPDATE accounts SET balance = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?').bind(userId).run();
  }

  if (body.scope === 'holdings' || body.scope === 'all') {
    // 3. Xóa sạch tài sản đầu tư mẫu
    await db.prepare('DELETE FROM holdings WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM assets').run();
  }

  if (body.scope === 'all') {
    // 4. Đặt toàn bộ hạn mức các hũ về 0
    await db.prepare('UPDATE jars SET monthly_limit = 0 WHERE user_id = ?').bind(userId).run();
  }

  return c.json({
    success: true,
    message: 'Đã thiết lập lại dữ liệu thành công',
    scope: body.scope
  });
});

// Tải trực tiếp file APK có hỗ trợ CORS và báo Content-Length cho thanh tiến trình %
app.get('/api/download-apk', async (c) => {
  const apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.3/qltc-v1.0.3.apk';
  const response = await fetch(apkUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'QLTC-Updater/1.0'
    }
  });

  if (!response.ok) {
    return c.text('Không thể tải file APK từ GitHub', 502);
  }

  const contentLength = response.headers.get('content-length') || '5632636';

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="qltc-v1.0.3.apk"',
      'Content-Length': contentLength,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition',
      'Cache-Control': 'public, max-age=3600'
    }
  });
});

// Thông tin phiên bản & link cập nhật
app.get('/api/version', (c) => {
  return c.json({
    version: '1.0.3',
    latestApkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.0.3/qltc-v1.0.3.apk',
    directDownloadUrl: 'https://qltc-backend.dtd-store.workers.dev/api/download-apk',
    releasePageUrl: 'https://github.com/DUCDT3006/qltc/releases/latest',
    otaUpdated: true,
    message: 'Giao diện web cập nhật tức thì qua mạng (OTA).'
  });
});

export default {
  fetch: app.fetch,
  // Cron Trigger để cập nhật giá cổ phiếu, coin, vàng
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext) {
    console.log('Chạy Cron cập nhật giá thị trường tự động...');
    // Cập nhật giá qua CoinGecko / API tài chính
  }
};
