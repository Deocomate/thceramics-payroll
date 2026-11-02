/* Runs the payroll app on your own server. Settings: see .env.example and docs/SERVER.md */
const fs = require('fs');
const path = require('path');
const { createApp, USERNAME } = require('./app');
const { openStore } = require('./store');

const root = path.join(__dirname, '..');
const { PORT = '3000', HOST = '127.0.0.1', ADMIN_USERNAME = 'admin', ADMIN_PASSWORD, SESSION_SECRET, TRUST_PROXY } = process.env;
const DB_FILE = process.env.DB_FILE || path.join(root, 'data', 'payroll.db');

if (!USERNAME.test(ADMIN_USERNAME.trim().toLowerCase())) throw new Error('ADMIN_USERNAME gồm 2-64 ký tự: chữ không dấu, số, dấu . _ @ - (xem .env.example)');
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) throw new Error('ADMIN_PASSWORD phải có ít nhất 12 ký tự (xem .env.example)');
if (!SESSION_SECRET || SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET phải có ít nhất 32 ký tự (xem .env.example)');

(async () => {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const store = await openStore('file:' + DB_FILE);
  const app = createApp({ store, secret: SESSION_SECRET, adminUsername: ADMIN_USERNAME, adminPassword: ADMIN_PASSWORD, distFile: path.join(root, 'dist', 'index.html'), trustProxy: TRUST_PROXY === '1' });
  const server = app.listen(Number(PORT), HOST, () => console.log(`Gốm Vũ Gia đang chạy ở http://${HOST}:${PORT}`));
  /* as PID 1 in a container, Node ignores these unless told otherwise, and each deploy would wait out the stop timeout */
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeIdleConnections();
  });
})();
