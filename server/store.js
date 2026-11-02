/* SQLite storage: one row per doc, same paths as the artifact db. All SQL lives here. */
const { createClient } = require('@libsql/client');

async function openStore(url) {
  const db = createClient({ url });
  await db.batch([
    'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS auth (who TEXT PRIMARY KEY, token_hash TEXT NOT NULL)',
  ], 'write');

  const setSql = 'INSERT INTO docs (path, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at';
  return {
    async getDoc(path) {
      const { rows } = await db.execute({ sql: 'SELECT data FROM docs WHERE path = ?', args: [path] });
      return rows.length ? JSON.parse(rows[0].data) : null;
    },
    async setDoc(path, data) {
      await db.execute({ sql: setSql, args: [path, JSON.stringify(data), new Date().toISOString()] });
    },
    async setDocs(docs) {
      const at = new Date().toISOString();
      await db.batch(Object.entries(docs).map(([path, data]) => ({ sql: setSql, args: [path, JSON.stringify(data), at] })), 'write');
    },
    async countDocs() {
      const { rows } = await db.execute('SELECT COUNT(*) AS n FROM docs');
      return Number(rows[0].n);
    },
    async getTokenHash(who) {
      const { rows } = await db.execute({ sql: 'SELECT token_hash FROM auth WHERE who = ?', args: [who] });
      return rows.length ? rows[0].token_hash : null;
    },
    /* first owner sign-in; the WHERE keeps a second, concurrent sign-in from replacing the tokens */
    async enroll(hashes) {
      const [first, ...rest] = Object.entries(hashes);
      const claimed = await db.execute({ sql: 'INSERT INTO auth (who, token_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth)', args: first });
      if (!claimed.rowsAffected) return false;
      await db.batch(rest.map(args => ({ sql: 'INSERT INTO auth (who, token_hash) VALUES (?, ?)', args })), 'write');
      return true;
    },
    async isEnrolled() {
      const { rows } = await db.execute('SELECT 1 FROM auth LIMIT 1');
      return rows.length > 0;
    },
    close() { db.close(); },
  };
}

module.exports = { openStore };
