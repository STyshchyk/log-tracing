import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

/**
 * Create a PostgreSQL connection pool for the given connection string.
 */
export function createDbPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

function resolveInitSqlPath(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(moduleDir, '../../db/init.sql'),
    resolve(moduleDir, '../../../db/init.sql'),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!;
}

/**
 * Idempotently ensure the TimescaleDB extension and all five core tables exist.
 */
export async function ensureSchema(pool: Pool): Promise<void> {
  const sql = readFileSync(resolveInitSqlPath(), 'utf8');
  await pool.query(sql);
}
