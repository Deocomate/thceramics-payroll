/* Loads a backup made with the app's "Tải file sao lưu" button: npm run import -- <file.json>
 * Docs stay encrypted exactly as exported, so everyone keeps their current password. */
const fs = require('fs');
const path = require('path');
const { parsePath } = require('./rules');
const { openStore } = require('./store');

async function importBackup(store, backup, { force = false } = {}) {
  const docs = backup && backup.docs;
  if (!docs || typeof docs !== 'object' || !docs['cfg/main']) throw new Error('File sao lưu không hợp lệ: thiếu cfg/main');
  const bad = Object.keys(docs).filter(p => !parsePath(p));
  if (bad.length) throw new Error('File sao lưu có đường dẫn lạ: ' + bad.slice(0, 3).join(', '));
  if (!force && await store.countDocs()) throw new Error('Máy chủ đã có dữ liệu. Thêm --force nếu chắc chắn muốn ghi đè.');
  await store.setDocs(docs);
  return Object.keys(docs).length;
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2), file = args.find(a => !a.startsWith('--'));
    if (!file) throw new Error('Cách dùng: npm run import -- <file.json> [--force]');
    const dbFile = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'payroll.db');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const store = await openStore('file:' + dbFile);
    const n = await importBackup(store, JSON.parse(fs.readFileSync(file, 'utf8')), { force: args.includes('--force') });
    store.close();
    console.log(`Đã nhập ${n} tài liệu vào ${dbFile}`);
  })().catch(e => { console.error(e.message); process.exit(1); });
}

module.exports = { importBackup };
