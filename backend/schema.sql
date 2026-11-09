-- 1. Users & Auth
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  phone TEXT,
  avatar TEXT,
  password_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1b. Devices (Android listeners, etc.)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'revoked'
  scopes TEXT NOT NULL DEFAULT 'notifications:ingest',
  last_seen_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 1c. Device Pair Codes
CREATE TABLE IF NOT EXISTS device_pair_codes (
  code TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL DEFAULT 'Android Device',
  expires_at DATETIME NOT NULL,
  used_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 1d. Browser owner sessions; only the SHA-256 token hash is stored.
CREATE TABLE IF NOT EXISTS web_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_active ON web_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;

-- 1e. Mutation Assertions (Used inside D1 batch() to abort & rollback on precondition failure)
CREATE TABLE IF NOT EXISTS mutation_assertions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

-- 2. Accounts (Ngân hàng, Ví, Tiền mặt)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'bank', 'ewallet', 'cash', 'credit'
  currency TEXT DEFAULT 'VND',
  balance INTEGER DEFAULT 0, -- Stored in VND (cached, derived from baseline + postings)
  account_number_mask TEXT, -- Last 4 digits for matching SMS/Noti
  account_number TEXT,
  bank_code TEXT,
  bank_name TEXT,
  account_holder TEXT,
  branch TEXT,
  aliases_json TEXT, -- JSON array of aliases
  include_in_net_worth INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  archived_at DATETIME,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 3. Jars (Các Hũ Chi Tiêu)
CREATE TABLE IF NOT EXISTS jars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  target_percent REAL DEFAULT 0, -- e.g., 0.50 for 50%
  monthly_limit INTEGER DEFAULT 0,
  rollover_enabled BOOLEAN DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 4. Income Sources (Các Nguồn Thu Dự Kiến)
CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expected_amount INTEGER DEFAULT 0,
  cadence TEXT DEFAULT 'monthly', -- 'monthly', 'quarterly', 'yearly', 'irregular', 'one_time'
  one_time_date TEXT, -- YYYY-MM-DD when cadence = 'one_time'
  expected_day INTEGER, -- 1 to 31
  account_id TEXT,
  icon TEXT DEFAULT 'payments',
  color TEXT DEFAULT '#10B981',
  is_active INTEGER DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- 5. Planned Expenses (Các Khoản Chi Cố Định / Dự Kiến)
CREATE TABLE IF NOT EXISTS planned_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  expected_amount INTEGER DEFAULT 0,
  cadence TEXT DEFAULT 'monthly', -- 'monthly', 'quarterly', 'yearly', 'one_time'
  one_time_date TEXT, -- YYYY-MM-DD when cadence = 'one_time'
  due_day INTEGER,
  jar_id TEXT,
  account_id TEXT,
  is_active INTEGER DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (jar_id) REFERENCES jars(id) ON DELETE SET NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- 5b. Plan Versions (Lịch sử kế hoạch thu/chi/hũ theo kỳ hiệu lực)
CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'income_source', 'planned_expense', 'jar'
  entity_id TEXT NOT NULL,
  effective_from_month TEXT NOT NULL, -- YYYY-MM
  effective_to_month_exclusive TEXT, -- YYYY-MM or NULL
  payload_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 6. Raw Notifications (Lưu trữ thông báo gốc từ Android Listener)
CREATE TABLE IF NOT EXISTS raw_notifications (
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
  parse_status TEXT DEFAULT 'pending', -- 'pending', 'parsed', 'ignored', 'failed', 'ambiguous', 'ignored_otp', 'rejected'
  parse_error TEXT,
  raw_json TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 7. Transactions (Giao dịch Thu / Chi / Chuyển khoản)
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  occurred_at DATETIME NOT NULL,
  time_source TEXT DEFAULT 'user_input',
  type TEXT NOT NULL, -- 'income', 'expense', 'transfer'
  amount INTEGER NOT NULL, -- Always positive in VND
  currency TEXT DEFAULT 'VND',
  account_id TEXT NOT NULL, -- Nguồn tiền vào (income) hoặc ra (expense/transfer)
  to_account_id TEXT, -- Dùng cho type = 'transfer'
  jar_id TEXT, -- Gắn với Hũ chi tiêu (nếu là expense)
  income_source_id TEXT, -- Gắn với Nguồn thu (nếu là income)
  planned_expense_id TEXT,
  status TEXT DEFAULT 'pending', -- 'pending', 'confirmed', 'ignored', 'paired_hidden', 'deleted'
  needs_account_review INTEGER DEFAULT 0,
  source TEXT DEFAULT 'manual', -- 'notification', 'sms', 'manual', 'import', 'system'
  description TEXT,
  note TEXT,
  counterparty TEXT,
  raw_notification_id TEXT,
  dedupe_hash TEXT UNIQUE, -- Chống trùng lặp giao dịch tự động
  transfer_pair_id TEXT, -- ID nhóm 2 giao dịch đối ứng của Chuyển khoản nội bộ
  suggested_pair_id TEXT, -- Gợi ý ghép cặp chuyển khoản khi chỉ khớp yếu
  is_synthetic INTEGER DEFAULT 0,
  original_type TEXT, -- Lưu lại type gốc ('income'/'expense') trước khi ghép cặp để phục vụ Unpair
  original_account_id TEXT,
  original_jar_id TEXT,
  original_income_source_id TEXT,
  original_description TEXT,
  original_status TEXT,
  history_hidden INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  deleted_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (to_account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (jar_id) REFERENCES jars(id) ON DELETE SET NULL,
  FOREIGN KEY (income_source_id) REFERENCES income_sources(id) ON DELETE SET NULL,
  FOREIGN KEY (planned_expense_id) REFERENCES planned_expenses(id) ON DELETE SET NULL,
  FOREIGN KEY (raw_notification_id) REFERENCES raw_notifications(id) ON DELETE SET NULL
);

-- 7b. Ledger Baselines & Postings (Single Source of Truth cho số dư)
CREATE TABLE IF NOT EXISTS ledger_baselines (
  account_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  baseline_amount_vnd INTEGER NOT NULL DEFAULT 0,
  baseline_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ledger_postings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  transaction_id TEXT,
  operation_id TEXT NOT NULL,
  delta_vnd INTEGER NOT NULL,
  reason TEXT NOT NULL, -- 'confirm', 'undo', 'edit', 'delete', 'transfer', 'reset_adjustment', 'manual_adjustment', 'opening_balance'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
);

-- 7c. Mutation Receipts (Idempotency)
CREATE TABLE IF NOT EXISTS mutation_receipts (
  operation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 8. Categorization Rules (Luật phân loại tự động học từ lịch sử vuốt)
CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  priority INTEGER DEFAULT 1,
  match_field TEXT NOT NULL, -- 'counterparty', 'description', 'app_package', 'amount_exact'
  match_type TEXT NOT NULL, -- 'contains', 'regex', 'equals'
  pattern TEXT NOT NULL,
  action_type TEXT NOT NULL, -- 'assign_jar', 'assign_income', 'mark_transfer', 'ignore'
  target_id TEXT, -- jar_id hoặc income_source_id hoặc to_account_id
  confidence REAL DEFAULT 1.0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Investment Assets & Holdings (Danh mục Đầu tư: Vàng, Cổ phiếu, Crypto, Quỹ)
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE, -- 'SJC', 'GOLD_RING', 'VCB', 'BTC', 'VESAF'
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL, -- 'gold', 'stock', 'crypto', 'fund', 'savings', 'real_estate'
  unit TEXT NOT NULL, -- 'luong', 'chi', 'share', 'coin', 'ccq'
  quote_unit TEXT,
  provider TEXT,
  currency TEXT DEFAULT 'VND',
  current_price REAL DEFAULT 0,
  price_as_of DATETIME,
  sync_status TEXT DEFAULT 'ok',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  account_id TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  holding_unit TEXT,
  avg_cost REAL NOT NULL DEFAULT 0, -- Giá vốn trung bình trên mỗi đơn vị (VND)
  note TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS investment_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  account_id TEXT, -- Tài khoản tiền liên kết
  type TEXT NOT NULL, -- 'buy', 'sell', 'dividend', 'interest', 'fee', 'tax'
  occurred_at DATETIME NOT NULL,
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  fee INTEGER DEFAULT 0,
  tax INTEGER DEFAULT 0,
  total_amount_vnd INTEGER NOT NULL,
  linked_transaction_id TEXT,
  operation_id TEXT UNIQUE,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
);

-- Explicit portfolio-level external contributions and withdrawals. These rows are history only;
-- writing them does not mutate account balances or the financial ledger.
CREATE TABLE IF NOT EXISTS investment_cashflows (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('contribution', 'withdrawal')),
  amount_vnd INTEGER NOT NULL CHECK (amount_vnd > 0),
  occurred_at TEXT NOT NULL,
  note TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_investment_cashflows_user_date ON investment_cashflows(user_id, occurred_at);

-- Explicit user confirmation that all external flows have been recorded since this date.
CREATE TABLE IF NOT EXISTS investment_cashflow_settings (
  user_id TEXT PRIMARY KEY,
  complete_from TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for high performance queries
CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_transactions_jar ON transactions(user_id, jar_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_raw_notifications_status ON raw_notifications(user_id, parse_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_notifications_event ON raw_notifications(user_id, device_id, event_id) WHERE event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_raw_notif_primary ON transactions(raw_notification_id) WHERE raw_notification_id IS NOT NULL AND is_synthetic = 0;
CREATE INDEX IF NOT EXISTS idx_ledger_postings_account ON ledger_postings(user_id, account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_plan_versions_lookup ON plan_versions(user_id, entity_type, effective_from_month);
