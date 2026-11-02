/* SQLite storage: one row per doc, same paths as the artifact db. All SQL lives here. */
const { createClient } = require('@libsql/client');

async function openStore(url) {
  const db = createClient({ url });
  await db.batch([
    'CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS accounts (who TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, proof_hash TEXT NOT NULL)',
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
    async getAccount(who) {
      const { rows } = await db.execute({ sql: 'SELECT who, username, salt, proof_hash FROM accounts WHERE who = ?', args: [who] });
      return rows[0] || null;
    },
    async findAccount(username) {
      const { rows } = await db.execute({ sql: 'SELECT who, username, salt, proof_hash FROM accounts WHERE username = ?', args: [username] });
      return rows[0] || null;
    },
    async listUsernames() {
      const { rows } = await db.execute('SELECT who, username FROM accounts');
      return Object.fromEntries(rows.map(r => [r.who, r.username]));
    },
    async setAccount(who, username, salt, proofHash) {
      await db.execute({
        sql: 'INSERT INTO accounts (who, username, salt, proof_hash) VALUES (?, ?, ?, ?) ON CONFLICT(who) DO UPDATE SET username = excluded.username, salt = excluded.salt, proof_hash = excluded.proof_hash',
        args: [who, username, salt, proofHash],
      });
    },
    close() { db.close(); },
  };
}

module.exports = { openStore };
