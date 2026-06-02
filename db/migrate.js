import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB_LOCATION, db } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Apply the SQL schema. Idempotent (every statement uses IF NOT EXISTS).
 * Call once at app startup before app.start().
 */
export function migrate() {
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  console.log(`[db] migrated schema at ${DB_LOCATION}`);
}
