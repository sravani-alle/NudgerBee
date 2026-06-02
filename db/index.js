import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Override with NUDGER_BEE_DB env var for tests / alternate paths.
const DB_PATH = process.env.NUDGER_BEE_DB || path.resolve(__dirname, '..', 'data', 'nudger-bee.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export const DB_LOCATION = DB_PATH;
