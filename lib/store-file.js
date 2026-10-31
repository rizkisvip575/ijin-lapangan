'use strict';

/* Penyimpanan lokal (satu proses, satu folder data).
   Dipakai saat SUPABASE_URL belum diisi, misalnya untuk mencoba di komputer.
   Bentuk data disamakan dengan koleksi aplikasi: karyawan, jabatan, pengajuan,
   absensi, dan lampiran. */

const fs = require('node:fs');
const path = require('node:path');

const COLLECTIONS = ['karyawan', 'jabatan', 'pengajuan', 'absensi', 'lampiran'];

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function createFileStore(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  const legacyLampiranDir = path.join(dataDir, 'lampiran');
  const data = {};
  const revs = {};
  let rev = 0;

  for (const col of COLLECTIONS) {
    data[col] = {};
    revs[col] = 0;
  }

  fs.mkdirSync(legacyLampiranDir, { recursive: true });

  if (fs.existsSync(dbFile)) {
    try {
      const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      for (const col of COLLECTIONS) {
        if (isPlainObject(raw && raw[col])) data[col] = raw[col];
      }
    } catch (err) {
      console.error('Gagal membaca data/db.json:', err.message);
    }
  }

  /* Data lama menyimpan lampiran sebagai satu file per id. */
  try {
    for (const name of fs.readdirSync(legacyLampiranDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      if (data.lampiran[id]) continue;
      try {
        data.lampiran[id] = JSON.parse(fs.readFileSync(path.join(legacyLampiranDir, name), 'utf8'));
      } catch (err) {
        console.error('Lampiran rusak dilewati:', name);
      }
    }
  } catch (err) {
    /* folder belum ada */
  }

  let saveTimer = null;

  function snapshot() {
    return JSON.stringify(data);
  }

  function saveNow() {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      const tmp = dbFile + '.tmp';
      fs.writeFileSync(tmp, snapshot());
      fs.renameSync(tmp, dbFile);
    } catch (err) {
      console.error('Gagal menyimpan data:', err.message);
    }
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveNow();
    }, 100);
  }

  /* --- antrean perubahan agar klien tahu kapan harus memuat ulang --- */

  const listeners = new Set();

  async function bump(col) {
    rev += 1;
    revs[col] = rev;
    for (const notify of listeners) notify([col]);
  }

  function list(col) {
    return Object.keys(data[col]).map((id) => Object.assign({ id }, data[col][id]));
  }

  async function get(col, id) {
    return data[col][id] || null;
  }

  async function put(col, id, value) {
    data[col][id] = value;
    scheduleSave();
    await bump(col);
  }

  async function putMany(col, items) {
    for (const item of items) data[col][item.id] = item.data;
    scheduleSave();
    await bump(col);
  }

  async function patch(col, id, partial) {
    const current = data[col][id];
    if (!current) return null;
    data[col][id] = Object.assign({}, current, partial);
    scheduleSave();
    await bump(col);
    return data[col][id];
  }

  async function remove(col, id) {
    if (!Object.prototype.hasOwnProperty.call(data[col], id)) return false;
    delete data[col][id];
    scheduleSave();
    await bump(col);
    return true;
  }

  async function changes(since) {
    let from = Number(since);
    if (!Number.isFinite(from) || from < 0) from = 0;
    const cols = COLLECTIONS.filter((col) => revs[col] > from);
    return { rev: rev, cols: cols };
  }

  async function close() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveNow();
  }

  return {
    name: 'file',
    list,
    get,
    put,
    putMany,
    patch,
    remove,
    changes,
    close
  };
}

module.exports = { createFileStore, COLLECTIONS };
