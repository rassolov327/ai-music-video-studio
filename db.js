// ---- Postgres connection + schema for the user/token system ----
// Loaded defensively — a missing DATABASE_URL or a failed connection must never crash the
// whole server (this app worked fine without a database until now, and the KIE-generation
// features shouldn't become unusable just because the login system had a bad day). Every
// caller checks `pool` for null before using it.
import pg from 'pg';
const { Pool } = pg;

let pool = null;

if (process.env.DATABASE_URL) {
  // Railway deploys Postgres "private by default" — when the app and the database live in
  // the same project (our case, via the internal ${{Postgres.DATABASE_URL}} reference),
  // the connection stays on Railway's internal network and doesn't need SSL at all. SSL
  // (with a self-signed cert, hence rejectUnauthorized:false) is only needed for the
  // public/external connection string, which we're not using here — but this checks the
  // URL itself rather than assuming, so it stays correct if that ever changes.
  const isInternal = process.env.DATABASE_URL.includes('.railway.internal');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isInternal ? false : { rejectUnauthorized: false },
  });
  pool.on('error', (err) => {
    // A dropped idle connection must not crash the process — pg's default behavior on an
    // unhandled 'error' event from the pool IS to crash the whole app, so this is required,
    // not optional.
    console.error('[db] unexpected pool error (connection dropped, not crashing):', err);
  });
} else {
  console.warn('[db] DATABASE_URL not set — user/login features will be unavailable until it is.');
}

// Called once at server startup. Safe to call even if `pool` is null (just skips).
async function initDb() {
  if (!pool) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        tokens INTEGER NOT NULL DEFAULT 0,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        last_login TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    // Script Breakdown documents — the one place project-shaped data lives in Postgres
    // (everything in the main take:one app stays client-side). Scoped by user_id so each
    // user only ever sees their own scripts, from any device.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS script_documents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL DEFAULT 'Untitled script',
        raw_text TEXT NOT NULL DEFAULT '',
        structured_html TEXT,
        model TEXT NOT NULL DEFAULT 'gemini',
        scenes JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS script_documents_user_id_idx ON script_documents(user_id);`);
    console.log('[db] connected — users + script_documents tables ready');
  } catch (err) {
    console.error('[db] could not initialize the database (login features will be unavailable):', err);
  }
}

export { pool, initDb };
