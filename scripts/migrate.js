import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const version of ['001_initial', '002_public_event_details', '003_event_poster_variants']) {
    const sql = await readFile(new URL(`../db/migrations/${version}.sql`, import.meta.url), 'utf8');
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations(version) VALUES ($1) ON CONFLICT DO NOTHING', [version]);
    console.log(`Migración ${version} aplicada.`);
  }
} catch (error) {
  console.error('No se pudo aplicar la migración:', error.message);
  process.exitCode = 1;
} finally { await pool.end(); }
