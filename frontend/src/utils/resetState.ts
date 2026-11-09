export interface ResetState<TAccount, TJar, THolding, TIncome, TPlannedExpense, TTransaction> {
  accounts: TAccount[];
  jars: TJar[];
  holdings: THolding[];
  incomeSources: TIncome[];
  plannedExpenses: TPlannedExpense[];
  pendingTransactions: TTransaction[];
  confirmedTransactions: TTransaction[];
}

export function applyResetScope<
  TAccount extends { balance: number },
  TJar extends { spentThisMonth: number; monthlyLimit: number },
  THolding,
  TIncome,
  TPlannedExpense,
  TTransaction
>(
  current: ResetState<TAccount, TJar, THolding, TIncome, TPlannedExpense, TTransaction>,
  scope: 'transactions' | 'balances' | 'holdings' | 'income' | 'all'
): ResetState<TAccount, TJar, THolding, TIncome, TPlannedExpense, TTransaction> {
  const resetsTransactions = scope === 'transactions' || scope === 'all';
  const resetsBalances = scope === 'balances' || scope === 'all';
  const resetsHoldings = scope === 'holdings' || scope === 'all';
  const resetsIncomeSources = scope === 'income' || scope === 'all';
  const resetsAllPlans = scope === 'all';

  return {
    accounts: resetsBalances ? current.accounts.map(account => ({ ...account, balance: 0 })) : current.accounts,
    jars: resetsTransactions || resetsAllPlans
      ? current.jars.map(jar => ({
        ...jar,
        spentThisMonth: resetsTransactions ? 0 : jar.spentThisMonth,
        monthlyLimit: resetsAllPlans ? 0 : jar.monthlyLimit
      }))
      : current.jars,
    holdings: resetsHoldings ? [] : current.holdings,
    incomeSources: resetsIncomeSources ? [] : current.incomeSources,
    plannedExpenses: resetsAllPlans ? [] : current.plannedExpenses,
    pendingTransactions: resetsTransactions ? [] : current.pendingTransactions,
    confirmedTransactions: resetsTransactions ? [] : current.confirmedTransactions
  };
}
