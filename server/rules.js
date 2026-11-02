/* Who may read and write which doc. Docs are encrypted in the browser, but a staff member holds their own key,
 * so these rules are what stops them from rewriting their own salary or bonus. */
const PATH = /^(?:cfg\/main|(kw|sal|sp)\/(nv\d+)|(sd|bon)\/(nv\d+)_\d{4}-\d{2}|months\/\d{4}-\d{2})$/;
const STAFF_WRITES = ['kw', 'sd', 'sp'];

function parsePath(path) {
  const m = PATH.exec(String(path));
  return m && { collection: m[1] || m[3] || path.split('/')[0], staffId: m[2] || m[4] || null };
}

/* nothing is readable signed out: cfg and kw hold the wrapped keys, which could be guessed at offline */
function canRead(role, path) {
  const p = parsePath(path);
  if (!p || !role) return false;
  if (role === 'owner' || p.collection === 'cfg' || p.collection === 'months') return true;
  return p.staffId === role;
}

function canWrite(role, path) {
  const p = parsePath(path);
  if (!p || !role) return false;
  if (role === 'owner') return true;
  return STAFF_WRITES.includes(p.collection) && p.staffId === role;
}

module.exports = { parsePath, canRead, canWrite };
