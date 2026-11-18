// Data Hutang Lu langsung di sheet "Debt Tracker" (format yang sama sejak awal, tanpa tab/kolom tambahan).
// UI memanggil fungsi di sini lewat API.run.fungsi(...), bentuk datanya sama dengan versi Apps Script.
//
// Tab "Debt Tracker", baris 1 = judul:
//   A Date | B Description | C Paid By | D <A> Items | E <B> Items | F Fee | G Total | H <A> Share | I <B> Share | J Status
//   H & I berisi rumus (sama dengan versi lama); "Paid" di kolom J = lunas.
//   Nama dua orang (slot 'A' dan 'B') diambil dari judul kolom H & I, misalnya "Dimbo Share".
// Tab "Summary": rumus ringkasan untuk dibaca di sheet (app menghitung sendiri).
// Data app yang tidak perlu terlihat (email anggota, kategori manual, riwayat pelunasan, foto) disimpan sebagai
// developer metadata di dalam file: tidak muncul sebagai tab, baris, atau kolom.
(function () {
  const G = window.HLG;
  const TAB = 'Debt Tracker', SUM = 'Summary';
  const Q = t => `'${t}'`;
  const V2_TABS = ['Transaksi', 'Anggota', 'Pelunasan', 'Kategori', 'Meta'];     // tab percobaan v2.0–2.2 (dihapus)
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONF = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const RECENT = 8;

  let SID = null, DB = null, META = null, ME = '';
  try { SID = localStorage.getItem('hl_sid'); } catch (e) {}

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '').replace(',', '.')) || 0);
  const r2 = v => Math.round(v * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoOf(new Date());
  const label = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  // tanggal sheet = nomor seri (hari sejak 30 Des 1899)
  const BASE = Date.UTC(1899, 11, 30);
  const serialToIso = n => { const d = new Date(BASE + Math.floor(n) * 864e5); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
  const isoToSerial = iso => { const [y, m, d] = iso.split('-').map(Number); return Math.round((Date.UTC(y, m - 1, d) - BASE) / 864e5); };
  const stale = () => new Error('Data di sheet sudah berubah. Tarik ulang lalu coba lagi.');
  const rowKey = (iso, desc, by) => [iso, String(desc).trim(), String(by).trim()].join('|');   // sama dengan versi Apps Script

  // ---------- Kategori (sama dengan CATS di index.html) ----------
  const CATS = [
    ['Transport', /go ?car|gojek|go ?ride|grab|krl|mrt|lrt|taxi|taksi|bluebird|bensin|parkir|ojek|maxim|tol\b/i],
    ['Olahraga', /renang|kolam|gym|fitness|futsal|badminton|bulu ?tangkis|yoga|pilates|padel|tenis|basket|lari\b/i],
    ['Kesehatan', /apotek|apotik|kimia farma|k24|century|dokter|klinik|rumah sakit|\brs\b|obat|vitamin|halodoc|lab\b/i],
    ['Belanja', /alfa|indomaret|astro|superindo|hypermart|natureline|avoskin|masker|galon|formula|shopee|tokopedia|lazada|guardian|watson|speedo|baju|kaos|celana|sepatu|sandal|uniqlo|h&m|zara|decathlon|sport|tas\b/i],
    ['Hiburan', /cinepolis|xxi|cgv|bioskop|goldie|fun world|aquarium|popcorn|timezone|karaoke/i]
  ];
  const CAT_NAMES = ['Makan & minum', 'Transport', 'Belanja', 'Hiburan', 'Olahraga', 'Kesehatan', 'Lainnya'];
  const ADJ = /^(Kelebihan bayar|Sisa pelunasan)\b/i;
  const catKey = d => String(d || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const autoCat = desc => { for (const [n, re] of CATS) if (re.test(desc)) return n; return 'Makan & minum'; };
  const cat = desc => md('hl_cat', {})[catKey(desc)] || autoCat(desc);

  // ---------- Developer metadata (data app tersembunyi) ----------
  // lokasi: hl_members, hl_cat, hl_cids → spreadsheet; hl_log → tab Debt Tracker; hl_photo_A/B → tab Summary
  function readMeta(m) {
    const out = { title: m.properties.title, tabs: {}, md: {} };
    const take = (list, loc) => (list || []).forEach(x => {
      if (!/^hl_/.test(x.metadataKey)) return;
      let v = x.metadataValue; try { v = JSON.parse(v); } catch (e) {}
      out.md[x.metadataKey] = { id: x.metadataId, value: v, loc };
    });
    take(m.developerMetadata, 'ss');
    (m.sheets || []).forEach(s => {
      const p = s.properties;
      out.tabs[p.title] = { id: p.sheetId, rows: (p.gridProperties && p.gridProperties.rowCount) || 1000 };
      take(s.developerMetadata, p.title);
    });
    return out;
  }
  const md = (k, def) => (META && META.md[k] ? META.md[k].value : def);
  const mdLoc = k => (/^hl_log$/.test(k) ? TAB : /^hl_photo_/.test(k) ? (META.tabs[SUM] ? SUM : 'ss') : 'ss');
  function mdReq(k, value) {
    const v = JSON.stringify(value), cur = META.md[k];
    if (cur) return { updateDeveloperMetadata: { dataFilters: [{ developerMetadataLookup: { metadataId: cur.id } }], developerMetadata: { metadataValue: v }, fields: 'metadataValue' } };
    const loc = mdLoc(k);
    return { createDeveloperMetadata: { developerMetadata: { metadataKey: k, metadataValue: v, visibility: 'DOCUMENT',
      location: loc === 'ss' ? { spreadsheet: true } : { sheetId: META.tabs[loc].id } } } };
  }
  async function setMd(obj) {
    const req = Object.keys(obj).map(k => mdReq(k, obj[k]));
    if (req.length) await G.batch(SID, req);
  }

  // ---------- Baca semua data ----------
  function namesFrom(head, rows) {
    const strip = c => String(head[c] || '').replace(/\b(share|items?|bagian)\b/ig, '').trim();
    let a = strip(7) || strip(3), b = strip(8) || strip(4);
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) {
      const seen = [];
      rows.forEach(x => { const n = String(x[2] || '').trim(); if (n && seen.indexOf(n) < 0) seen.push(n); });
      a = seen[0] || 'Orang 1'; b = seen[1] || 'Orang 2';
    }
    return [a, b];
  }
  async function load() {
    if (!SID) throw Object.assign(new Error('Belum tersambung ke sheet'), { code: 'nosheet' });
    const [m, r] = await Promise.all([G.meta(SID), G.get(SID, [Q(TAB) + '!A1:J1', Q(TAB) + '!A2:J'])]);
    META = readMeta(m);
    if (!META.tabs[TAB]) throw new Error(`Sheet "${META.title}" tidak punya tab "${TAB}"`);
    const head = (r.valueRanges[0].values || [])[0] || [];
    const rows = r.valueRanges[1].values || [];
    const names = namesFrom(head, rows);
    const slotOf = n => { n = String(n || '').trim().toLowerCase(); return n === names[0].toLowerCase() ? 'A' : n === names[1].toLowerCase() ? 'B' : ''; };
    const tx = [];
    let last = 1;
    rows.forEach((x, i) => {
      const by = String(x[2] || '').trim();
      if (by) last = i + 2;
      const s = slotOf(by);
      if (!s || typeof x[0] !== 'number') return;
      const date = serialToIso(x[0]), desc = String(x[1] || '').trim();
      tx.push({ row: i + 2, key: rowKey(date, desc, by), date, desc, byName: by, by: s,
                D: num(x[3]), E: num(x[4]), F: num(x[5]), G: num(x[6]), H: num(x[7]), I: num(x[8]), paid: String(x[9] || '').trim() !== '' });
    });
    DB = { names, tx, last, gridRows: META.tabs[TAB].rows };
    return DB;
  }

  // ---------- Bantuan per transaksi ----------
  const owed = t => (t.by === 'B' ? t.H : t.I);           // B bayar → bagian A (kolom H) jadi utang A, dan sebaliknya
  const findRow = (row, key) => {                           // utamakan nomor baris; kalau sudah bergeser, cari dari isinya
    const t = DB.tx.find(x => x.row === Number(row) && x.key === key);
    return t || DB.tx.find(x => x.key === key && !x.paid) || null;
  };
  const raw = t => ({ date: t.date, desc: t.desc, by: t.by, D: t.D, E: t.E, F: t.F, G: t.G, H: t.H, I: t.I });
  const txRow = t => ({ row: t.row, key: t.key, date: label(t.date), desc: t.desc, by: t.by, paid: t.paid, ym: t.date.slice(0, 7), raw: raw(t) });
  function verify(t) {
    if (!t) throw stale();
    if (t.paid) throw new Error('Transaksi ini sudah lunas, batalkan pelunasannya dulu.');
  }

  // Isi kolom A–I untuk satu baris (rumus H & I sama persis dengan sheet lama)
  function cells(e, r) {
    if (!e || !e.desc || !e.by || !e.date) throw new Error('Data belum lengkap');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('Tanggal tidak valid');
    if (e.by !== 'A' && e.by !== 'B') throw new Error('Pembayar tidak valid');
    const name = DB.names[e.by === 'A' ? 0 : 1];
    const desc = String(e.desc).trim().slice(0, 120).replace(/^[=+\-@']/, "'$&");   // jangan terbaca sebagai rumus
    const fH = `=IF(C${r}="","",IFERROR((F${r}/2) + ((D${r}/(D${r}+E${r})) * (G${r}-F${r})), 0))`;
    const fI = `=IF(C${r}="","",IF(G${r}>0, G${r}-H${r}, 0))`;
    if (e.mode === 'split') {
      const d = Number(e.dimbo) || 0, de = Number(e.delpus) || 0, fee = Number(e.fee) || 0, total = Number(e.total) || 0;
      if (d + de <= 0) throw new Error('Isi minimal satu item');
      if (total <= 0) throw new Error('Total bayar belum diisi');
      return [isoToSerial(e.date), desc, name, d || '', de || '', fee || '', total, fH, fI];
    }
    const amt = Number(e.amount) || 0;
    if (amt <= 0) throw new Error('Nominal belum diisi');
    return [isoToSerial(e.date), desc, name, '', '', '', '', e.by === 'B' ? amt : fH, e.by === 'A' ? amt : fI];
  }
  const fmtCopy = (from, to) => ({ copyPaste: {
    source: { sheetId: META.tabs[TAB].id, startRowIndex: from - 1, endRowIndex: from, startColumnIndex: 0, endColumnIndex: 10 },
    destination: { sheetId: META.tabs[TAB].id, startRowIndex: to - 1, endRowIndex: to, startColumnIndex: 0, endColumnIndex: 10 },
    pasteType: 'PASTE_FORMAT' } });
  // tulis baris baru di bawah data terakhir; kembalikan nomor baris pertamanya
  async function appendRows(list) {
    const r = DB.last + 1;
    const need = r + list.length - 1 - DB.gridRows, req = [];
    if (need > 0) req.push({ appendDimension: { sheetId: META.tabs[TAB].id, dimension: 'ROWS', length: need + 50 } });
    if (DB.last >= 2) list.forEach((_, i) => req.push(fmtCopy(DB.last, r + i)));
    if (req.length) await G.batch(SID, req);
    await G.put(SID, list.map((e, i) => ({ range: `${Q(TAB)}!A${r + i}:I${r + i}`, values: [cells(e, r + i)] })));
    DB.last += list.length; DB.gridRows = Math.max(DB.gridRows, DB.last);
    return r;
  }
  async function deleteRows(rows) {
    const req = rows.slice().sort((a, b) => b - a)
      .map(r => ({ deleteDimension: { range: { sheetId: META.tabs[TAB].id, dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }));
    if (req.length) await G.batch(SID, req);
  }

  // ---------- Beranda ----------
  function monthInfo() {
    const now = new Date(), cur = isoOf(now).slice(0, 7), prev = isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const m = { total: 0, n: 0, prev: 0, del: 0, dim: 0 };
    DB.tx.forEach(t => {
      if (ADJ.test(t.desc)) return;
      const a = owed(t); if (a <= 0) return;
      const k = t.date.slice(0, 7);
      if (k === cur) { m.total += a; m.n++; m[t.by === 'B' ? 'del' : 'dim'] += a; }
      else if (k === prev) m.prev += a;
    });
    m.del = Math.round(m.del); m.dim = Math.round(m.dim);
    return m;
  }
  function suggest() {
    const m = {};
    DB.tx.slice(-150).forEach(t => {
      if (t.G > 0 || ADJ.test(t.desc)) return;
      const a = owed(t); if (a <= 0) return;
      const k = catKey(t.desc), x = m[k] || (m[k] = { desc: t.desc, n: 0 });
      x.n++; x.by = t.by; x.amount = a; x.desc = t.desc;
    });
    return Object.values(m).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6).map(x => ({ desc: x.desc, by: x.by, amount: x.amount }));
  }
  function members() {
    const em = md('hl_members', {});
    return DB.names.map((n, i) => { const k = i ? 'B' : 'A'; return { key: k, id: k, name: n, email: String(em[k] || '') }; });
  }
  const photoVer = () => { const v = s => { const p = md('hl_photo_' + s, null); return p && p.v ? String(p.v) : '0'; }; return { A: v('A'), B: v('B') }; };
  function info() {
    let a = 0;                                   // > 0: A utang ke B
    DB.tx.forEach(t => { if (!t.paid) a += (t.by === 'B' ? 1 : -1) * owed(t); });
    a = Math.round(a);
    return {
      recent: DB.tx.slice(-RECENT).reverse().map(txRow),
      month: monthInfo(), suggest: suggest(), catMap: md('hl_cat', {}),
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SID + '/edit',
      photoVer: photoVer(),
      summary: { netA: Math.max(0, a), netB: Math.max(0, -a) },
      members: members()
    };
  }

  // ---------- Transaksi ----------
  async function addEntry(e) {
    await load();
    const cids = md('hl_cids', []);
    if (e.cid && !e.editKey && cids.indexOf(String(e.cid)) >= 0) return { dup: true, edited: false, info: info() };
    let row;
    if (e.editKey) {
      const t = findRow(e.editRow, String(e.editKey)); verify(t);
      row = t.row;
      await G.put(SID, [{ range: `${Q(TAB)}!A${row}:I${row}`, values: [cells(e, row)] }]);
    } else row = await appendRows([e]);
    const mdw = {};
    if (e.cid && !e.editKey) mdw.hl_cids = cids.concat([String(e.cid).slice(0, 40)]).slice(-60);
    if (e.cat) { const c = setCatMap(e.desc, e.cat); if (c) mdw.hl_cat = c; }
    await setMd(mdw);
    await load();
    const t = DB.tx.find(x => x.row === row);
    return { row, key: t ? t.key : '', edited: !!e.editKey, info: info() };
  }
  // batal hapus: kembalikan ke posisi barisnya semula
  async function restoreEntry(e) {
    await load();
    const r = Number(e.row) || 0;
    if (r >= 2 && r <= DB.last) {
      await G.batch(SID, [{ insertDimension: { range: { sheetId: META.tabs[TAB].id, dimension: 'ROWS', startIndex: r - 1, endIndex: r }, inheritFromBefore: r > 2 } }, fmtCopy(r + 1, r)]);
      await G.put(SID, [{ range: `${Q(TAB)}!A${r}:I${r}`, values: [cells(e, r)] }]);
    } else await appendRows([e]);
    await load();
    return { info: info() };
  }
  async function deleteEntry(row, key) {
    await load();
    const t = findRow(row, String(key)); verify(t);
    await deleteRows([t.row]);
    await load();
    return { info: info() };
  }
  async function getInfo() { await load(); return info(); }
  async function getHistory() { await load(); return DB.tx.slice().reverse().map(txRow); }

  // ---------- Kategori manual (per keterangan) ----------
  function setCatMap(desc, name) {
    const k = catKey(desc); if (!k) return null;
    if (name && CAT_NAMES.indexOf(name) < 0) throw new Error('Kategori tidak dikenal');
    const m = Object.assign({}, md('hl_cat', {}));
    if (!name || name === autoCat(desc)) delete m[k]; else m[k] = name;
    if (JSON.stringify(m).length > 20000) throw new Error('Kategori manual sudah terlalu banyak');
    return m;
  }
  async function setCategory(desc, name) {
    await load();
    const m = setCatMap(desc, name);
    if (m) await setMd({ hl_cat: m });
    await load();
    return { catMap: md('hl_cat', {}) };
  }

  // ---------- Pelunasan ----------
  // Yang ditandai lunas selalu transaksi TERLAMA dulu; dua arah saling mengurangi.
  // Selisih transfer jadi baris baru: lebih bayar → "Kelebihan bayar", kurang → "Sisa pelunasan".
  // Riwayat pelunasan (maks 10) di metadata; hanya yang terakhir bisa dibatalkan.
  function settleData() {
    const rows = DB.tx.filter(t => !t.paid).map(t => ({ row: t.row, key: t.key, date: t.date, label: label(t.date), desc: t.desc, by: t.by, amt: r2(owed(t)) }));
    const log = md('hl_log', []).slice(-5).reverse().map(l => ({ row: l.id, payer: l.payer, paid: l.paid, n: l.n, diff: l.diff,
      when: l.t ? label(isoOf(new Date(l.t))) : '' }));
    return { rows, log };
  }
  async function getSettle() { await load(); return settleData(); }
  async function settle(p) {
    await load();
    if (!p || (p.payer !== 'A' && p.payer !== 'B')) throw new Error('Pembayar tidak valid');
    const amount = Math.round(Number(p.amount) || 0);
    if (amount <= 0) throw new Error('Nominal belum diisi');
    const to = p.payer === 'A' ? 'B' : 'A';
    const list = (p.rows || []).map(x => findRow(x.row, String(x.key)));
    let net = 0, last = '';
    list.forEach(t => { verify(t); net += (t.by === p.payer ? -1 : 1) * owed(t); if (t.date >= last) last = t.date; });
    net = Math.round(net);
    if (Math.abs(net - Math.round(Number(p.cover) || 0)) > 1) throw stale();
    if (list.length) await G.put(SID, list.map(t => ({ range: `${Q(TAB)}!J${t.row}`, values: [['Paid']] })), true);
    const diff = amount - net;
    let adj = null;
    if (Math.abs(diff) >= 1) {
      const e = diff > 0 ? { mode: 'direct', date: todayIso(), desc: 'Kelebihan bayar', by: p.payer, amount: diff }
                         : { mode: 'direct', date: todayIso(), desc: 'Sisa pelunasan', by: to, amount: -diff };
      const r = await appendRows([e]);
      adj = [r, rowKey(e.date, e.desc, DB.names[e.by === 'A' ? 0 : 1])];
    }
    const id = uid();
    const log = md('hl_log', []).concat([{ id, t: Date.now(), payer: p.payer, paid: amount, cover: net, diff, n: list.length,
      until: last ? label(last) : '', rows: list.map(t => [t.row, t.key]), adj }]).slice(-10);
    await setMd({ hl_log: log });
    await load();
    return { info: info(), settle: settleData(), net, diff };
  }
  async function undoSettle(id) {
    await load();
    const log = md('hl_log', []), lastLog = log[log.length - 1];
    if (!lastLog) throw new Error('Belum ada pelunasan');
    if (String(id) !== String(lastLog.id) || !lastLog.rows) throw new Error('Hanya pelunasan terakhir yang bisa dibatalkan');
    const used = {};
    const find = (row, key, paid) => {
      const ok = t => !used[t.row] && t.key === key && t.paid === paid;
      const t = DB.tx.find(x => x.row === row && ok(x)) || DB.tx.find(ok);
      if (t) used[t.row] = 1;
      return t;
    };
    const targets = lastLog.rows.map(([r, k]) => find(r, k, true)).filter(Boolean);
    if (targets.length) await G.put(SID, targets.map(t => ({ range: `${Q(TAB)}!J${t.row}`, values: [['']] })), true);
    if (lastLog.adj) { const a = find(lastLog.adj[0], lastLog.adj[1], false); if (a) await deleteRows([a.row]); }
    await setMd({ hl_log: log.slice(0, -1) });
    await load();
    return { info: info(), settle: settleData(), restored: targets.length };
  }

  // ---------- Statistik ----------
  const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  async function getStats(ym) {
    await load();
    const today = new Date(), ALL = ym === 'all';
    const sel = ALL ? ymOf(today) : /^\d{4}-\d{2}$/.test(ym || '') ? ym : ymOf(today);
    const [sy, sm] = sel.split('-').map(Number);
    const shift = k => ymOf(new Date(sy, sm - 1 + k, 1));
    const win = [shift(-2), shift(-1), sel], prevKey = shift(-1);
    const inWin = k => ALL || win.indexOf(k) >= 0;
    const blank = () => ({ del: 0, dim: 0, nDel: 0, nDim: 0 });
    const months = {}, places = {}, cats = {};
    let first = null, lastK = null, count = 0, winTotal = 0;
    DB.tx.forEach((t, i) => {
      if (!t.desc || ADJ.test(t.desc)) return;
      const amt = owed(t); if (amt <= 0) return;
      count++;
      const k = t.date.slice(0, 7);
      if (!first || k < first) first = k;
      if (!lastK || k > lastK) lastK = k;
      const m = months[k] || (months[k] = blank());
      if (t.by === 'B') { m.del += amt; m.nDel++; } else { m.dim += amt; m.nDim++; }
      if (!inWin(k)) return;
      winTotal += amt;
      const key = catKey(t.desc), p = places[key] || (places[key] = { name: t.desc, n: 0, total: 0 });
      p.n++; p.total += amt;
      const c = cat(t.desc), cc = cats[c] || (cats[c] = { total: 0, items: [] });
      const [, mm, dd] = t.date.split('-').map(Number);
      cc.total += amt; cc.items.push([t.date + String(i).padStart(6, '0'), dd + ' ' + MON[mm - 1], t.desc, t.by, amt]);
    });
    if (!count) return { empty: true };
    const lbl = k => MON[Number(k.split('-')[1]) - 1];
    const full = k => { const [y, mm] = k.split('-').map(Number); return MONF[mm - 1] + ' ' + y; };
    const catsOut = Object.keys(cats).map(k => ({ name: k, total: cats[k].total, n: cats[k].items.length,
      items: cats[k].items.sort((a, b) => a[0] < b[0] ? 1 : -1).map(x => x.slice(1)) })).sort((a, b) => b.total - a.total);
    const placesOut = Object.values(places).sort((a, b) => b.n - a.n || b.total - a.total).slice(0, 5);
    if (ALL) {
      const keys = [];
      for (let [y, mm] = first.split('-').map(Number); `${y}-${pad(mm)}` <= lastK; mm === 12 ? (y++, mm = 1) : mm++) keys.push(`${y}-${pad(mm)}`);
      const tot = keys.reduce((a, k) => { const m = months[k]; if (m) { a.del += m.del; a.dim += m.dim; a.nDel += m.nDel; a.nDim += m.nDim; } return a; }, blank());
      const l2 = k => { const [y, mm] = k.split('-').map(Number); return MON[mm - 1] + ' ' + String(y).slice(2); };
      return { ym: 'all', all: true, title: 'Semua waktu', winLabel: l2(keys[0]) + ' – ' + l2(keys[keys.length - 1]), winTotal, nMonths: keys.length,
               cur: Object.assign({ label: 'Semua' }, tot), prev: Object.assign({ label: '' }, blank()),
               months: keys.map(k => Object.assign({ key: k, label: l2(k) }, months[k] || blank())), places: placesOut, cats: catsOut };
    }
    return { ym: sel, title: full(sel), minYm: first, maxYm: ymOf(today) > lastK ? ymOf(today) : lastK, prevYm: prevKey, nextYm: shift(1),
             winLabel: lbl(win[0]) + '–' + lbl(win[2]), winTotal,
             cur: Object.assign({ label: lbl(sel) }, months[sel] || blank()), prev: Object.assign({ label: lbl(prevKey) }, months[prevKey] || blank()),
             months: win.map(k => Object.assign({ key: k, label: lbl(k) }, months[k] || blank())), places: placesOut, cats: catsOut };
  }

  // ---------- Wrapped: rekap setahun ----------
  async function getWrapped(year) {
    await load();
    const y = Number(year) || new Date().getFullYear();
    const W = { year: y, n: 0, total: 0, by: { A: { n: 0, t: 0 }, B: { n: 0, t: 0 } }, months: Array(12).fill(0), mN: Array(12).fill(0),
                dow: Array(7).fill(0), big: null, paid: { n: 0, t: 0 } };
    const places = {}, cats = {}, days = {};
    DB.tx.forEach(t => {
      const [ty, tm, td] = t.date.split('-').map(Number);
      if (ty !== y || !t.desc || ADJ.test(t.desc)) return;
      const amt = owed(t); if (amt <= 0) return;
      const d = new Date(ty, tm - 1, td);
      W.n++; W.total += amt;
      if (t.paid) { W.paid.n++; W.paid.t += amt; }
      W.by[t.by].n++; W.by[t.by].t += amt;
      W.months[tm - 1] += amt; W.mN[tm - 1]++; W.dow[d.getDay()]++;
      days[t.date] = 1;
      const k = catKey(t.desc), p = places[k] || (places[k] = { name: t.desc, n: 0, t: 0 }); p.n++; p.t += amt;
      const c = cat(t.desc), cc = cats[c] || (cats[c] = { name: c, n: 0, t: 0 }); cc.n++; cc.t += amt;
      if (!W.big || amt > W.big.amt) W.big = { desc: t.desc, amt, by: t.by, date: t.date };
    });
    W.days = Object.keys(days).length;
    W.places = Object.values(places).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 3);
    W.cats = Object.values(cats).sort((a, b) => b.t - a.t);
    return W;
  }

  // ---------- Foto profil (metadata, ≤ 12.000 karakter per foto) ----------
  function photos() {
    const out = { photos: {}, ver: {} };
    ['A', 'B'].forEach(s => { const p = md('hl_photo_' + s, null); out.photos[s] = (p && p.u) || ''; out.ver[s] = (p && p.v) ? String(p.v) : '0'; });
    return out;
  }
  async function getPhotos() { await load(); return photos(); }
  async function setPhoto(url, slot) {
    if (url && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 12000)) throw new Error('Foto terlalu besar');
    await load();
    const s = slot || ME;
    if (s !== 'A' && s !== 'B') throw new Error('Akun ini belum terhubung ke anggota');
    await setMd({ ['hl_photo_' + s]: { u: url || '', v: Date.now() } });
    await load();
    return photos();
  }

  // ---------- Scan struk: Gemini dengan API key milik pengguna (disimpan di HP saja) ----------
  const GEM = 'https://generativelanguage.googleapis.com/v1beta/models';
  const PROMPT =
    'Ini foto/screenshot struk atau rincian pesanan (restoran, Gofood, GrabFood, ShopeeFood, minimarket, dll). ' +
    'Ambil: merchant = nama tempat/toko (singkat). date = tanggal transaksi format YYYY-MM-DD, kosongkan kalau tidak ada. ' +
    'items = setiap menu/barang yang dibeli: name (singkat, tanpa catatan pesanan), qty, price = harga total baris itu ' +
    '(qty x harga satuan) SEBELUM diskon. Jangan masukkan ongkir, biaya, pajak, diskon, atau subtotal sebagai item. ' +
    'fee = jumlah semua ongkos kirim + biaya layanan/aplikasi/platform/penanganan/kemasan/pesanan kecil (sesudah potongan ongkir kalau ada). ' +
    'Pajak (PB1/PPN) dan service charge restoran JANGAN dimasukkan ke fee. ' +
    'total = jumlah akhir yang benar-benar dibayar (setelah semua diskon, pajak, dan biaya). ' +
    'Semua angka rupiah bulat tanpa titik (Rp25.000 -> 25000).';
  const SCHEMA_STRUK = { type: 'OBJECT', properties: { merchant: { type: 'STRING' }, date: { type: 'STRING' },
    items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, qty: { type: 'NUMBER' }, price: { type: 'NUMBER' } }, required: ['name', 'price'] } },
    fee: { type: 'NUMBER' }, total: { type: 'NUMBER' } }, required: ['items', 'total'] };
  // kunci Gemini: milik HP ini, atau yang sudah diisi pasangan (tersimpan di metadata sheet bersama)
  const geminiKey = () => { let k = ''; try { k = localStorage.getItem('hl_gemini') || ''; } catch (e) {} return k || String(md('hl_gemini', '') || ''); };
  async function setGeminiKey(k) {
    k = String(k || '').trim();
    try { k ? localStorage.setItem('hl_gemini', k) : localStorage.removeItem('hl_gemini'); localStorage.removeItem('hl_gem_model'); } catch (e) {}
    if (SID) { await load(); await setMd({ hl_gemini: k }); await load(); }
  }
  const ver = n => { const m = n.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
  async function gfetch(url, key, body) {
    let r;
    try { r = await fetch(url, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'x-goog-api-key': key }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { return { code: 0, error: 'Tidak ada koneksi internet' }; }
    let j = null; try { j = await r.json(); } catch (e) {}
    return r.ok ? { code: 200, json: j } : { code: r.status, error: String((j && j.error && j.error.message) || r.status).slice(0, 140) };
  }
  async function models(key) {
    try { const c = JSON.parse(localStorage.getItem('hl_gem_models') || 'null'); if (c && c.t > Date.now() - 6 * 3600e3) return c.list; } catch (e) {}
    const r = await gfetch(GEM + '?pageSize=200', key);
    if (r.code !== 200) return ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];
    const list = (r.json.models || []).filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0)
      .map(m => m.name.replace(/^models\//, '')).filter(n => /flash/i.test(n) && !/(tts|image|audio|live|embedding|exp|preview|latest)/i.test(n));
    list.sort((a, b) => (ver(b) - ver(a)) || (/lite/i.test(a) - /lite/i.test(b)));
    try { localStorage.setItem('hl_gem_models', JSON.stringify({ t: Date.now(), list })); } catch (e) {}
    return list.length ? list : ['gemini-2.5-flash'];
  }
  function clean(o, via) {
    const items = (o.items || []).map(x => { const q = Math.round(Number(x.qty) || 1);
      return { name: (q > 1 ? q + '× ' : '') + String(x.name || '').trim().slice(0, 40), price: Math.round(Number(x.price) || 0) }; }).filter(x => x.price > 0);
    const total = Math.round(Number(o.total) || 0);
    if (!items.length || total <= 0) return { ok: false, code: 0, error: 'Item atau total tidak terbaca' };
    return { ok: true, via, merchant: String(o.merchant || '').trim().slice(0, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(o.date || '') ? o.date : '',
             items, fee: Math.max(0, Math.round(Number(o.fee) || 0)), total };
  }
  async function scanOne(key, model, img, noThink) {
    const gen = { temperature: 0, responseMimeType: 'application/json', responseSchema: SCHEMA_STRUK };
    const think = !noThink && /2\.5/.test(model);
    if (think) gen.thinkingConfig = { thinkingBudget: 0 };
    const r = await gfetch(GEM + '/' + model + ':generateContent', key,
      { contents: [{ parts: [{ text: PROMPT }, { inlineData: { mimeType: img.mime || 'image/jpeg', data: img.data } }] }], generationConfig: gen });
    if (r.code === 400 && think) return scanOne(key, model, img, true);
    if (r.code !== 200) return { ok: false, code: r.code, error: r.error };
    try {
      const parts = (r.json.candidates[0].content.parts || []).filter(p => p.text && !p.thought);
      return clean(JSON.parse(parts[parts.length - 1].text), model);
    } catch (e) { return { ok: false, code: 0, error: 'Hasil Gemini tidak bisa dibaca' }; }
  }
  async function scanReceipt(img) {
    if (G.relay) return G.relayCall('scanReceipt', [img]);          // HP jembatan: scan lewat Apps Script seperti dulu
    const key = geminiKey();
    if (!key) return { ok: false, error: 'Isi kunci Gemini di Pengaturan dulu' };
    if (!img || !img.data) throw new Error('Gambar kosong');
    const t0 = Date.now();
    let list = await models(key);
    const lastM = localStorage.getItem('hl_gem_model');
    if (lastM) list = [lastM].concat(list.filter(m => m !== lastM));
    let res = { ok: false, error: 'Gemini tidak menjawab' };
    for (let i = 0; i < Math.min(3, list.length); i++) {
      if (i > 0 && Date.now() - t0 > 40000) break;
      res = await scanOne(key, list[i], img);
      if (res.ok || [404, 429, 500, 502, 503, 504].indexOf(res.code) < 0) break;
    }
    if (res.ok) { try { localStorage.setItem('hl_gem_model', res.via); } catch (e) {} res.via = 'gemini'; }
    else if (res.code === 400 || res.code === 403) res.error = 'Kunci Gemini tidak valid: ' + res.error;
    return res;
  }

  // ---------- Sambung / buat sheet ----------
  // Bersihkan tab percobaan v2.0–2.2 (kalau ada): transaksi yang sempat dicatat di sana dipindah ke Debt Tracker dulu.
  async function dropV2() {
    const have = V2_TABS.filter(t => META.tabs[t]);
    if (!have.length) return;
    if (META.tabs.Transaksi && META.tabs.Anggota) {
      const r = await G.get(SID, [Q('Transaksi') + '!A2:M', Q('Anggota') + '!A2:C']);
      const mem = {}, em = Object.assign({}, md('hl_members', {}));
      (r.valueRanges[1].values || []).forEach(x => {
        const n = String(x[1] || '').trim().toLowerCase();
        const s = n === DB.names[0].toLowerCase() ? 'A' : n === DB.names[1].toLowerCase() ? 'B' : '';
        if (s) { mem[x[0]] = s; if (x[2] && !em[s]) em[s] = String(x[2]).toLowerCase(); }
      });
      const ids = Object.keys(mem), idA = ids.find(i => mem[i] === 'A'), idB = ids.find(i => mem[i] === 'B');
      const keys = new Set(DB.tx.map(t => t.key));
      const add = [];
      (r.valueRanges[0].values || []).forEach(x => {
        const by = mem[x[3]], date = String(x[1] || '');
        if (!by || !/^\d{4}-\d{2}-\d{2}$/.test(date) || /^impor-/.test(String(x[11] || ''))) return;
        if (keys.has(rowKey(date, String(x[2] || '').trim(), DB.names[by === 'A' ? 0 : 1]))) return;
        let items = {}; try { items = JSON.parse(x[6] || '{}'); } catch (e) {}
        add.push(x[4] === 'patungan'
          ? { mode: 'split', date, desc: x[2], by, dimbo: num(items[idA]), delpus: num(items[idB]), fee: num(x[7]), total: num(x[8]) }
          : { mode: 'direct', date, desc: x[2], by, amount: num(x[5]) });
      });
      if (add.length) await appendRows(add);
      if (JSON.stringify(em) !== JSON.stringify(md('hl_members', {}))) await setMd({ hl_members: em });
    }
    await G.batch(SID, have.map(t => ({ deleteSheet: { sheetId: META.tabs[t].id } })));
    await load();
  }
  async function connect(id) {
    SID = id;
    await load();
    await dropV2();
    try { localStorage.setItem('hl_sid', id); } catch (e) {}
    return DB;
  }
  function whoByEmail(email) {
    const em = md('hl_members', {}), e = String(email || '').toLowerCase();
    return e && em.A === e ? 'A' : e && em.B === e ? 'B' : '';
  }
  async function claim(slot, email) {
    await load();
    const em = Object.assign({}, md('hl_members', {}));
    if (em[slot] && em[slot] !== email) throw new Error('Nama ini sudah dipakai akun Google lain');
    em[slot] = email;
    await setMd({ hl_members: em });
    await load();
  }
  // Sheet baru untuk pengguna baru: desain sama dengan sheet Hutang Lu asli (tabel, warna, dropdown, font Lexend, Summary)
  const RGB = (r, g, b) => ({ red: r, green: g, blue: b });
  const YELLOW = RGB(1, .8980392, .6), BLUE = RGB(.6431373, .7607843, .95686275), GREEN = RGB(.20784314, .40784314, .32941177);
  const BAND2 = RGB(.9647059, .972549, .9764706), WHITE = RGB(1, 1, 1);
  const FONT = { fontFamily: 'Lexend', fontSize: 10 };
  const RP = { type: 'CURRENCY', pattern: '[$Rp ]#,##0' };
  const BORDER = { style: 'SOLID', width: 1, colorStyle: { rgbColor: {} } };
  async function create(names, email) {
    const [a, b] = names.map(n => String(n).trim().slice(0, 24));
    const ROWS = 1000;
    const f = await G.createSheet('Hutang Lu');
    SID = f.id;
    const dt = Object.values(readMeta(await G.meta(SID)).tabs)[0].id;
    const rng = (sid, r0, r1, c0, c1) => Object.assign({ sheetId: sid }, r0 != null ? { startRowIndex: r0, endRowIndex: r1 } : {}, c0 != null ? { startColumnIndex: c0, endColumnIndex: c1 } : {});
    const fmt = (range, format, fields) => ({ repeatCell: { range, cell: { userEnteredFormat: format }, fields: 'userEnteredFormat(' + fields + ')' } });
    const width = (sid, c, px) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'COLUMNS', startIndex: c, endIndex: c + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } });
    const height = (sid, n) => ({ updateDimensionProperties: { range: { sheetId: sid, dimension: 'ROWS', startIndex: 0, endIndex: n }, properties: { pixelSize: 20 }, fields: 'pixelSize' } });
    const heads = ['Date', 'Description', 'Paid By', a + ' Price', b + ' Price', 'Fixed Fee (Split 50/50)', 'Total Paid (Final)', a + ' Share', b + ' Share', 'Paid'];

    // 1. kerangka: nama tab, ukuran, beku, Summary, bahasa formula en_US (rumus memakai koma)
    await G.batch(SID, [
      { updateSpreadsheetProperties: { properties: { locale: 'en_US', timeZone: 'Asia/Jakarta' }, fields: 'locale,timeZone' } },
      { updateSheetProperties: { properties: { sheetId: dt, title: TAB, gridProperties: { frozenRowCount: 1, frozenColumnCount: 2, rowCount: ROWS, columnCount: 10 } },
        fields: 'title,gridProperties.frozenRowCount,gridProperties.frozenColumnCount,gridProperties.rowCount,gridProperties.columnCount' } },
      { addSheet: { properties: { title: SUM, gridProperties: { rowCount: 20, columnCount: 4 } } } }
    ]);
    const sm = readMeta(await G.meta(SID)).tabs[SUM].id;

    // 2. isi: judul kolom + Summary (rumus sama dengan sheet asli)
    const D = Q(TAB);
    await G.put(SID, [
      { range: `${D}!A1:J1`, values: [heads] },
      { range: `${Q(SUM)}!A1:B5`, values: [
        ['Summary', ''],
        [`Utang ${a}`, `=SUMIFS(${D}!$H:$H,${D}!$C:$C,"${b}",${D}!$J:$J,"")`],
        [`Utang ${b}`, `=SUMIFS(${D}!$I:$I,${D}!$C:$C,"${a}",${D}!$J:$J,"")`],
        [`Total Utang ${a}`, '=IF(B2>B3,B2-B3,0)'],
        [`Total Utang ${b}`, '=IF(B2>B3,0,B3-B2)']] }
    ]);

    // 3. tampilan Debt Tracker
    const widths = [102, 205, 119, 145, 145, 225, 186, 157, 159, 99];
    await G.batch(SID, [
      fmt(rng(dt), { textFormat: FONT }, 'textFormat'),
      fmt(rng(dt, 0, 1, 0, 9), { backgroundColorStyle: { rgbColor: YELLOW }, horizontalAlignment: 'CENTER', textFormat: Object.assign({ bold: true }, FONT) }, 'backgroundColorStyle,horizontalAlignment,textFormat'),
      fmt(rng(dt, 0, 1, 1, 2), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'),
      fmt(rng(dt, 0, 1, 7, 9), { backgroundColorStyle: { rgbColor: BLUE } }, 'backgroundColorStyle'),
      fmt(rng(dt, 1, ROWS, 0, 1), { horizontalAlignment: 'CENTER', numberFormat: { type: 'DATE', pattern: 'd" "mmm" "yyyy' } }, 'horizontalAlignment,numberFormat'),
      fmt(rng(dt, 1, ROWS, 3, 9), { horizontalAlignment: 'CENTER', numberFormat: RP }, 'horizontalAlignment,numberFormat'),
      height(dt, ROWS)
    ].concat(widths.map((px, i) => width(dt, i, px))));

    // 4. tabel dengan dropdown & warna selang-seling (kalau API tabel tidak tersedia: pita warna + dropdown biasa)
    try {
      await G.batch(SID, [{ addTable: { table: {
        name: 'HUTANG LU', range: rng(dt, 0, ROWS, 0, 10),
        rowsProperties: { headerColorStyle: { rgbColor: GREEN }, firstBandColorStyle: { rgbColor: WHITE }, secondBandColorStyle: { rgbColor: BAND2 } },
        columnProperties: heads.map((h, i) => Object.assign({ columnIndex: i, columnName: h },
          i === 0 ? { columnType: 'DATE' } : i === 2 ? { columnType: 'DROPDOWN', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: a }, { userEnteredValue: b }] } } }
          : i === 9 ? { columnType: 'DROPDOWN', dataValidationRule: { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Paid' }] } } }
          : i >= 3 ? { columnType: 'CURRENCY' } : {}))
      } } }]);
    } catch (e) {
      const list = (r, vals) => ({ setDataValidation: { range: r, rule: { condition: { type: 'ONE_OF_LIST', values: vals.map(v => ({ userEnteredValue: v })) }, showCustomUi: true, strict: false } } });
      await G.batch(SID, [
        { addBanding: { bandedRange: { range: rng(dt, 0, ROWS, 0, 10), rowProperties: { headerColorStyle: { rgbColor: GREEN }, firstBandColorStyle: { rgbColor: WHITE }, secondBandColorStyle: { rgbColor: BAND2 } } } } },
        list(rng(dt, 1, ROWS, 2, 3), [a, b]), list(rng(dt, 1, ROWS, 9, 10), ['Paid'])
      ]).catch(() => {});
    }

    // warna judul kolom dipasang lagi setelah tabel (gaya tabel bisa menimpa)
    await G.batch(SID, [
      fmt(rng(dt, 0, 1, 0, 9), { backgroundColorStyle: { rgbColor: YELLOW }, horizontalAlignment: 'CENTER', textFormat: Object.assign({ bold: true }, FONT) }, 'backgroundColorStyle,horizontalAlignment,textFormat'),
      fmt(rng(dt, 0, 1, 1, 2), { horizontalAlignment: 'LEFT' }, 'horizontalAlignment'),
      fmt(rng(dt, 0, 1, 7, 9), { backgroundColorStyle: { rgbColor: BLUE } }, 'backgroundColorStyle')
    ]).catch(() => {});

    // 5. tampilan Summary
    const box = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
    await G.batch(SID, [
      fmt(rng(sm), { textFormat: FONT }, 'textFormat'),
      { mergeCells: { range: rng(sm, 0, 1, 0, 2), mergeType: 'MERGE_ALL' } },
      fmt(rng(sm, 0, 1, 0, 2), { backgroundColorStyle: { rgbColor: BLUE }, horizontalAlignment: 'CENTER', textFormat: Object.assign({ bold: true }, FONT), borders: box }, 'backgroundColorStyle,horizontalAlignment,textFormat,borders'),
      fmt(rng(sm, 1, 5, 0, 2), { borders: box }, 'borders'),
      fmt(rng(sm, 1, 5, 1, 2), { numberFormat: RP }, 'numberFormat'),
      fmt(rng(sm, 3, 5, 0, 2), { textFormat: Object.assign({ bold: true }, FONT) }, 'textFormat'),
      width(sm, 0, 153), width(sm, 1, 110), height(sm, 20)
    ]);

    await load();
    await setMd({ hl_members: { A: email, B: '' } });
    await load();
    try { localStorage.setItem('hl_sid', SID); } catch (e) {}
    return SID;
  }
  // Isi sheet yang dipilih lewat Picker
  async function inspect(id) {
    const m = readMeta(await G.meta(id));
    return { kind: m.tabs[TAB] ? 'hutanglu' : 'unknown', title: m.title };
  }
  // HP jembatan: pindahkan kategori & foto lama (Script Properties) ke metadata, sekali saja
  async function importOldState(st, shrink) {
    await load();
    const w = {};
    if (st && st.catMap && !META.md.hl_cat && Object.keys(st.catMap).length) w.hl_cat = st.catMap;
    if (st && st.photos) for (const s of ['A', 'B']) {
      const u = st.photos[DB.names[s === 'A' ? 0 : 1]];
      if (u && !META.md['hl_photo_' + s]) { const small = await shrink(u); if (small) w['hl_photo_' + s] = { u: small, v: Date.now() }; }
    }
    if (Object.keys(w).length) { await setMd(w); await load(); }
  }

  const FNS = { getInfo, getHistory, getStats, getSettle, addEntry, deleteEntry, restoreEntry, setCategory, getWrapped, getPhotos, setPhoto, settle, undoSettle, scanReceipt };
  window.HL = {
    call: (fn, args) => { const f = FNS[fn]; if (!f) return Promise.reject(new Error('Perintah tidak dikenal: ' + fn)); return f.apply(null, args || []); },
    connect, create, inspect, claim, whoByEmail, importOldState,
    members: () => (DB ? members() : []),
    setMe: slot => { ME = slot || ''; },
    meId: slot => slot || '',
    sheetId: () => SID,
    forget: () => { SID = null; DB = null; META = null; },
    geminiKey, setGeminiKey,
    canScan: () => !!(G.relay || geminiKey()),
    setPhotoOf: (slot, url) => setPhoto(url, slot),
    photoOf: slot => { const p = md('hl_photo_' + slot, null); return (p && p.u) || ''; }
  };
})();
