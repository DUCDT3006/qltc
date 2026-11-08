-- Schema Database SQLite cho Cloudflare D1 (QLTC Cá nhân)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  avatar TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL, -- 'bank', 'cash', 'ewallet', 'credit', 'securities', 'crypto', 'savings'
  bank_code TEXT,      -- 'VCB', 'MB', 'TCB', 'ACB', 'VPB', 'TPB', 'BIDV', etc.
  account_number_mask TEXT, -- ví dụ: '0071'
  balance INTEGER NOT NULL DEFAULT 0, -- Số tiền nguyên VND
  currency TEXT NOT NULL DEFAULT 'VND',
  color TEXT DEFAULT '#657D81',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS income_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'fixed', -- 'fixed', 'irregular', 'passive'
  recurrence TEXT,                   -- 'monthly', 'weekly', 'quarterly', 'none'
  expected_amount INTEGER DEFAULT 0,
  default_account_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL, -- 'NEC', 'FFA', 'LTSS', 'EDU', 'PLAY', 'GIVE'
  name TEXT NOT NULL,
  target_percent REAL NOT NULL DEFAULT 0, -- ví dụ 0.55 cho 55%
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#657D81',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS allocation_rules (
  id TEXT PRIMARY KEY,
  income_source_id TEXT NOT NULL,
  jar_id TEXT NOT NULL,
  percent REAL NOT NULL DEFAULT 0,
  fixed_amount INTEGER DEFAULT 0,
  FOREIGN KEY (income_source_id) REFERENCES income_sources(id) ON DELETE CASCADE,
  FOREIGN KEY (jar_id) REFERENCES jars(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  jar_id TEXT,
  parent_id TEXT,
  name TEXT NOT NULL,
  icon TEXT,
  is_expense INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS raw_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  bank_code TEXT,
  title TEXT,
  raw_body TEXT NOT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_parsed INTEGER NOT NULL DEFAULT 0,
  parse_error TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'income', 'expense', 'transfer', 'invest'
  amount INTEGER NOT NULL, -- Số tiền nguyên VND (dương)
  currency TEXT NOT NULL DEFAULT 'VND',
  occurred_at DATETIME NOT NULL,
  description TEXT NOT NULL,
  notes TEXT,
  category_id TEXT,
  jar_id TEXT,
  income_source_id TEXT,
  external_ref TEXT,
  dedupe_hash TEXT UNIQUE, -- Hash chống ghi nhận trùng
  status TEXT NOT NULL DEFAULT 'confirmed', -- 'pending', 'confirmed', 'rejected'
  transfer_pair_id TEXT, -- Ghép đôi giao dịch chuyển tiền nội bộ
  raw_notification_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  pattern TEXT NOT NULL,
  match_field TEXT NOT NULL DEFAULT 'description', -- 'description', 'bank_code', 'title'
  target_type TEXT NOT NULL DEFAULT 'expense',
  target_category_id TEXT,
  target_jar_id TEXT,
  target_income_source_id TEXT,
  priority INTEGER NOT NULL DEFAULT 10,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE, -- 'HPG', 'FPT', 'VCBF-BCF', 'BTC', 'SJC'
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL, -- 'stock', 'fund', 'crypto', 'gold'
  current_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'VND',
  price_updated_at DATETIME,
  source TEXT
);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT,
  asset_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE TABLE IF NOT EXISTS investment_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  holding_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'buy', 'sell', 'dividend_cash', 'dividend_stock', 'fee'
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  fee INTEGER DEFAULT 0,
  tax INTEGER DEFAULT 0,
  occurred_at DATETIME NOT NULL,
  notes TEXT,
  FOREIGN KEY (holding_id) REFERENCES holdings(id)
);

-- Bảng V2: Chống lặp và biên nhận mutation (V2-02)
CREATE TABLE IF NOT EXISTS mutation_receipts (
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  ack_json TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, operation_id)
);

-- Bảng V2: Sổ cái hạch toán delta bất biến (V2-02)
CREATE TABLE IF NOT EXISTS ledger_postings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  transaction_id TEXT,
  delta_vnd INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bảng V2: Mốc số dư cơ sở cutover tài khoản (V2-02)
CREATE TABLE IF NOT EXISTS ledger_baselines (
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  baseline_balance INTEGER NOT NULL DEFAULT 0,
  cutover_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, account_id)
);

-- Bảng V2: Phiên bản kế hoạch tài chính có lịch hiệu lực (V2-16)
CREATE TABLE IF NOT EXISTS plan_versions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'income', 'expense', 'jar_budget'
  owner_id TEXT NOT NULL,
  amount_vnd INTEGER NOT NULL,
  cadence TEXT NOT NULL, -- 'monthly', 'weekly', 'quarterly', 'semiannual', 'annual', 'one_time'
  effective_from_month TEXT NOT NULL, -- 'YYYY-MM'
  effective_to_month_exclusive TEXT, -- 'YYYY-MM' or null
  one_time_date TEXT, -- 'YYYY-MM-DD'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bảng V2: Quản lý thiết bị Android và xác thực (V2-01)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'revoked'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at DATETIME
);

-- Chỉ mục tối ưu truy vấn
CREATE INDEX IF NOT EXISTS idx_txn_user_time ON transactions(user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_txn_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_raw_notif_time ON raw_notifications(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_holdings_user ON holdings(user_id);
CREATE INDEX IF NOT EXISTS idx_postings_account ON ledger_postings(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_postings_user ON ledger_postings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_versions_user ON plan_versions(user_id, type, owner_id);
