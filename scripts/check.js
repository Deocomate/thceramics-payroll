/* Everything that must pass before a change is shared: npm run check */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const problems = [];

for (const f of tracked.filter(f => /\.c?js$/.test(f))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { problems.push(`Lỗi cú pháp ở ${f}: ${String(e.stderr).split('\n')[0]}`); }
}
/* the repo is public: real business data stays on the machine */
const PRIVATE = /(^|\/)\.env$|\.db$|sao-luu.*\.json$|^dist\/|^docs\/(reference|screenshots)\/|^docs\/(CALCULATIONS|PROJECT)\.md$/;
for (const f of tracked.filter(f => PRIVATE.test(f))) problems.push(`Không được đưa lên Git: ${f}`);
for (const f of tracked.filter(f => /^(server|scripts)\/.*\.js$|\.env\.example$/.test(f))) {
  if (/^(ADMIN_PASSWORD|SESSION_SECRET)=\S/m.test(fs.readFileSync(f, 'utf8'))) problems.push(`Có mật khẩu thật trong ${f}`);
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
execSync('npm test', { stdio: 'inherit' });
console.log('Kiểm tra đạt');
