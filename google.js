// Login Google (Google Identity Services, token di browser), panggilan Sheets/Drive API, dan Google Picker.
// Tidak ada server: semua permintaan langsung dari HP ke Google memakai token milik pengguna.
// Izin hanya drive.file: app cuma bisa membuka file yang dibuatnya sendiri atau yang dipilih pengguna lewat Picker.
(function () {
  const C = window.HL_CONFIG;
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const TK = 'hl_tok';
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const enc = encodeURIComponent;

  let client = null, waiter = null, tok = null, exp = 0;
  // token disimpan di HP sampai kedaluwarsa (±1 jam), supaya buka-tutup app tidak minta login terus
  try { const t = JSON.parse(localStorage.getItem(TK) || 'null'); if (t && t.exp > Date.now()) { tok = t.tok; exp = t.exp; } } catch (e) {}

  class AuthError extends Error { constructor(msg) { super(msg || 'Perlu masuk ke Google lagi'); this.code = 'auth'; } }

  function waitFor(test, ms, msg) {
    return new Promise((res, rej) => {
      const t0 = Date.now();
      (function poll() {
        if (test()) return res();
        if (Date.now() - t0 > ms) return rej(new Error(msg));
        setTimeout(poll, 100);
      })();
    });
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      const old = document.querySelector(`script[src="${src}"]`);
      if (old && old.dataset.ok) return res();
      const s = old || document.createElement('script');
      s.src = src; s.async = true;
      s.addEventListener('load', () => { s.dataset.ok = '1'; res(); });
      s.addEventListener('error', () => rej(new Error('Tidak ada koneksi internet')));
      if (!old) document.head.appendChild(s);
    });
  }

  async function init() {
    if (client) return;
    await loadScript('https://accounts.google.com/gsi/client');
    await waitFor(() => window.google && google.accounts && google.accounts.oauth2, 15000, 'Login Google gagal dimuat. Cek koneksi internet.');
    client = google.accounts.oauth2.initTokenClient({
      client_id: C.clientId,
      scope: SCOPE,
      callback: r => {
        const w = waiter; waiter = null;
        if (r.error) return w && w.reject(new AuthError(r.error_description || r.error));
        if (!google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE))
          return w && w.reject(new AuthError('Centang izin Google Drive supaya Hutang Lu bisa menyimpan data.'));
        tok = r.access_token; exp = Date.now() + (Number(r.expires_in) - 60) * 1000;
        try { localStorage.setItem(TK, JSON.stringify({ tok, exp })); } catch (e) {}
        w && w.resolve(tok);
      },
      error_callback: e => {
        const w = waiter; waiter = null;
        const t = e && e.type;
        w && w.reject(Object.assign(new AuthError(t === 'popup_closed' ? 'Login dibatalkan' : t === 'popup_failed_to_open' ? 'Jendela login diblokir. Ketuk lagi.' : 'Login gagal'), { type: t }));
      }
    });
  }

  // Panggil langsung dari ketukan pengguna supaya jendela login tidak diblokir browser.
  async function signIn({ prompt = '', hint = '' } = {}) {
    await init();
    if (waiter) waiter.reject(new AuthError('Login dibatalkan'));
    return new Promise((resolve, reject) => {
      waiter = { resolve, reject };
      const o = { prompt };
      const h = hint || (localStorage.getItem('hl_email') || '');
      if (h) o.login_hint = h;
      client.requestAccessToken(o);
    });
  }
  const token = () => (tok && Date.now() < exp ? tok : null);
  function forget() { tok = null; exp = 0; try { localStorage.removeItem(TK); } catch (e) {} }
  function signOut() {
    const t = tok; forget();
    if (t && window.google && google.accounts && google.accounts.oauth2) try { google.accounts.oauth2.revoke(t, () => {}); } catch (e) {}
  }

  async function api(url, { method = 'GET', body } = {}) {
    const t = token();
    if (!t) throw new AuthError();
    let r;
    try {
      r = await fetch(url, { method, headers: Object.assign({ Authorization: 'Bearer ' + t }, body ? { 'Content-Type': 'application/json' } : {}),
                             body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new Error('Tidak ada koneksi internet'); }
    if (r.status === 401) { forget(); throw new AuthError(); }
    if (!r.ok) {
      let m = String(r.status);
      try { const j = await r.json(); m = (j.error && j.error.message) || m; } catch (e) {}
      if (r.status === 404) m = 'Sheet tidak ditemukan atau aksesnya sudah dicabut';
      if (r.status === 403 && /insufficient|permission/i.test(m)) m = 'Tidak punya akses ke sheet ini';
      throw Object.assign(new Error(m), { status: r.status });
    }
    return r.status === 204 ? null : r.json();
  }

  // ---------- Google Picker: pilih sheet yang sudah ada / buka undangan ----------
  async function pick({ fileId = '', title = '' } = {}) {
    if (!token()) throw new AuthError();
    await loadScript('https://apis.google.com/js/api.js');
    await waitFor(() => window.gapi && gapi.load, 10000, 'Google Picker gagal dimuat');
    await new Promise((res, rej) => gapi.load('picker', { callback: res, onerror: () => rej(new Error('Google Picker gagal dimuat')) }));
    return new Promise(res => {
      const P = google.picker;
      const sv = () => new P.DocsView(P.ViewId.SPREADSHEETS).setMode(P.DocsViewMode.LIST);
      const pb = new P.PickerBuilder()
        .setOAuthToken(token()).setDeveloperKey(C.apiKey).setAppId(C.appId)
        .setOrigin(location.protocol + '//' + location.host)
        .setLocale('id').setTitle(title || 'Pilih sheet');
      if (fileId) pb.addView(sv().setFileIds(fileId)).enableFeature(P.Feature.NAV_HIDDEN);
      else {
        // sheet bisa milik akun lain (misalnya dibuat pasangan, atau akun Google kedua) asal dibagikan ke akun ini
        const mine = sv().setOwnedByMe(true), shared = sv().setOwnedByMe(false);
        if (mine.setLabel) { mine.setLabel('Milikku'); shared.setLabel('Dibagikan ke saya'); }
        pb.addView(mine).addView(shared);
      }
      pb
        .setCallback(d => {
          if (d.action === P.Action.PICKED) res(d.docs[0]);
          else if (d.action === P.Action.CANCEL) res(null);
        })
        .build().setVisible(true);
    });
  }

  window.HLG = {
    AuthError, init, signIn, signOut, token, forget, api, pick,
    me: () => api(`${DRIVE}/about?fields=user(emailAddress,displayName)`)
      .then(r => ({ email: String(r.user.emailAddress || '').toLowerCase(), name: r.user.displayName || '' })),
    findSheets: () => api(`${DRIVE}/files?q=${enc("appProperties has { key='app' and value='hutanglu' } and trashed=false")}` +
                          `&fields=files(id,name,modifiedTime,ownedByMe,owners(displayName))&orderBy=modifiedTime desc&spaces=drive`).then(r => r.files || []),
    fileInfo: id => api(`${DRIVE}/files/${enc(id)}?fields=id,name,appProperties,trashed,capabilities(canEdit,canShare)`),
    createSheet: name => api(`${DRIVE}/files?fields=id,name`, { method: 'POST',
      body: { name, mimeType: 'application/vnd.google-apps.spreadsheet', appProperties: { app: 'hutanglu' } } }),
    tagSheet: id => api(`${DRIVE}/files/${enc(id)}?fields=id`, { method: 'PATCH', body: { appProperties: { app: 'hutanglu' } } }),
    share: (id, email, msg) => api(`${DRIVE}/files/${enc(id)}/permissions?sendNotificationEmail=true&emailMessage=${enc(msg)}&fields=id`,
      { method: 'POST', body: { type: 'user', role: 'writer', emailAddress: email } }),
    meta: id => api(`${SHEETS}/${enc(id)}?fields=properties.title,sheets.properties(sheetId,title)`),
    get: (id, ranges) => api(`${SHEETS}/${enc(id)}/values:batchGet?${ranges.map(r => 'ranges=' + enc(r)).join('&')}` +
                             `&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`),
    append: (id, tab, rows) => api(`${SHEETS}/${enc(id)}/values/${enc(tab + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values: rows } }),
    put: (id, data) => api(`${SHEETS}/${enc(id)}/values:batchUpdate`, { method: 'POST', body: { valueInputOption: 'RAW', data } }),
    batch: (id, requests) => api(`${SHEETS}/${enc(id)}:batchUpdate`, { method: 'POST', body: { requests } })
  };
})();
