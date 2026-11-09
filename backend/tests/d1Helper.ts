import { DatabaseSync } from 'node:sqlite';

export interface MockD1Options {
  failOnSqlPattern?: RegExp | string | null;
}

/**
 * Full SQLite-backed D1Database implementation using Node's built-in `node:sqlite`.
 * Executes `db.batch(statements)` inside a real `BEGIN IMMEDIATE ... COMMIT / ROLLBACK`
 * transaction, matching Cloudflare D1's atomic batch semantics and allowing fault injection.
 */
export function createSqliteD1(options: MockD1Options = {}): {
  db: D1Database;
  rawDb: DatabaseSync;
  setFailOnSqlPattern: (pattern: RegExp | string | null) => void;
} {
  const rawDb = new DatabaseSync(':memory:');
  rawDb.exec('PRAGMA foreign_keys = OFF;');

  let failPattern: RegExp | string | null = options.failOnSqlPattern || null;

  function shouldFail(sql: string): boolean {
    if (!failPattern) return false;
    if (typeof failPattern === 'string') {
      return sql.includes(failPattern);
    }
    return failPattern.test(sql);
  }

  function createStatement(sql: string, boundValues: any[] = []): D1PreparedStatement {
    const normalizeParam = (v: any) => {
      if (v === undefined) return null;
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    };

    const executeSingle = () => {
      if (shouldFail(sql)) {
        throw new Error(`Injected D1 failure on SQL: ${sql}`);
      }
      const stmt = rawDb.prepare(sql);
      const cleanParams = boundValues.map(normalizeParam);
      const isSelect = /^\s*(SELECT|PRAGMA|WITH)/i.test(sql);
      if (isSelect) {
        const rows = stmt.all(...cleanParams);
        return {
          results: rows as any[],
          success: true,
          meta: { changes: 0, duration: 0 }
        };
      } else {
        const res = stmt.run(...cleanParams);
        return {
          results: [],
          success: true,
          meta: {
            changes: Number(res.changes || 0),
            last_row_id: Number(res.lastInsertRowid || 0),
            duration: 0
          }
        };
      }
    };

    const stmtObj: any = {
      __sql: sql,
      __params: boundValues,
      __executeSingle: executeSingle,
      bind(...values: any[]) {
        return createStatement(sql, values);
      },
      async first<T = any>(colName?: string): Promise<T | null> {
        if (shouldFail(sql)) {
          throw new Error(`Injected D1 failure on SQL: ${sql}`);
        }
        const stmt = rawDb.prepare(sql);
        const cleanParams = boundValues.map(normalizeParam);
        const row = stmt.get(...cleanParams) as any;
        if (!row) return null;
        if (colName) return (row[colName] ?? null) as T;
        return row as T;
      },
      async run(): Promise<D1Result<any>> {
        return executeSingle() as any;
      },
      async all<T = any>(): Promise<D1Result<T>> {
        if (shouldFail(sql)) {
          throw new Error(`Injected D1 failure on SQL: ${sql}`);
        }
        const stmt = rawDb.prepare(sql);
        const cleanParams = boundValues.map(normalizeParam);
        const rows = stmt.all(...cleanParams);
        return {
          results: rows as T[],
          success: true,
          meta: { duration: 0 } as any
        };
      },
      async raw<T = any>(): Promise<T[]> {
        const res = await this.all();
        return res.results.map((r: any) => Object.values(r)) as T[];
      }
    };

    return stmtObj as D1PreparedStatement;
  }

  const db: D1Database = {
    prepare(query: string) {
      return createStatement(query, []);
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      rawDb.exec('BEGIN IMMEDIATE;');
      try {
        const results: D1Result<T>[] = [];
        for (const s of statements) {
          const internal = s as any;
          const res = internal.__executeSingle();
          results.push(res);
        }
        rawDb.exec('COMMIT;');
        return results;
      } catch (err) {
        try {
          rawDb.exec('ROLLBACK;');
        } catch {
          // ignore rollback error
        }
        throw err;
      }
    },
    async exec(query: string): Promise<D1ExecResult> {
      rawDb.exec(query);
      return { count: 1, duration: 0 };
    },
    async dump(): Promise<ArrayBuffer> {
      return new ArrayBuffer(0);
    },
    withSession(): any {
      return this;
    }
  } as any;

  return {
    db,
    rawDb,
    setFailOnSqlPattern(pattern: RegExp | string | null) {
      failPattern = pattern;
    }
  };
}
