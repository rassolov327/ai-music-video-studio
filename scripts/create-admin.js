// ---- one-time bootstrap: create the first admin user ----
// Run this ONCE, directly on Railway (Console tab), after this deploy lands and BEFORE
// anyone tries to log in — the login screen gates the entire app, and there's no admin
// panel yet to create the first account through, so without this nobody (including
// Костян) could get in at all.
//
// Usage (in Railway's Console tab, inside the app's own service):
//   node scripts/create-admin.js "Костян" "admin" "yourpassword"
//
// Safe to run more than once with the same login — it updates the existing row (new
// password + admin flag) instead of failing on a duplicate, so re-running it to change
// your own password later works fine too.

import bcrypt from 'bcryptjs';
import { pool, initDb } from '../db.js';

const [, , name, login, password] = process.argv;

if (!name || !login || !password) {
  console.error('Usage: node scripts/create-admin.js "<name>" "<login>" "<password>"');
  process.exit(1);
}
if (!pool) {
  console.error('DATABASE_URL is not set — nothing to connect to.');
  process.exit(1);
}

(async () => {
  await initDb(); // make sure the table exists, in case this runs before the server ever has
  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    `INSERT INTO users (name, login, password_hash, tokens, is_admin)
     VALUES ($1, $2, $3, 999999999, true)
     ON CONFLICT (login) DO UPDATE SET name = $1, password_hash = $3, is_admin = true`,
    [name, login, hash]
  );
  console.log('Admin user "' + login + '" is ready. You can log in with it now.');
  await pool.end();
  process.exit(0);
})().catch((err) => {
  console.error('Could not create the admin user:', err);
  process.exit(1);
});
