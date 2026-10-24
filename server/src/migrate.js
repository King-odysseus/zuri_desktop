import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig } from './config.js';
import { createDatabase } from './db.js';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

const config = readConfig();
if (config.databaseUrl === '') {
  console.error('[zuri-cloud] DATABASE_URL is not set. Add a PostgreSQL database first (for example Railway Postgres).');
  process.exit(1);
}

const pool = createDatabase(config.databaseUrl);
try {
  // schema.sql is idempotent (IF NOT EXISTS / ON CONFLICT), so re-running is safe.
  await pool.query(await readFile(schemaPath, 'utf8'));
  const { rows } = await pool.query('SELECT code, name, amount_kobo FROM plans ORDER BY amount_kobo');
  console.log(`[zuri-cloud] schema applied; ${rows.length} plans: ${rows.map((row) => row.code).join(', ')}`);
} catch (error) {
  console.error('[zuri-cloud] migration failed:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
