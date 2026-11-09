/** Upgrade the persisted V1 names used by existing installations without rebuilding tables. */
export async function migrateLegacyStorage(db: D1Database): Promise<void> {
  const renames: Record<string, Record<string, string>> = {
    raw_notifications: { package_name: 'app_package', raw_body: 'text' },
    ledger_baselines: { baseline_balance: 'baseline_amount_vnd', cutover_at: 'baseline_at' },
    mutation_receipts: { ack_json: 'response_json' }
  };
  const additions: Record<string, Record<string, string>> = {
    jars: { code: 'TEXT', icon: 'TEXT', rollover_enabled: 'INTEGER DEFAULT 0', created_at: 'DATETIME' },
    income_sources: { cadence: "TEXT DEFAULT 'monthly'", expected_day: 'INTEGER', account_id: 'TEXT' },
    planned_expenses: { cadence: "TEXT DEFAULT 'monthly'", due_day: 'INTEGER', jar_id: 'TEXT', account_id: 'TEXT' },
    raw_notifications: { app_package: 'TEXT', text: 'TEXT', raw_json: 'TEXT' },
    transactions: { planned_expense_id: 'TEXT', source: "TEXT DEFAULT 'manual'", counterparty: 'TEXT' },
    ledger_baselines: { baseline_amount_vnd: 'INTEGER NOT NULL DEFAULT 0', baseline_at: 'DATETIME', note: 'TEXT' },
    ledger_postings: { reason: "TEXT NOT NULL DEFAULT 'legacy'" },
    mutation_receipts: { endpoint: "TEXT NOT NULL DEFAULT 'legacy:unknown'", status_code: 'INTEGER NOT NULL DEFAULT 200', response_json: 'TEXT' },
    rules: { match_type: "TEXT DEFAULT 'contains'", action_type: 'TEXT', target_id: 'TEXT', confidence: 'REAL DEFAULT 1.0' },
    assets: { unit: 'TEXT', updated_at: 'DATETIME' },
    holdings: { note: 'TEXT' }
  };
  const statements: D1PreparedStatement[] = [];
  for (const [table, definitions] of Object.entries(additions)) {
    // All identifiers below are fixed application constants, never request values.
    const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const original = new Set((info.results || []).map(column => column.name));
    const columns = new Set(original);
    const added = new Set<string>();
    for (const [oldName, newName] of Object.entries(renames[table] || {})) {
      if (columns.has(oldName) && !columns.has(newName)) {
        statements.push(db.prepare(`ALTER TABLE ${table} RENAME COLUMN ${oldName} TO ${newName}`));
        columns.delete(oldName);
        columns.add(newName);
      }
    }
    for (const [name, definition] of Object.entries(definitions)) {
      if (!columns.has(name)) {
        statements.push(db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`));
        columns.add(name);
        added.add(name);
      }
    }
    const copy = (target: string, source: string) => {
      if (added.has(target) && original.has(source)) {
        statements.push(db.prepare(`UPDATE ${table} SET ${target} = ${source}`));
      }
    };
    if (table === 'jars') copy('rollover_enabled', 'rollover');
    if (table === 'income_sources') copy('account_id', 'default_account_id');
    if ((table === 'income_sources' || table === 'planned_expenses') && added.has('cadence') && original.has('recurrence')) {
      statements.push(db.prepare(`UPDATE ${table} SET cadence = CASE
        WHEN recurrence IS NULL OR TRIM(recurrence) = '' THEN 'monthly'
        WHEN LOWER(recurrence) IN ('none','one_time','một lần') THEN 'one_time'
        WHEN LOWER(recurrence) LIKE '%tuần%' OR LOWER(recurrence) = 'weekly' THEN 'weekly'
        WHEN LOWER(recurrence) LIKE '%nửa năm%' OR LOWER(recurrence) LIKE '%6 tháng%' OR LOWER(recurrence) = 'semiannual' THEN 'semiannual'
        WHEN LOWER(recurrence) LIKE '%quý%' OR LOWER(recurrence) = 'quarterly' THEN 'quarterly'
        WHEN LOWER(recurrence) LIKE '%năm%' OR LOWER(recurrence) IN ('yearly','annual') THEN 'yearly'
        WHEN LOWER(recurrence) LIKE '%tháng%' OR LOWER(recurrence) = 'monthly' THEN 'monthly'
        ELSE recurrence END`));
    }
    if (table === 'planned_expenses' && added.has('jar_id') && original.has('jar_code')) {
      statements.push(db.prepare(`UPDATE planned_expenses SET jar_id = (
        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(j.id) ELSE NULL END FROM jars j
        WHERE j.user_id = planned_expenses.user_id AND j.code = planned_expenses.jar_code
      )`));
    }
    if (table === 'assets') copy('updated_at', 'price_updated_at');
    if (table === 'rules') {
      if (added.has('target_id') && original.has('target_income_source_id') && original.has('target_jar_id')) {
        statements.push(db.prepare(`UPDATE rules SET target_id = COALESCE(target_income_source_id, target_jar_id, jar_id)`));
      }
      if (added.has('action_type') && original.has('target_income_source_id') && original.has('target_jar_id')) {
        statements.push(db.prepare(`UPDATE rules SET action_type = CASE
          WHEN target_income_source_id IS NOT NULL THEN 'assign_income'
          WHEN target_jar_id IS NOT NULL OR jar_id IS NOT NULL THEN 'assign_jar' ELSE NULL END`));
      }
    }
  }
  // D1 batch is atomic: an interrupted upgrade cannot leave copied fields half migrated.
  if (statements.length) await db.batch(statements);
}
