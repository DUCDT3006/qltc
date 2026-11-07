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

  // 7. TỰ ĐỘNG GHÉP CẶP CHUYỂN TIỀN NỘI BỘ (Phương án 1 & 3)
  let isAutoPaired = false;
  let pairId: string | null = null;
  const counterType = parsed.type === 'expense' ? 'income' : 'expense';

  // Tìm giao dịch pending đối ứng: Cùng số tiền, khác tài khoản, ngược loại income/expense
  const candidate = await db.prepare(`
    SELECT t.id, t.account_id, t.description, t.occurred_at, a.bank_code, a.name as account_name
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    WHERE t.user_id = ?
      AND t.status = 'pending'
      AND t.transfer_pair_id IS NULL
      AND t.amount = ?
      AND t.account_id != ?
      AND (t.type = ? OR t.type = 'transfer')
    ORDER BY t.occurred_at DESC
    LIMIT 1
  `).bind(userId, parsed.amount, accountId, counterType).first<{
    id: string;
    account_id: string;
    description: string;
    occurred_at: string;
    bank_code: string;
    account_name: string;
  }>();

  if (candidate) {
    pairId = `pair_${Date.now()}`;
    const pairNote = `[Tự động ghép cặp] ${parsed.type === 'expense' ? parsed.bankCode : candidate.bank_code} ➔ ${parsed.type === 'income' ? parsed.bankCode : candidate.bank_code}`;

    // Đánh dấu cả 2 thành loại transfer và liên kết qua transfer_pair_id
    await db.prepare(`
      UPDATE transactions 
      SET type = 'transfer', transfer_pair_id = ?, notes = ?
      WHERE id = ?
    `).bind(pairId, pairNote, txnId).run();

    await db.prepare(`
      UPDATE transactions 
      SET type = 'transfer', transfer_pair_id = ?, notes = ?
      WHERE id = ?
    `).bind(pairId, pairNote, candidate.id).run();

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
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const userId = 'user_default';

  let query = `
    SELECT t.*, a.name as account_name, a.bank_code, a.account_number_mask,
           j.name as jar_name, j.color as jar_color, j.code as jar_code,
           r.raw_body,
           p.id as paired_txn_id,
           pa.name as paired_account_name,
           pa.bank_code as paired_bank_code,
           pa.account_number_mask as paired_account_mask,
           p.type as paired_type
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN jars j ON t.jar_id = j.id
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
    LEFT JOIN transactions p ON (t.transfer_pair_id IS NOT NULL AND p.transfer_pair_id = t.transfer_pair_id AND p.id != t.id)
    LEFT JOIN accounts pa ON p.account_id = pa.id
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

    // Đồng bộ trạng thái cho giao dịch ghép cặp đối ứng nếu có
    const currentTxn = await db.prepare('SELECT transfer_pair_id FROM transactions WHERE id = ?').bind(id).first<{ transfer_pair_id: string | null }>();
    if (currentTxn?.transfer_pair_id) {
      await db.prepare('UPDATE transactions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE transfer_pair_id = ? AND user_id = ?')
        .bind(body.status, currentTxn.transfer_pair_id, userId).run();
    }
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
  } else if (body.categoryName) {
    updates.push('notes = ?');
    params.push(body.categoryName);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  await db.prepare(`UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`).bind(...params).run();

  return c.json({ success: true, message: 'Đã cập nhật giao dịch' });
});

// Thêm giao dịch thủ công từ QuickAddModal
app.post('/api/transactions', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const body = await c.req.json<{
    id?: string;
    accountId: string;
    type: 'income' | 'expense' | 'transfer';
    amount: number;
    description: string;
    jarId?: string;
    jarCode?: string;
    categoryName?: string;
    occurredAt?: string;
  }>();

  const txnId = body.id || `txn_man_${Date.now()}`;
  let jarId = body.jarId || null;
  if (!jarId && body.jarCode && body.type === 'expense') {
    const jar = await db.prepare('SELECT id FROM jars WHERE user_id = ? AND code = ?')
      .bind(userId, body.jarCode).first<{ id: string }>();
    jarId = jar?.id || null;
  }

  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, type, amount, occurred_at, description, jar_id, status, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?)
  `).bind(
    txnId,
    userId,
    body.accountId,
    body.type,
    body.amount,
    body.occurredAt || new Date().toISOString(),
    body.description,
    jarId,
    body.categoryName || null
  ).run();

  if (body.accountId) {
    const delta = body.type === 'income' ? body.amount : body.type === 'expense' ? -body.amount : 0;
    if (delta !== 0) {
      await db.prepare('UPDATE accounts SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .bind(delta, body.accountId, userId).run();
    }
  }

  return c.json({ success: true, id: txnId });
});

