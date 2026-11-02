/* Stands in for the artifact runtime on our own server: same window.claude.use('db'|'user'|'downloads') calls, backed by /api. */
(() => {
  async function call(url, opts) {
    const r = await fetch(url, { credentials: 'same-origin', ...opts });
    if (r.ok) return r.status === 204 ? null : r.json();
    if (r.status === 401) location.reload();   // the session ended, for example a new password on another device
    const body = await r.json().catch(() => ({}));
    const e = new Error(body.error || 'Lỗi máy chủ');
    e.code = r.status;
    if (r.status < 500) e.userMsg = body.error;
    throw e;
  }
  const json = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const docUrl = path => '/api/doc?path=' + encodeURIComponent(path);
  const doc = path => ({
    id: path.split('/').pop(),
    path,
    async get() { const { exists, data } = await call(docUrl(path)); return { exists, data: () => data, metadata: {} }; },
    set: data => call(docUrl(path), json('PUT', data)),
  });
  const db = { doc, collection: p => ({ doc: id => doc(p + '/' + id) }) };

  /* The password never leaves the browser. The server checks a proof derived from it with its own salt, kept apart from the
   * key that opens the data, so the server still cannot read anything with what it stores. Must match passwordProof() in app.js. */
  async function proofOf(password, salt) {
    const prefix = new TextEncoder().encode('gvg-auth:'), raw = Uint8Array.from(atob(salt), c => c.charCodeAt(0));
    const salted = new Uint8Array(prefix.length + raw.length);
    salted.set(prefix);
    salted.set(raw, prefix.length);
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salted, iterations: 210000, hash: 'SHA-256' }, base, 256);
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const user = {
    isOwner: () => true,   // only used to offer first-time setup and hide a Claude-account warning; the server enforces the rules
    id: async () => 'self',
    can: () => true,
    canEdit: () => true,
    async login(username, password, keep) {
      const { salt } = await call('/api/salt', json('POST', { username }));
      const { who } = await call('/api/login', json('POST', { username, proof: await proofOf(password, salt), keep }));
      return who;
    },
    signOut: () => call('/api/logout', { method: 'POST' }).catch(() => {}),
    me: async () => (await call('/api/me')).who,
    accounts: () => call('/api/accounts'),
    /* username is left out when staff change their own password */
    async setAccount(who, { username, password, keep }) {
      const salt = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      await call('/api/accounts/' + who, json('PUT', { username, salt, proof: await proofOf(password, salt), keep }));
    },
    async recoveryKey() {
      const { key } = await call('/api/recovery-key');
      const raw = Uint8Array.from(key.match(/../g), h => parseInt(h, 16));
      return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    },
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
