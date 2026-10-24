import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql');

/**
 * Apply db/schema.sql to a live database.
 *
 * schema.sql is written with IF NOT EXISTS / ON CONFLICT, so running it on every
 * boot is safe and keeps a fresh Railway Postgres in step with the code without a
 * separate migration step that a deploy can forget to run.
 * @param {import('pg').Pool} pool
 * @returns {Promise<{ plans: string[] }>} The plan codes the database now holds.
 */
export async function applySchema(pool) {
  await pool.query(await readFile(schemaPath, 'utf8'));
  const { rows } = await pool.query('SELECT code FROM plans ORDER BY amount_kobo');
  return { plans: rows.map((row) => row.code) };
}
