/* Stands in for the artifact runtime on our own server: same window.claude.use('db'|'user'|'downloads') calls, backed by /api. */
(() => {
  async function call(url, opts) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    if (r.ok) return r.status === 204 ? null : r.json();
    const body = await r.json().catch(() => ({}));
    if (body.error === 'door') location.assign('/door');
    const e = new Error(body.error || 'Lỗi máy chủ');
    e.code = r.status;
    throw e;
  }
  const docUrl = path => '/api/doc?path=' + encodeURIComponent(path);
  const doc = path => ({
    id: path.split('/').pop(),
    path,
    async get() { const { exists, data } = await call(docUrl(path)); return { exists, data: () => data, metadata: {} }; },
    set: data => call(docUrl(path), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  });
  const db = { doc, collection: p => ({ doc: id => doc(p + '/' + id) }) };

  /* The password never leaves the browser, so the server cannot check it. Instead each person proves they hold their data
   * key with a token derived from it, and the owner with one derived from all the keys, which only the owner can open.
   * The keys do not change with a password, so a password change needs nothing from the server. */
  async function token(raw) {
    const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode('gvg-server-auth'));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const concat = arrays => {
    const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
    arrays.reduce((at, a) => (out.set(a, at), at + a.length), 0);
    return out;
  };
  const user = {
    isOwner: () => true,   // only used to offer first-time setup and hide a Claude-account warning; the server enforces the rules
    id: async () => 'self',
    can: () => true,
    canEdit: () => true,
    async signIn(who, dkRaw) {
      const ids = Object.keys(dkRaw).sort(), tokens = {};
      for (const id of ids) tokens[id] = await token(dkRaw[id]);
      if (who === 'owner') tokens.owner = await token(concat(ids.map(id => dkRaw[id])));
      await call('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who, tokens }) });
    },
    signOut: () => call('/api/logout', { method: 'POST' }).catch(() => {}),
  };

  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      const a = Object.assign(document.createElement('a'), { href: url, download: filename });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return { status: 'saved' };
    },
  };

  const caps = { db, user, downloads };
  window.claude = { use: async name => caps[name] || null };
})();
