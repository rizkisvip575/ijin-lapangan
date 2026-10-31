'use strict';

/* Penyimpanan produksi: Supabase (Postgres lewat PostgREST).
   Seluruh akses memakai service role key yang HANYA ada di server (Vercel),
   tidak pernah dikirim ke browser. Tabel dan trigger ada di supabase/schema.sql. */

const COLLECTIONS = ['karyawan', 'jabatan', 'pengajuan', 'absensi', 'lampiran'];
const PAGE_SIZE = 1000;

function createSupabaseStore(options) {
  const url = String(options.url || '').replace(/\/+$/, '');
  const key = String(options.key || '');
  const base = url + '/rest/v1/documents';

  if (!/^https?:\/\//.test(url)) {
    throw new Error('SUPABASE_URL tidak valid (contoh: https://xxxx.supabase.co)');
  }
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY belum diisi');

  function headers(extra) {
    return Object.assign({
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    }, extra || {});
  }

  async function request(query, init) {
    const res = await fetch(base + (query || ''), Object.assign({ headers: headers() }, init || {}));
    if (!res.ok) {
      let detail = '';
      try { detail = await res.text(); } catch (err) { /* ignore */ }
      const error = new Error('Supabase HTTP ' + res.status + (detail ? ': ' + detail.slice(0, 300) : ''));
      error.status = res.status;
      throw error;
    }
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function q(value) {
    return encodeURIComponent(String(value));
  }

  async function list(col) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await request(
        '?select=id,data&collection=eq.' + q(col) +
        '&order=id.asc&limit=' + PAGE_SIZE + '&offset=' + offset
      );
      if (!Array.isArray(page) || page.length === 0) break;
      rows.push.apply(rows, page);
      if (page.length < PAGE_SIZE) break;
    }
    return rows.map((row) => Object.assign({ id: row.id }, row.data || {}));
  }

  async function get(col, id) {
    const rows = await request(
      '?select=data&collection=eq.' + q(col) + '&id=eq.' + q(id) + '&limit=1'
    );
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0].data || null;
  }

  function rowPayload(col, id, data) {
    return {
      collection: col,
      id: id,
      data: data,
      updated_at: new Date().toISOString()
    };
  }

  async function writeRows(rows) {
    return request('?on_conflict=collection,id', {
      method: 'POST',
      headers: headers({
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: JSON.stringify(rows)
    });
  }

  async function put(col, id, value) {
    await writeRows([rowPayload(col, id, value)]);
  }

  async function putMany(col, items) {
    if (!items.length) return;
    for (let i = 0; i < items.length; i += 500) {
      await writeRows(items.slice(i, i + 500).map((item) => rowPayload(col, item.id, item.data)));
    }
  }

  async function patch(col, id, partial) {
    const current = await get(col, id);
    if (!current) return null;
    const merged = Object.assign({}, current, partial);
    await put(col, id, merged);
    return merged;
  }

  async function remove(col, id) {
    await request('?collection=eq.' + q(col) + '&id=eq.' + q(id), { method: 'DELETE' });
    return true;
  }

  /* rev dinaikkan oleh trigger Postgres pada setiap insert/update,
     jadi klien bisa meminta "apa yang berubah sejak rev N". */
  async function changes(since) {
    let from = Number(since);
    if (!Number.isFinite(from) || from < 0) from = 0;

    if (from === 0) {
      /* Klien baru: beri rev terbaru sekaligus minta semua koleksi dimuat. */
      const top = await request('?select=rev&order=rev.desc&limit=1');
      const rev = Array.isArray(top) && top[0] ? Number(top[0].rev) : 0;
      return { rev: rev, cols: COLLECTIONS.slice() };
    }

    const seen = new Set();
    let rev = from;
    let offset = 0;

    for (;;) {
      const rows = await request(
        '?select=collection,rev&rev=gt.' + from +
        '&order=rev.desc&limit=' + PAGE_SIZE + '&offset=' + offset
      );
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        seen.add(row.collection);
        rev = Math.max(rev, Number(row.rev));
      }
      if (rows.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      if (offset > 20000) break;
    }

    return { rev: rev, cols: COLLECTIONS.filter((col) => seen.has(col)) };
  }

  async function health() {
    await request('?select=collection&limit=1');
  }

  return {
    name: 'supabase',
    list,
    get,
    put,
    putMany,
    patch,
    remove,
    changes,
    health
  };
}

module.exports = { createSupabaseStore, COLLECTIONS };
