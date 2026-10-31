'use strict';

/* Lapisan API yang dipakai bersama oleh server lokal (server.js)
   dan fungsi serverless Vercel (api/[...path].js). */

const path = require('node:path');
const express = require('express');

const { createFileStore } = require('./store-file');
const { createSupabaseStore } = require('./store-supabase');

const COLLECTIONS = ['karyawan', 'jabatan', 'pengajuan', 'absensi'];
const LAMPIRAN = 'lampiran';
const BULK_MAX = 2000;

let cachedStore = null;
let cachedError = null;

function storeConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SERVICE_KEY
    || process.env.SUPABASE_KEY;
  return { url: url, key: key };
}

function getStore() {
  if (cachedStore) return cachedStore;
  if (cachedError) throw cachedError;

  const cfg = storeConfig();
  try {
    if (cfg.url && cfg.key) {
      cachedStore = createSupabaseStore(cfg);
    } else if (process.env.VERCEL) {
      throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY belum diatur di Vercel.');
    } else {
      const dataDir = process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.join(__dirname, '..', 'data');
      cachedStore = createFileStore(dataDir);
    }
    return cachedStore;
  } catch (err) {
    cachedError = err;
    throw err;
  }
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 200 && id !== '.' && id !== '..' && !/[\/\\\0]/.test(id);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');

  /* Vercel sudah mem-parse body JSON sebelum fungsi dipanggil. */
  app.use((req, res, next) => {
    if (req.body !== undefined && req.body !== null) req._body = true;
    next();
  });
  app.use(express.json({ limit: '12mb' }));

  function withStore(req, res, next) {
    try {
      req.store = getStore();
    } catch (err) {
      return res.status(503).json({
        error: err.message,
        hint: 'Isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY pada pengaturan environment.'
      });
    }
    next();
  }

  function requireCol(req, res, next) {
    if (!COLLECTIONS.includes(req.params.col)) {
      return res.status(404).json({ error: 'koleksi tidak dikenal' });
    }
    next();
  }

  function requireId(req, res, next) {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'id tidak valid' });
    next();
  }

  function noStore(res) {
    res.set('Cache-Control', 'no-store');
  }

  function fail(res, err) {
    console.error(err);
    res.status(500).json({ error: 'kesalahan server' });
  }

  app.get('/api/health', withStore, async (req, res) => {
    noStore(res);
    try {
      if (req.store.health) await req.store.health();
      res.json({ ok: true, store: req.store.name, time: new Date().toISOString() });
    } catch (err) {
      console.error(err);
      res.status(503).json({ error: 'penyimpanan tidak dapat dihubungi' });
    }
  });

  /* Perubahan sejak rev tertentu: dipakai klien untuk memuat ulang data. */
  app.get('/api/changes', withStore, async (req, res) => {
    noStore(res);
    try {
      const result = await req.store.changes(req.query.since);
      res.json(result);
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/collections/:col', withStore, requireCol, async (req, res) => {
    noStore(res);
    try {
      res.json(await req.store.list(req.col || req.params.col));
    } catch (err) {
      fail(res, err);
    }
  });

  /* Simpan banyak dokumen sekaligus (dipakai saat memuat data contoh / import). */
  app.post('/api/collections/:col', withStore, requireCol, async (req, res) => {
    noStore(res);
    const docs = req.body && req.body.docs;
    if (!Array.isArray(docs)) return res.status(400).json({ error: 'docs harus berupa array' });
    if (docs.length > BULK_MAX) return res.status(413).json({ error: 'terlalu banyak dokumen dalam satu permintaan' });

    const items = [];
    for (const doc of docs) {
      if (!doc || !validId(doc.id) || !isPlainObject(doc.data)) {
        return res.status(400).json({ error: 'setiap dokumen butuh id dan data objek' });
      }
      items.push({ id: doc.id, data: doc.data });
    }

    try {
      await req.store.putMany(req.params.col, items);
      res.json({ ok: true, count: items.length });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/collections/:col/:id', withStore, requireCol, requireId, async (req, res) => {
    noStore(res);
    try {
      const data = await req.store.get(req.params.col, req.params.id);
      if (!data) return res.status(404).json({ error: 'data tidak ditemukan' });
      res.json(Object.assign({ id: req.params.id }, data));
    } catch (err) {
      fail(res, err);
    }
  });

  app.put('/api/collections/:col/:id', withStore, requireCol, requireId, async (req, res) => {
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
    try {
      await req.store.put(req.params.col, req.params.id, req.body);
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post('/api/collections/:col/:id', withStore, requireCol, requireId, async (req, res) => {
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
    try {
      await req.store.put(req.params.col, req.params.id, req.body);
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch('/api/collections/:col/:id', withStore, requireCol, requireId, async (req, res) => {
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
    try {
      const merged = await req.store.patch(req.params.col, req.params.id, req.body);
      if (!merged) return res.status(404).json({ error: 'data tidak ditemukan' });
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete('/api/collections/:col/:id', withStore, requireCol, requireId, async (req, res) => {
    try {
      await req.store.remove(req.params.col, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/lampiran', withStore, async (req, res) => {
    noStore(res);
    try {
      const rows = await req.store.list(LAMPIRAN);
      res.json(rows.map((row) => ({ id: row.id })));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get('/api/lampiran/:id', withStore, requireId, async (req, res) => {
    noStore(res);
    try {
      const data = await req.store.get(LAMPIRAN, req.params.id);
      if (!data) return res.status(404).json({ error: 'lampiran tidak ditemukan' });
      res.json(data);
    } catch (err) {
      fail(res, err);
    }
  });

  app.put('/api/lampiran/:id', withStore, requireId, async (req, res) => {
    if (!isPlainObject(req.body)) return res.status(400).json({ error: 'data harus objek' });
    try {
      await req.store.put(LAMPIRAN, req.params.id, req.body);
      res.json({ ok: true, id: req.params.id });
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete('/api/lampiran/:id', withStore, requireId, async (req, res) => {
    try {
      await req.store.remove(LAMPIRAN, req.params.id);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  if (!process.env.VERCEL) {
    const publicDir = path.join(__dirname, '..', 'public');
    app.use(express.static(publicDir, { index: 'index.html', extensions: ['html'] }));
    app.get('*', (req, res, next) => {
      if (req.path.indexOf('/api/') === 0) return next();
      res.sendFile(path.join(publicDir, 'index.html'));
    });
  }

  app.use('/api', (req, res) => res.status(404).json({ error: 'endpoint tidak ditemukan' }));

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'data terlalu besar' });
    }
    console.error(err);
    res.status(500).json({ error: 'kesalahan server' });
  });

  return app;
}

function closeStore() {
  if (cachedStore && typeof cachedStore.close === 'function') return cachedStore.close();
  return Promise.resolve();
}

module.exports = { createApp, getStore, closeStore };
