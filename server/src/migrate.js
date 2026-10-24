import { readConfig } from './config.js';
import { createDatabase } from './db.js';
import { applySchema } from './schema.js';

const config = readConfig();
if (config.databaseUrl === '') {
  console.error('[zuri-cloud] DATABASE_URL is not set. Add a PostgreSQL database first (for example Railway Postgres).');
  process.exit(1);
}

const pool = createDatabase(config.databaseUrl);
try {
  // schema.sql is idempotent (IF NOT EXISTS / ON CONFLICT), so re-running is safe.
  const { plans } = await applySchema(pool);
  console.log(`[zuri-cloud] schema applied; ${plans.length} plans: ${plans.join(', ')}`);
} catch (error) {
  console.error('[zuri-cloud] migration failed:', error?.message ?? error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