// Xóa giao dịch
app.delete('/api/transactions/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  return c.json({ success: true });
});

// Tách 2 giao dịch nếu auto-pairing bị nhầm (Unpair)
app.post('/api/transactions/:id/unpair', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';

  const txn = await db.prepare('SELECT id, transfer_pair_id, description FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).first<{ id: string; transfer_pair_id: string | null; description: string }>();

  if (!txn || !txn.transfer_pair_id) {
    return c.json({ success: false, message: 'Giao dịch này không nằm trong cặp chuyển khoản nào' }, 400);
  }

  const pairId = txn.transfer_pair_id;
  const pairedTxns = await db.prepare(`
    SELECT t.id, t.raw_notification_id, r.raw_body, t.description
    FROM transactions t
    LEFT JOIN raw_notifications r ON t.raw_notification_id = r.id
    WHERE t.transfer_pair_id = ? AND t.user_id = ?
  `).bind(pairId, userId).all<{ id: string; raw_notification_id: string | null; raw_body: string | null; description: string }>();

  for (const t of pairedTxns.results) {
    const text = (t.raw_body || t.description || '').toLowerCase();
    const isIncome = text.includes('+') || text.includes('cộng') || text.includes('nhận') || text.includes('vao');
    const origType = isIncome ? 'income' : 'expense';
    const jarId = isIncome ? null : 'jar_nec';

    await db.prepare(`
      UPDATE transactions 
      SET transfer_pair_id = NULL,
          type = ?,
          jar_id = ?,
          notes = 'Đã tách thủ công từ cặp chuyển tiền'
      WHERE id = ?
    `).bind(origType, jarId, t.id).run();
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
  const counterTxnId = `txn_pair_${Date.now()}`;

  // 1. Cập nhật giao dịch nguồn thành transfer
  await db.prepare(`
    UPDATE transactions 
    SET type = 'transfer', transfer_pair_id = ?, jar_id = NULL, notes = ?
    WHERE id = ?
  `).bind(pairId, `Chuyển sang ${targetAcc.name}`, id).run();

  // 2. Tạo giao dịch đối ứng ở tài khoản nhận
  await db.prepare(`
    INSERT INTO transactions (
      id, user_id, account_id, type, amount, occurred_at, description,
      status, transfer_pair_id, notes
    ) VALUES (?, ?, ?, 'transfer', ?, ?, ?, ?, ?, ?)
  `).bind(
    counterTxnId,
    userId,
    toAccountId,
    txn.amount,
    txn.occurred_at,
    `Nhận chuyển khoản đối ứng từ ${txn.account_id}`,
    txn.status,
    pairId,
    `Nhận từ đối ứng ${id}`
  ).run();

  return c.json({ success: true, message: 'Đã tạo chuyển khoản nội bộ thành công' });
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
  return c.json({ user });
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

  return c.json({
    success: true,
    user: {
      id: userId,
      name: newName,
      email: newEmail,
      phone: newPhone,
      avatar: newAvatar
    }
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
    expectedAmount: number;
    recurrence?: string;
    color?: string;
  }>();
  const id = body.id || `inc_${Date.now()}`;
  await db.prepare(`
    INSERT INTO income_sources (id, user_id, name, kind, expected_amount, recurrence, color, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      kind = excluded.kind,
      expected_amount = excluded.expected_amount,
      recurrence = excluded.recurrence
  `).bind(id, userId, body.name, body.kind || 'fixed', body.expectedAmount || 0, body.recurrence || 'Hàng tháng', body.color || '#657D81').run();
  return c.json({ success: true, id });
});

app.delete('/api/income-sources/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const userId = 'user_default';
  await ensurePlanningTables(db);
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
    jarCode: string;
    expectedAmount: number;
    recurrence?: string;
    note?: string;
  }>();
  const id = body.id || `pexp_${Date.now()}`;
  await db.prepare(`
    INSERT INTO planned_expenses (id, user_id, name, jar_code, expected_amount, recurrence, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      jar_code = excluded.jar_code,
      expected_amount = excluded.expected_amount,
      recurrence = excluded.recurrence,
      note = excluded.note
  `).bind(id, userId, body.name, body.jarCode || 'NEC', body.expectedAmount || 0, body.recurrence || 'Hàng tháng', body.note || null).run();
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

  const { results: assets } = await db.prepare('SELECT id, symbol, asset_class, current_price, source FROM assets').all<{
    id: string;
    symbol: string;
    asset_class: string;
    current_price: number;
    source: string | null;
  }>();

  let updatedCount = 0;
  for (const ast of assets) {
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

// API đồng bộ giá thị trường & Fmarket ngay lập tức
app.post('/api/market/sync-prices', async (c) => {
  const db = c.env.DB;
  const syncResult = await syncAllMarketPrices(db);
  return c.json({
    success: true,
    ...syncResult,
    message: `Đã cập nhật giá mới nhất cho ${syncResult.updatedCount} tài sản từ Fmarket & Thị trường`
  });
});

// Danh sách tài sản đầu tư
app.get('/api/holdings', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  const { results } = await db.prepare(`
    SELECT h.id, h.quantity, h.avg_cost, a.id as asset_id, a.symbol, a.name, a.asset_class, a.current_price, a.source as unit, a.price_updated_at
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

  await db.prepare(`
    INSERT INTO assets (id, symbol, name, asset_class, current_price, source, price_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(symbol) DO UPDATE SET
      current_price = excluded.current_price,
      name = excluded.name,
      asset_class = excluded.asset_class,
      source = excluded.source,
      price_updated_at = CURRENT_TIMESTAMP
  `).bind(assetId, cleanSymbol, body.name, body.assetClass, body.currentPrice, defaultUnit).run();

  const existingAsset = await db.prepare('SELECT id FROM assets WHERE symbol = ?').bind(cleanSymbol).first<{ id: string }>();
  const finalAssetId = existingAsset?.id || assetId;
  const holdingId = `hld_${finalAssetId}`;

  await db.prepare(`
    INSERT INTO holdings (id, user_id, asset_id, quantity, avg_cost, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      quantity = excluded.quantity,
      avg_cost = excluded.avg_cost,
      updated_at = CURRENT_TIMESTAMP
  `).bind(holdingId, userId, finalAssetId, body.quantity, body.avgCost).run();

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

// RESET & KHỞI TẠO TÀI CHÍNH THỰC TẾ
app.post('/api/reset', async (c) => {
  const db = c.env.DB;
  const userId = 'user_default';
  await ensurePlanningTables(db);
  const body = await c.req.json<{
    scope: 'transactions' | 'balances' | 'holdings' | 'all';
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

  if (body.scope === 'all') {
    await db.prepare('UPDATE jars SET monthly_limit = 0 WHERE user_id = ?').bind(userId).run();
    await db.prepare('DELETE FROM income_sources WHERE user_id = ?').bind(userId).run();
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
  const apkUrl = 'https://github.com/DUCDT3006/qltc/releases/download/v1.1.0/qltc-v1.1.0.apk';
  const response = await fetch(apkUrl, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'QLTC-Updater/1.1'
    }
  });

  if (!response.ok) {
    return c.text('Không thể tải file APK từ GitHub', 502);
  }

  const contentLength = response.headers.get('content-length') || '5632640';

  return new Response(response.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="qltc-v1.1.0.apk"',
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
    version: '1.1.0',
    latestApkUrl: 'https://github.com/DUCDT3006/qltc/releases/download/v1.1.0/qltc-v1.1.0.apk',
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
