import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import workerApp, { getCurrentVnMonth } from '../src/index';
import { createSqliteD1 } from './d1Helper';

const ownerToken = 'test_owner_secret_token_v2_2026';

async function call(env: any, path: string, method = 'GET', body?: any) {
  const response = await workerApp.fetch(new Request(`http://localhost${path}`, {
    method,
    headers: { Authorization: `Bearer ${ownerToken}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }), env, { waitUntil() {} });
  return { status: response.status, data: await response.json() as any };
}

it('income-only reset archives sources and preserves transactions, budgets, jars, balances, and prior plans with foreign keys on', async () => {
  const { db, rawDb } = createSqliteD1();
  rawDb.exec('PRAGMA foreign_keys = ON;');
  rawDb.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const env = { DB: db, OWNER_API_TOKEN: ownerToken };
  const accountCreated = await call(env, '/api/accounts', 'POST', { id: 'acc_reset_income', name: 'Income account', type: 'cash', balance: 5000 });
  const jarCreated = await call(env, '/api/jars', 'POST', { id: 'jar_reset_income', name: 'Keep this jar', monthlyLimit: 1234, effectiveFromMonth: '2025-01' });
  const incomeCreated = await call(env, '/api/income-sources', 'POST', { id: 'inc_reset_income', name: 'Salary', expectedAmount: 1000, cadence: 'monthly', effectiveFromMonth: '2025-01' });
  const expenseCreated = await call(env, '/api/planned-expenses', 'POST', { id: 'plan_reset_income', name: 'Rent', expectedAmount: 200, jarId: 'jar_reset_income', effectiveFromMonth: '2025-01' });
  assert.equal(accountCreated.status, 200);
  assert.equal(jarCreated.status, 200);
  assert.equal(incomeCreated.status, 200);
  assert.equal(expenseCreated.status, 200);

  const currentMonth = getCurrentVnMonth();
  const incomeUpdated = await call(env, '/api/income-sources/inc_reset_income', 'PUT', { expectedAmount: 2000, effectiveFromMonth: currentMonth });
  assert.equal(incomeUpdated.status, 200);
  const transaction = await call(env, '/api/transactions', 'POST', {
    id: 'tx_reset_income', accountId: 'acc_reset_income', incomeSourceId: 'inc_reset_income',
    type: 'income', amount: 1500, occurredAt: `${currentMonth}-15T12:00:00+07:00`
  });
  assert.equal(transaction.status, 200, JSON.stringify(transaction.data));
  const beforeBalance = Number((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc_reset_income') as any).balance);
  const beforeBaseline = Number((rawDb.prepare('SELECT baseline_amount_vnd FROM ledger_baselines WHERE account_id = ?').get('acc_reset_income') as any).baseline_amount_vnd);
  const beforePostingCount = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM ledger_postings WHERE account_id = ?').get('acc_reset_income') as any).count);
  const beforeExpenseCount = Number((rawDb.prepare('SELECT COUNT(*) AS count FROM planned_expenses WHERE user_id = ?').get('user_default') as any).count);
  const beforeJarLimit = Number((rawDb.prepare('SELECT monthly_limit FROM jars WHERE id = ?').get('jar_reset_income') as any).monthly_limit);

  const reset = await call(env, '/api/reset', 'POST', { scope: 'income', operationId: 'reset-income-only' });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.deepEqual(reset.data.resetTargets, ['income']);

  const source = rawDb.prepare('SELECT is_active FROM income_sources WHERE id = ?').get('inc_reset_income') as any;
  assert.equal(Number(source.is_active), 0, 'Nguồn thu được archive thay vì xóa');
  const retainedTx = rawDb.prepare('SELECT status, income_source_id FROM transactions WHERE id = ?').get('tx_reset_income') as any;
  assert.equal(retainedTx.status, 'confirmed');
  assert.equal(retainedTx.income_source_id, 'inc_reset_income');
  assert.equal(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM planned_expenses WHERE user_id = ?').get('user_default') as any).count), beforeExpenseCount);
  assert.equal(Number((rawDb.prepare('SELECT monthly_limit FROM jars WHERE id = ?').get('jar_reset_income') as any).monthly_limit), beforeJarLimit);
  assert.equal(Number((rawDb.prepare('SELECT balance FROM accounts WHERE id = ?').get('acc_reset_income') as any).balance), beforeBalance);
  assert.equal(Number((rawDb.prepare('SELECT baseline_amount_vnd FROM ledger_baselines WHERE account_id = ?').get('acc_reset_income') as any).baseline_amount_vnd), beforeBaseline);
  assert.equal(Number((rawDb.prepare('SELECT COUNT(*) AS count FROM ledger_postings WHERE account_id = ?').get('acc_reset_income') as any).count), beforePostingCount);

  const versions = rawDb.prepare("SELECT effective_from_month, effective_to_month_exclusive FROM plan_versions WHERE entity_type = 'income_source' AND entity_id = ? ORDER BY effective_from_month").all('inc_reset_income') as any[];
  assert.equal(versions.length, 1, 'Phiên bản lịch sử trước reset được giữ, phiên bản hiện tại bị kết thúc');
  assert.equal(versions[0].effective_from_month, '2025-01');
  assert.equal(versions[0].effective_to_month_exclusive, currentMonth);

  const [year, month] = currentMonth.split('-').map(Number);
  const nextMonth = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  const nextMonthAfter = (() => {
    const [nextYear, nextMonthNumber] = nextMonth.split('-').map(Number);
    return nextMonthNumber === 12 ? `${nextYear + 1}-01` : `${nextYear}-${String(nextMonthNumber + 1).padStart(2, '0')}`;
  })();
  const vnMonthStartUtc = (monthValue: string) => {
    const [y, m] = monthValue.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, 1) - 7 * 3600 * 1000).toISOString();
  };
  const futureSummary = await call(env, `/api/analytics/summary?period=month&startDate=${encodeURIComponent(vnMonthStartUtc(nextMonth))}&toExclusive=${encodeURIComponent(vnMonthStartUtc(nextMonthAfter))}`);
  assert.equal(futureSummary.status, 200);
  assert.equal(futureSummary.data.totals.plannedIncome, 0, 'Nguồn đã reset không được tính trong các tháng sau');
  assert.equal(futureSummary.data.totals.plannedExpense, 200, 'Planned expense còn nguyên sau income-only reset');
});
