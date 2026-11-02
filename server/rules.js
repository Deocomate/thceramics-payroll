/* Who may read and write which doc. Docs are encrypted in the browser, but a staff member holds their own key,
 * so these rules are what stops them from rewriting their own salary or bonus. */
const PATH = /^(?:cfg\/main|(kw|sal|sp)\/(nv\d+)|(sd|bon)\/(nv\d+)_\d{4}-\d{2}|months\/\d{4}-\d{2})$/;
const STAFF_WRITES = ['kw', 'sd', 'sp'];

function parsePath(path) {
  const m = PATH.exec(String(path));
  return m && { collection: m[1] || m[3] || path.split('/')[0], staffId: m[2] || m[4] || null };
}

/* cfg and kw are read before anyone is signed in: the login screen needs them to unlock the keys */
function canRead(role, path) {
  const p = parsePath(path);
  if (!p) return false;
  if (p.collection === 'cfg' || p.collection === 'kw') return true;
  if (!role) return false;
  if (role === 'owner' || p.collection === 'months') return true;
  return p.staffId === role;
}

/* nobody is signed in during first-time setup; that window closes once cfg/main exists, which the setup form writes last */
function canWrite(role, path, { hasCfg }) {
  const p = parsePath(path);
  if (!p) return false;
  if (role === 'owner') return true;
  if (!role) return !hasCfg;
  return STAFF_WRITES.includes(p.collection) && p.staffId === role;
}

module.exports = { parsePath, canRead, canWrite };
