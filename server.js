'use strict';

const express = require('express');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const LAMP_DIR = path.join(DATA_DIR, 'lampiran');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLS = ['karyawan', 'jabatan', 'pengajuan', 'absensi'];

const db = { karyawan: {}, jabatan: {}, pengajuan: {}, absensi: {} };
const lampiranIds = new Set();

function load() {
  fs.mkdirSync(LAMP_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      for (const col of COLS) {
        if (raw && raw[col] && typeof raw[col] === 'object' && !Array.isArray(raw[col])) {
          db[col] = raw[col];
        }
      }
    } catch (err) {
      console.error('Gagal membaca data/db.json:', err.message);
    }
  }
  for (const name of fs.readdirSync(LAMP_DIR)) {
    if (name.endsWith('.json')) lampiranIds.add(name.slice(0, -5));
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fsp.mkdir(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db));
      await fsp.rename(tmp, DB_FILE);
    } catch (err) {
      console.error('Gagal menyimpan data:', err.message);
    }
  }, 100);
}

const clients = new Set();
function broadcast(col) {
  const payload = 'data: ' + JSON.stringify({ col: col }) + '\n\n';
  for (const res of clients) {
    try { res.write(payload); } catch (e) { clients.delete(res); }
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && id !== '.' && id !== '..' && !/[\/\\\0]/.test(id);
}

load();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '12mb' }));

function requireCol(req, res, next) {
  const col = req.params.col;
  if (!COLS.includes(col)) return res.status(404).json({ error: 'koleksi tidak dikenal' });
  req.col = col;
  next();
}

function requireId(req, res, next) {
  if (!validId(req.params.id)) return res.status(400).json({ error: 'id tidak valid' });
  next();
}

app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/collections/:col', requireCol, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const col = req.col;
  const rows = Object.keys(db[col]).map((id) => Object.assign({ id: id }, db[col][id]));
  res.json(rows);
});

app.put('/api/collections/:col/:id', requireCol, requireId, (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
  db[req.col][req.params.id] = req.body;
  scheduleSave();
  broadcast(req.col);
  res.json({ ok: true, id: req.params.id });
});

app.post('/api/collections/:col/:id', requireCol, requireId, (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
  db[req.col][req.params.id] = req.body;
  scheduleSave();
  broadcast(req.col);
  res.json({ ok: true, id: req.params.id });
});

app.patch('/api/collections/:col/:id', requireCol, requireId, (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
  const current = db[req.col][req.params.id];
  if (!current) return res.status(404).json({ error: 'data tidak ditemukan' });
  db[req.col][req.params.id] = Object.assign({}, current, req.body);
  scheduleSave();
  broadcast(req.col);
  res.json({ ok: true, id: req.params.id });
});

app.delete('/api/collections/:col/:id', requireCol, requireId, (req, res) => {
  delete db[req.col][req.params.id];
  scheduleSave();
  broadcast(req.col);
  res.json({ ok: true });
});

function lampiranFile(id) {
  return path.join(LAMP_DIR, id + '.json');
}

app.get('/api/lampiran', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(Array.from(lampiranIds).map((id) => ({ id: id })));
});

app.get('/api/lampiran/:id', requireId, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const file = lampiranFile(req.params.id);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'lampiran tidak ditemukan' });
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: 'lampiran rusak' });
  }
});

app.put('/api/lampiran/:id', requireId, (req, res) => {
  if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
  try {
    fs.mkdirSync(LAMP_DIR, { recursive: true });
    fs.writeFileSync(lampiranFile(req.params.id), JSON.stringify(req.body));
    lampiranIds.add(req.params.id);
    broadcast('lampiran');
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: 'gagal menyimpan lampiran' });
  }
});

app.delete('/api/lampiran/:id', requireId, (req, res) => {
  try {
    fs.rmSync(lampiranFile(req.params.id), { force: true });
  } catch (err) { /* ignore */ }
  lampiranIds.delete(req.params.id);
  broadcast('lampiran');
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* ignore */ }
  }, 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

app.use(express.static(PUBLIC_DIR, { index: 'index.html', extensions: ['html'] }));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.use('/api', (req, res) => res.status(404).json({ error: 'endpoint tidak ditemukan' }));

app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'data terlalu besar' });
  }
  console.error(err);
  res.status(500).json({ error: 'kesalahan server' });
});

const server = app.listen(PORT, HOST, () => {
  console.log('Izin Lapangan berjalan di http://localhost:' + PORT);
});

function shutdown() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db));
  } catch (err) {
    console.error('Gagal menyimpan data saat berhenti:', err.message);
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
