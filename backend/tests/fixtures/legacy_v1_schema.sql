-- Schema only: legacy installation, no user data.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
, phone TEXT, avatar TEXT, history_hidden_at DATETIME);

CREATE TABLE jars (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL, -- 'NEC', 'FFA', 'LTSS', 'EDU', 'PLAY', 'GIVE'
  name TEXT NOT NULL,
  target_percent REAL NOT NULL DEFAULT 0, -- ví dụ 0.55 cho 55%
  monthly_limit INTEGER NOT NULL DEFAULT 0,
  rollover INTEGER NOT NULL DEFAULT 1,
  color TEXT DEFAULT '#657D81',
  sort_order INTEGER NOT NULL DEFAULT 0
, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1);

CREATE TABLE income_sources (
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
, color TEXT DEFAULT '#657D81', keywords TEXT, icon TEXT DEFAULT "payments", one_time_date TEXT, revision INTEGER DEFAULT 1);

CREATE TABLE planned_expenses (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      jar_code TEXT NOT NULL DEFAULT 'NEC',
      expected_amount INTEGER NOT NULL DEFAULT 0,
      recurrence TEXT DEFAULT 'Hàng tháng',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    , one_time_date TEXT, is_active INTEGER DEFAULT 1, revision INTEGER DEFAULT 1);

CREATE TABLE raw_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  package_name TEXT NOT NULL,
  bank_code TEXT,
  title TEXT,
  raw_body TEXT NOT NULL,
  received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_parsed INTEGER NOT NULL DEFAULT 0,
  parse_error TEXT
, device_id TEXT, event_id TEXT, original_time_value TEXT, parser_version TEXT, parse_status TEXT, reason_code TEXT, time_source TEXT DEFAULT "notification");

CREATE TABLE transactions (
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
, to_account_id TEXT, balance_after INTEGER, original_type TEXT, revision INTEGER DEFAULT 1, deleted_at DATETIME, history_hidden_at DATETIME, is_synthetic INTEGER DEFAULT 0, time_source TEXT, suggested_pair_id TEXT, original_account_id TEXT, original_jar_id TEXT, original_income_source_id TEXT, original_description TEXT, original_status TEXT, history_hidden INTEGER NOT NULL DEFAULT 0, needs_account_review INTEGER DEFAULT 0);

CREATE TABLE ledger_baselines (
        user_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        baseline_balance INTEGER NOT NULL DEFAULT 0,
        cutover_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, account_id)
      );

CREATE TABLE ledger_postings (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        transaction_id TEXT,
        delta_vnd INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

CREATE TABLE mutation_receipts (
        user_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, operation_id)
      );

CREATE TABLE rules (
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
, category_name TEXT DEFAULT 'Chi tiêu', jar_code TEXT DEFAULT 'NEC', jar_id TEXT, created_at DATETIME);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE, -- 'HPG', 'FPT', 'VCBF-BCF', 'BTC', 'SJC'
  name TEXT NOT NULL,
  asset_class TEXT NOT NULL, -- 'stock', 'fund', 'crypto', 'gold'
  current_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'VND',
  price_updated_at DATETIME,
  source TEXT
, auto_sync INTEGER DEFAULT 1, quote_unit TEXT, provider TEXT, price_as_of DATETIME, sync_status TEXT DEFAULT "ok");

CREATE TABLE holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  account_id TEXT,
  asset_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, auto_sync INTEGER DEFAULT 1, holding_unit TEXT, revision INTEGER DEFAULT 1,
  FOREIGN KEY (asset_id) REFERENCES assets(id)
);

CREATE TABLE investment_transactions (
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
