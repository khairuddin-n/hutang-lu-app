// Data Hutang Lu di Google Sheet milik pengguna (pengganti server Apps Script).
// UI memanggil fungsi di sini lewat API.run.fungsi(...), bentuk datanya sama dengan versi lama.
//
// Struktur sheet (siap untuk lebih dari dua anggota; tampilan saat ini dua orang):
//   Transaksi : id | tanggal | keterangan | dibayar | jenis | nominal | item | ongkir | total | bagian | lunas | dibuat | oleh
//               dibayar/oleh = id anggota. item, bagian, lunas = JSON per id anggota:
//               item   {id: harga item miliknya}           (patungan)
//               bagian {id: bagian masing-masing orang}     (yang bukan pembayar = utang ke pembayar)
//               lunas  {id penghutang: id pelunasan}
//   Anggota   : id | nama | email | foto | foto_v | dibuat
//   Pelunasan : id | waktu | dari | ke | dibayar | ditutup | selisih | jumlah | sampai | transaksi | penyesuaian
//   Kategori  : keterangan | kategori        (kategori pilihan manual per keterangan)
//   Meta      : kunci | nilai
//
// Di UI, dua anggota pertama disebut slot 'A' dan 'B'.
(function () {
  const G = window.HLG;
  const SCHEMA = 1;
  const TABS = {
    Transaksi: ['id', 'tanggal', 'keterangan', 'dibayar', 'jenis', 'nominal', 'item', 'ongkir', 'total', 'bagian', 'lunas', 'dibuat', 'oleh'],
    Anggota: ['id', 'nama', 'email', 'foto', 'foto_v', 'dibuat'],
    Pelunasan: ['id', 'waktu', 'dari', 'ke', 'dibayar', 'ditutup', 'selisih', 'jumlah', 'sampai', 'transaksi', 'penyesuaian'],
    Kategori: ['keterangan', 'kategori'],
    Meta: ['kunci', 'nilai']
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MONF = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const RECENT = 8;

  let SID = null, DB = null, TABID = {}, ME_ID = '';
  try { SID = localStorage.getItem('hl_sid'); } catch (e) {}

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const J = s => { if (!s) return {}; if (typeof s === 'object') return s; try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } };
  const num = v => (typeof v === 'number' ? v : parseFloat(String(v || '').replace(',', '.')) || 0);
  const r2 = v => Math.round(v * 100) / 100;
  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayIso = () => isoOf(new Date());
  const label = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MON[m - 1]} ${y}`; };
  const stale = () => new Error('Data di sheet sudah berubah. Tarik ulang lalu coba lagi.');

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
  const cat = desc => DB.catMap[catKey(desc)] || autoCat(desc);

  // ---------- Struktur sheet ----------
  async function ensure(id) {
    const meta = await G.meta(id);
    const have = meta.sheets.map(s => s.properties);
    const titles = new Set(have.map(p => p.title));
    const req = [];
    Object.keys(TABS).forEach((name, i) => {
      if (titles.has(name)) return;
      if (i === 0 && have.length === 1 && !TABS[have[0].title])   // "Sheet1" bawaan → Transaksi
        req.push({ updateSheetProperties: { properties: { sheetId: have[0].sheetId, title: name, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } });
      else req.push({ addSheet: { properties: { title: name, gridProperties: { frozenRowCount: 1 } } } });
    });
    let tabs = have;
    if (req.length) { await G.batch(id, req); tabs = (await G.meta(id)).sheets.map(s => s.properties); }
    TABID = {}; tabs.forEach(p => { TABID[p.title] = p.sheetId; });

    const names = Object.keys(TABS);
    const r = await G.get(id, names.map(n => n + '!1:1').concat(['Meta!A2:B']));
    const hdr = [];
    names.forEach((n, i) => {
      const h = (r.valueRanges[i].values || [])[0] || [];
      if (h.length < TABS[n].length) hdr.push({ range: n + '!A1', values: [TABS[n]] });
    });
    if (hdr.length) await G.put(id, hdr);
    const metaRows = r.valueRanges[names.length].values || [];
    if (!metaRows.some(x => x[0] === 'schema_version'))
      await G.append(id, 'Meta', [['app', 'hutanglu'], ['schema_version', SCHEMA], ['dibuat', new Date().toISOString()]]);
  }

  // ---------- Baca semua data ----------
  async function load() {
    if (!SID) throw Object.assign(new Error('Belum tersambung ke sheet'), { code: 'nosheet' });
    if (!TABID.Transaksi) await ensure(SID);
    const r = await G.get(SID, ['Transaksi!A2:M', 'Anggota!A2:F', 'Pelunasan!A2:K', 'Kategori!A2:B']);
    const v = i => r.valueRanges[i].values || [];
    const members = [];
    v(1).forEach((x, i) => { if (x[0]) members.push({ id: String(x[0]), name: String(x[1] || '').trim() || 'Tanpa nama', email: String(x[2] || '').trim().toLowerCase(), photo: String(x[3] || ''), pv: String(x[4] || '0'), row: i + 2 }); });
    const slot = {}, ID = {};
    members.slice(0, 2).forEach((m, i) => { const s = i ? 'B' : 'A'; slot[m.id] = s; ID[s] = m.id; });
    const tx = [];
    v(0).forEach((x, i) => {
      const id = String(x[0] || ''), date = String(x[1] || '').trim(), by = String(x[3] || '');
      if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !slot[by]) return;
      tx.push({ row: i + 2, id, date, desc: String(x[2] || '').trim(), by, split: x[4] === 'patungan', amount: num(x[5]), items: J(x[6]),
                fee: num(x[7]), total: num(x[8]), share: J(x[9]), paid: J(x[10]), created: String(x[11] || '') });
    });
    const ord = tx.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.created < b.created ? -1 : a.created > b.created ? 1 : a.row - b.row);
    const log = v(2).filter(x => x[0]).map((x, i) => ({ row: i + 2, id: String(x[0]), t: String(x[1] || ''), from: String(x[2] || ''), to: String(x[3] || ''),
      paid: num(x[4]), cover: num(x[5]), diff: num(x[6]), n: num(x[7]), until: String(x[8] || ''), txs: (() => { try { return JSON.parse(x[9] || '[]'); } catch (e) { return []; } })(), adj: String(x[10] || '') }))
      .sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : a.row - b.row);
    const catMap = {}, catRow = {};
    v(3).forEach((x, i) => { const k = catKey(x[0]); if (k && CAT_NAMES.indexOf(x[1]) >= 0) { catMap[k] = x[1]; catRow[k] = i + 2; } });
    DB = { members, slot, ID, tx, ord, log, catMap, catRow };
    return DB;
  }

  // ---------- Bantuan per transaksi (dua anggota pertama) ----------
  const sl = id => DB.slot[id];
  const otherId = id => DB.ID[sl(id) === 'A' ? 'B' : 'A'];
  const debtor = t => otherId(t.by);
  const owed = t => num(t.share[debtor(t)]);
  const isPaid = t => !!t.paid[debtor(t)];
  const find = id => DB.tx.find(t => t.id === id);
  function raw(t) {
    const A = DB.ID.A, B = DB.ID.B;
    return { date: t.date, desc: t.desc, by: sl(t.by), D: num(t.items[A]), E: num(t.items[B]), F: t.split ? t.fee : 0, G: t.split ? t.total : 0,
             H: num(t.share[A]), I: num(t.share[B]) };
  }
  const txRow = t => ({ row: t.row, key: t.id, date: label(t.date), desc: t.desc, by: sl(t.by), paid: isPaid(t), ym: t.date.slice(0, 7), raw: raw(t) });

  // satu baris Transaksi dari isi form (e.by = slot 'A'/'B')
  function buildRow(e, old) {
    if (!e || !e.desc || !e.by || !e.date) throw new Error('Data belum lengkap');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) throw new Error('Tanggal tidak valid');
    const by = DB.ID[e.by], A = DB.ID.A, B = DB.ID.B;
    if (!by || !A || !B) throw new Error('Pembayar tidak valid');
    let items = '', amount = '', fee = '', total = '', share, jenis;
    if (e.mode === 'split') {
      const d = Number(e.dimbo) || 0, de = Number(e.delpus) || 0;
      fee = Number(e.fee) || 0; total = Number(e.total) || 0;
      if (d + de <= 0) throw new Error('Isi minimal satu item');
      if (total <= 0) throw new Error('Total bayar belum diisi');
      const sa = r2(fee / 2 + d / (d + de) * (total - fee));          // rumus sama dengan sheet lama
      share = { [A]: sa, [B]: r2(total - sa) };
      items = JSON.stringify({ [A]: d, [B]: de }); jenis = 'patungan';
    } else {
      const amt = Number(e.amount) || 0;
      if (amt <= 0) throw new Error('Nominal belum diisi');
      share = { [by]: 0, [by === A ? B : A]: amt };
      amount = amt; jenis = 'langsung';
    }
    return [old ? old.id : String(e.cid || uid()).slice(0, 40), e.date, String(e.desc).trim().slice(0, 120), by, jenis, amount, items, fee || '', total || '',
            JSON.stringify(share), '', old ? old.created : new Date().toISOString(), ME_ID || ''];
  }
  function verify(t) {
    if (!t) throw stale();
    if (isPaid(t)) throw new Error('Transaksi ini sudah lunas, batalkan pelunasannya dulu.');
  }
  async function deleteRows(list) {          // list: [[tab, baris], ...]
    const req = list.slice().sort((a, b) => b[1] - a[1])
      .map(([tab, r]) => ({ deleteDimension: { range: { sheetId: TABID[tab], dimension: 'ROWS', startIndex: r - 1, endIndex: r } } }));
    if (req.length) await G.batch(SID, req);
  }

  // ---------- Beranda ----------
  function monthInfo() {
    const now = new Date(), cur = isoOf(now).slice(0, 7), prev = isoOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const m = { total: 0, n: 0, prev: 0, del: 0, dim: 0 };
    DB.ord.forEach(t => {
      if (ADJ.test(t.desc)) return;
      const a = owed(t); if (a <= 0) return;
      const k = t.date.slice(0, 7);
      if (k === cur) { m.total += a; m.n++; m[sl(t.by) === 'B' ? 'del' : 'dim'] += a; }
      else if (k === prev) m.prev += a;
    });
    m.del = Math.round(m.del); m.dim = Math.round(m.dim);
    return m;
  }
  function suggest() {
    const m = {};
    DB.ord.slice(-150).forEach(t => {
      if (t.split || ADJ.test(t.desc)) return;
      const a = owed(t); if (a <= 0) return;
      const k = catKey(t.desc), x = m[k] || (m[k] = { desc: t.desc, n: 0 });
      x.n++; x.by = sl(t.by); x.amount = a; x.desc = t.desc;
    });
    return Object.values(m).filter(x => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 6).map(x => ({ desc: x.desc, by: x.by, amount: x.amount }));
  }
  function members() {
    return DB.members.slice(0, 2).map((m, i) => ({ key: i ? 'B' : 'A', id: m.id, name: m.name, email: m.email }));
  }
  function info() {
    let a = 0;                                   // > 0: A utang ke B
    DB.ord.forEach(t => { if (!isPaid(t)) a += (sl(t.by) === 'B' ? 1 : -1) * owed(t); });
    a = Math.round(a);
    const pv = s => { const m = DB.members.find(x => x.id === DB.ID[s]); return m ? m.pv : '0'; };
    return {
      recent: DB.ord.slice(-RECENT).reverse().map(txRow),
      month: monthInfo(), suggest: suggest(), catMap: DB.catMap,
      sheetUrl: 'https://docs.google.com/spreadsheets/d/' + SID + '/edit',
      photoVer: { A: pv('A'), B: pv('B') },
      summary: { netA: Math.max(0, a), netB: Math.max(0, -a) },
      members: members()
    };
  }

  // ---------- Transaksi ----------
  async function addEntry(e) {
    await load();
    if (e.cid && !e.editKey && DB.tx.some(t => t.id === String(e.cid))) return { dup: true, edited: false, info: info() };
    let id;
    if (e.editKey) {
      const t = find(String(e.editKey)); verify(t);
      const row = buildRow(e, t); id = row[0];
      await G.put(SID, [{ range: `Transaksi!A${t.row}:M${t.row}`, values: [row] }]);
    } else {
      const row = buildRow(e); id = row[0];
      await G.append(SID, 'Transaksi', [row]);
    }
    if (e.cat) await setCat(e.desc, e.cat);
    await load();
    const t = find(id);
    return { row: t ? t.row : 0, key: id, edited: !!e.editKey, info: info() };
  }
  async function restoreEntry(e) {
    const x = Object.assign({}, e); delete x.row; delete x.editKey; delete x.editRow; delete x.cid;
    await load();
    await G.append(SID, 'Transaksi', [buildRow(x)]);
    await load();
    return { info: info() };
  }
  async function deleteEntry(row, key) {
    await load();
    const t = find(String(key)); verify(t);
    await deleteRows([['Transaksi', t.row]]);
    await load();
    return { info: info() };
  }
  async function getInfo() { await load(); return info(); }
  async function getHistory() { await load(); return DB.ord.slice().reverse().map(txRow); }

  // ---------- Kategori ----------
  async function setCat(desc, name) {
    const k = catKey(desc);
    if (!k) return;
    if (name && CAT_NAMES.indexOf(name) < 0) throw new Error('Kategori tidak dikenal');
    const row = DB.catRow[k];
    if (!name || name === autoCat(desc)) { if (row) await deleteRows([['Kategori', row]]); }
    else if (row) await G.put(SID, [{ range: `Kategori!A${row}:B${row}`, values: [[k, name]] }]);
    else await G.append(SID, 'Kategori', [[k, name]]);
  }
  async function setCategory(desc, name) { await load(); await setCat(desc, name); await load(); return { catMap: DB.catMap }; }

  // ---------- Pelunasan ----------
  // Yang ditandai lunas selalu transaksi TERLAMA dulu; dua arah saling mengurangi.
  // Selisih transfer dicatat sebagai baris baru: lebih bayar → "Kelebihan bayar", kurang → "Sisa pelunasan".
  function settleData() {
    const rows = DB.ord.filter(t => !isPaid(t)).map(t => ({ row: t.row, key: t.id, date: t.date, label: label(t.date), desc: t.desc, by: sl(t.by), amt: r2(owed(t)) }));
    const log = DB.log.slice(-5).reverse().map(l => ({ row: l.id, payer: sl(l.from) || 'A', paid: l.paid, n: l.n, diff: l.diff,
      when: l.t ? label(isoOf(new Date(l.t))) : '' }));
    return { rows, log };
  }
  async function getSettle() { await load(); return settleData(); }

  async function settle(p) {
    await load();
    const payer = DB.ID[p && p.payer];
    if (!payer) throw new Error('Pembayar tidak valid');
    const amount = Math.round(Number(p.amount) || 0);
    if (amount <= 0) throw new Error('Nominal belum diisi');
    const toSlot = p.payer === 'A' ? 'B' : 'A', to = DB.ID[toSlot];
    const list = (p.rows || []).map(x => find(String(x.key)));
    let net = 0, last = '';
    list.forEach(t => { verify(t); net += (t.by === payer ? -1 : 1) * owed(t); if (t.date >= last) last = t.date; });
    net = Math.round(net);
    if (Math.abs(net - Math.round(Number(p.cover) || 0)) > 1) throw stale();
    const sid = uid();
    const data = list.map(t => ({ range: `Transaksi!K${t.row}`, values: [[JSON.stringify(Object.assign({}, t.paid, { [debtor(t)]: sid }))]] }));
    if (data.length) await G.put(SID, data);
    const diff = amount - net;
    let adj = '';
    if (Math.abs(diff) >= 1) {
      const row = buildRow(diff > 0 ? { mode: 'direct', date: todayIso(), desc: 'Kelebihan bayar', by: p.payer, amount: diff }
                                    : { mode: 'direct', date: todayIso(), desc: 'Sisa pelunasan', by: toSlot, amount: -diff });
      adj = row[0];
      await G.append(SID, 'Transaksi', [row]);
    }
    await G.append(SID, 'Pelunasan', [[sid, new Date().toISOString(), payer, to, amount, net, diff, list.length, last ? label(last) : '', JSON.stringify(list.map(t => t.id)), adj]]);
    await load();
    return { info: info(), settle: settleData(), net, diff };
  }
  async function undoSettle(id) {
    await load();
    const last = DB.log[DB.log.length - 1];
    if (!last) throw new Error('Belum ada pelunasan');
    if (String(id) !== last.id) throw new Error('Hanya pelunasan terakhir yang bisa dibatalkan');
    const data = []; let restored = 0;
    DB.tx.forEach(t => {
      const ks = Object.keys(t.paid).filter(k => t.paid[k] === last.id);
      if (!ks.length) return;
      const np = Object.assign({}, t.paid); ks.forEach(k => delete np[k]);
      data.push({ range: `Transaksi!K${t.row}`, values: [[Object.keys(np).length ? JSON.stringify(np) : '']] });
      restored++;
    });
    if (data.length) await G.put(SID, data);
    const del = [['Pelunasan', last.row]];
    const a = last.adj && find(last.adj);
    if (a) del.push(['Transaksi', a.row]);
    await deleteRows(del);
    await load();
    return { info: info(), settle: settleData(), restored };
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
    DB.ord.forEach(t => {
      if (!t.desc || ADJ.test(t.desc)) return;
      const amt = owed(t); if (amt <= 0) return;
      count++;
      const k = t.date.slice(0, 7);
      if (!first || k < first) first = k;
      if (!lastK || k > lastK) lastK = k;
      const m = months[k] || (months[k] = blank());
      if (sl(t.by) === 'B') { m.del += amt; m.nDel++; } else { m.dim += amt; m.nDim++; }
      if (!inWin(k)) return;
      winTotal += amt;
      const key = catKey(t.desc), p = places[key] || (places[key] = { name: t.desc, n: 0, total: 0 });
      p.n++; p.total += amt;
      const c = cat(t.desc), cc = cats[c] || (cats[c] = { total: 0, items: [] });
      const [, mm, dd] = t.date.split('-').map(Number);
      cc.total += amt; cc.items.push([t.date + t.created, dd + ' ' + MON[mm - 1], t.desc, sl(t.by), amt]);
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
    DB.ord.forEach(t => {
      const [ty, tm, td] = t.date.split('-').map(Number);
      if (ty !== y || !t.desc || ADJ.test(t.desc)) return;
      const amt = owed(t); if (amt <= 0) return;
      const d = new Date(ty, tm - 1, td), s = sl(t.by);
      W.n++; W.total += amt;
      if (isPaid(t)) { W.paid.n++; W.paid.t += amt; }
      W.by[s].n++; W.by[s].t += amt;
      W.months[tm - 1] += amt; W.mN[tm - 1]++; W.dow[d.getDay()]++;
      days[t.date] = 1;
      const k = catKey(t.desc), p = places[k] || (places[k] = { name: t.desc, n: 0, t: 0 }); p.n++; p.t += amt;
      const c = cat(t.desc), cc = cats[c] || (cats[c] = { name: c, n: 0, t: 0 }); cc.n++; cc.t += amt;
      if (!W.big || amt > W.big.amt) W.big = { desc: t.desc, amt, by: s, date: t.date };
    });
    W.days = Object.keys(days).length;
    W.places = Object.values(places).sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 3);
    W.cats = Object.values(cats).sort((a, b) => b.t - a.t);
    return W;
  }

  // ---------- Foto profil (di tab Anggota, satu sel ≤ 50.000 karakter) ----------
  function photos() {
    const out = { photos: {}, ver: {} };
    ['A', 'B'].forEach(s => { const m = DB.members.find(x => x.id === DB.ID[s]); out.photos[s] = m ? m.photo : ''; out.ver[s] = m ? m.pv : '0'; });
    return out;
  }
  async function getPhotos() { await load(); return photos(); }
  async function setPhoto(url, slot) {
    if (url && (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url) || url.length > 49000)) throw new Error('Foto terlalu besar');
    await load();
    const m = DB.members.find(x => x.id === (slot ? DB.ID[slot] : ME_ID));
    if (!m) throw new Error('Akun ini belum terhubung ke anggota');
    await G.put(SID, [{ range: `Anggota!D${m.row}:E${m.row}`, values: [[url || '', String(Date.now())]] }]);
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
  const geminiKey = () => { try { return localStorage.getItem('hl_gemini') || ''; } catch (e) { return ''; } };
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
    if (G.relay) return G.relayCall('scanReceipt', [img]);          // HP lama: scan lewat Apps Script seperti dulu
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

  // ---------- Sambung / buat / impor sheet ----------
  async function connect(id) {
    SID = id; TABID = {};
    await ensure(id);
    await load();
    try { localStorage.setItem('hl_sid', id); } catch (e) {}
    return DB;
  }
  // cocokkan email login dengan anggota; kembalikan slot 'A'/'B' atau ''
  function whoByEmail(email) {
    const m = DB.members.slice(0, 2).find(x => x.email && x.email === String(email || '').toLowerCase());
    return m ? sl(m.id) : '';
  }
  async function claim(slot, email) {
    await load();
    const m = DB.members.find(x => x.id === DB.ID[slot]);
    if (!m) throw new Error('Anggota tidak ditemukan');
    if (m.email && m.email !== email) throw new Error('Nama ini sudah dipakai akun Google lain');
    await G.put(SID, [{ range: `Anggota!C${m.row}`, values: [[email]] }]);
    await load();
  }
  async function rename(slot, name) {
    await load();
    const m = DB.members.find(x => x.id === DB.ID[slot]);
    name = String(name || '').trim().slice(0, 24);
    if (!m || !name) return;
    await G.put(SID, [{ range: `Anggota!B${m.row}`, values: [[name]] }]);
    await load();
  }
  async function create(names, email) {
    const f = await G.createSheet('Hutang Lu');
    await connect(f.id);
    const now = new Date().toISOString();
    await G.append(f.id, 'Anggota', names.map((n, i) => [uid() + i, String(n).trim().slice(0, 24), i === 0 ? email : '', '', '0', now]));
    await load();
    return f.id;
  }
  // Lihat isi sheet yang dipilih lewat Picker: format Hutang Lu, format lama (tab "Debt Tracker"), atau tidak dikenal
  async function inspect(id) {
    const meta = await G.meta(id);
    const titles = meta.sheets.map(s => s.properties.title);
    if (titles.indexOf('Transaksi') >= 0 && titles.indexOf('Anggota') >= 0) return { kind: 'hutanglu', title: meta.properties.title };
    if (titles.indexOf('Debt Tracker') >= 0) {
      const r = await G.get(id, ['Debt Tracker!A1:J1', 'Debt Tracker!A2:J']);
      const head = (r.valueRanges[0].values || [])[0] || [];
      const rows = (r.valueRanges[1].values || []).filter(x => typeof x[0] === 'number' && String(x[2] || '').trim());
      // tab baru tidak boleh bentrok dengan tab yang sudah ada di file lama
      const clash = Object.keys(TABS).filter(t => titles.indexOf(t) >= 0);
      return { kind: 'legacy', title: meta.properties.title, n: rows.length, names: rows.length ? legacyNames(head, rows) : [], clash };
    }
    return { kind: 'unknown', title: meta.properties.title };
  }
  // Salin sheet format lama ke sheet Hutang Lu baru. Sheet lama tidak diubah sama sekali.
  // Kolom D/H milik orang pertama, E/I milik orang kedua. Namanya dicari dari judul kolom H & I ("Dimbo Share").
  function legacyNames(head, src) {
    const seen = [];
    src.forEach(x => { const n = String(x[2]).trim(); if (seen.indexOf(n) < 0) seen.push(n); });
    const pickFor = col => seen.find(n => String(head[col] || '').toLowerCase().indexOf(n.toLowerCase()) >= 0);
    const fromHead = col => String(head[col] || '').replace(/\b(share|items?|bagian|item)\b/ig, '').trim();   // "Dimbo Share" → "Dimbo"
    let a = pickFor(7) || pickFor(3) || fromHead(7) || fromHead(3), b = pickFor(8) || pickFor(4) || fromHead(8) || fromHead(4);
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) { a = seen[0]; b = seen[1]; }
    return [a, b || 'Pasangan'].filter(Boolean);
  }
  // inPlace = tab baru ditambahkan ke file lama itu sendiri (tab "Debt Tracker" & lainnya tidak diubah, jadi arsip);
  // kalau tidak, isinya disalin ke file Hutang Lu baru.
  async function importLegacy(srcId, email, meName, inPlace) {
    const r = await G.get(srcId, ['Debt Tracker!A1:J1', 'Debt Tracker!A2:J']);
    const head = (r.valueRanges[0].values || [])[0] || [];
    const src = (r.valueRanges[1].values || []).filter(x => typeof x[0] === 'number' && String(x[2] || '').trim());
    if (!src.length) throw new Error('Tidak ada transaksi di sheet lama');
    const names = legacyNames(head, src);
    if (inPlace) {
      const meta = await G.meta(srcId), titles = meta.sheets.map(x => x.properties.title);
      const clash = Object.keys(TABS).filter(t => titles.indexOf(t) >= 0);
      if (clash.length) throw new Error('File ini sudah punya tab ' + clash.join(', ') + '. Pakai "Salin ke file baru".');
    }
    const f = inPlace ? { id: srcId } : await G.createSheet('Hutang Lu');
    await connect(f.id);
    if (inPlace) await G.tagSheet(f.id).catch(() => {});
    const now = new Date().toISOString(), ids = [uid() + 'a', uid() + 'b'];
    await G.append(f.id, 'Anggota', names.slice(0, 2).map((n, i) => [ids[i], n, n === meName ? email : '', '', '0', now]));
    const idOf = n => ids[names.indexOf(n)];
    const base = new Date(1899, 11, 30);
    const out = [];
    src.forEach((x, i) => {
      const by = idOf(String(x[2]).trim()); if (!by) return;
      const d = new Date(base.getTime() + Math.round(x[0]) * 864e5 + 12 * 3600e3);
      const D = num(x[3]), E = num(x[4]), F = num(x[5]), Gt = num(x[6]), H = num(x[7]), I = num(x[8]);
      const other = by === ids[0] ? ids[1] : ids[0], split = Gt > 0;
      const share = { [ids[0]]: r2(H), [ids[1]]: r2(I) };
      if (!split) share[by] = 0;
      const paid = String(x[9] || '').trim() ? { [other]: 'impor' } : {};
      out.push([uid() + i, isoOf(d), String(x[1] || '').trim().slice(0, 120), by, split ? 'patungan' : 'langsung', split ? '' : r2(by === ids[1] ? H : I),
                split ? JSON.stringify({ [ids[0]]: D, [ids[1]]: E }) : '', split ? F || '' : '', split ? Gt : '', JSON.stringify(share),
                Object.keys(paid).length ? JSON.stringify(paid) : '', 'impor-' + String(i).padStart(6, '0'), '']);
    });
    for (let i = 0; i < out.length; i += 400) await G.append(f.id, 'Transaksi', out.slice(i, i + 400));
    await load();
    return { id: f.id, n: out.length, names: names.slice(0, 2) };
  }

  const FNS = { getInfo, getHistory, getStats, getSettle, addEntry, deleteEntry, restoreEntry, setCategory, getWrapped, getPhotos, setPhoto, settle, undoSettle, scanReceipt };
  window.HL = {
    call: (fn, args) => { const f = FNS[fn]; if (!f) return Promise.reject(new Error('Perintah tidak dikenal: ' + fn)); return f.apply(null, args || []); },
    connect, create, inspect, importLegacy, claim, rename, whoByEmail,
    members: () => (DB ? members() : []),
    setMe: id => { ME_ID = id || ''; },
    meId: slot => (DB && DB.ID[slot]) || '',
    sheetId: () => SID,
    forget: () => { SID = null; DB = null; TABID = {}; },
    geminiKey,
    canScan: () => !!(G.relay || geminiKey()),
    setPhotoOf: (slot, url) => setPhoto(url, slot),
    photoOf: slot => { const m = DB && DB.members.find(x => x.id === DB.ID[slot]); return m ? m.photo : ''; }
  };
})();
