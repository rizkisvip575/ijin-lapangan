'use strict';

/* Menjalankan aplikasi di komputer sendiri (bukan Vercel).
   Tanpa SUPABASE_URL, data disimpan di folder data/ seperti sebelumnya. */

const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.charAt(0) === '#') continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.charAt(0) === '"' && value.slice(-1) === '"') ||
        (value.charAt(0) === "'" && value.slice(-1) === "'")) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(__dirname, '.env'));

const { createApp, closeStore, getStore } = require('./lib/app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();

try {
  const store = getStore();
  console.log('Penyimpanan: ' + (store.name === 'supabase' ? 'Supabase' : 'file lokal (data/db.json)'));
} catch (err) {
  console.log('Penyimpanan belum siap: ' + err.message);
}

const server = app.listen(PORT, HOST, () => {
  console.log('Izin Lapangan berjalan di http://localhost:' + PORT);
});

let stopping = false;
function shutdown() {
  if (stopping) return;
  stopping = true;
  Promise.resolve(closeStore()).catch(() => {}).then(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
