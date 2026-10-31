/* Penghubung penyimpanan: API server (Vercel + Supabase) dengan pembaruan
   berkala. Bentuk API sengaja menyerupai collection/doc yang dipakai aplikasi:
   DB.collection(nama).doc(id).set / update / delete / get
   DB.collection(nama).get / onSnapshot */
(function () {
  'use strict';

  var POLL_MS = 4000;
  var enc = encodeURIComponent;

  async function request(url, options) {
    var res = await fetch(url, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store'
    }, options || {}));
    if (!res.ok) {
      var message = 'HTTP ' + res.status;
      try {
        var body = await res.json();
        if (body && body.error) message = body.error;
      } catch (e) { /* bukan JSON */ }
      var err = new Error(message);
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return null;
    var text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  function toDocs(rows) {
    return (rows || []).map(function (row) {
      return { id: row.id, data: function () { return row; } };
    });
  }

  function listCollection(name) {
    if (name === 'lampiran') return request('/api/lampiran').then(toDocs);
    return request('/api/collections/' + enc(name)).then(toDocs);
  }

  function getLampiran(id) {
    return request('/api/lampiran/' + enc(id)).then(function (data) {
      return { exists: true, data: function () { return data; } };
    }, function (err) {
      if (err.status === 404) return { exists: false, data: function () { return null; } };
      throw err;
    });
  }

  function getDoc(name, id) {
    return request('/api/collections/' + enc(name) + '/' + enc(id)).then(function (data) {
      return { exists: true, data: function () { return data; } };
    }, function (err) {
      if (err.status === 404) return { exists: false, data: function () { return null; } };
      throw err;
    });
  }

  function makeDoc(name, id) {
    var isLampiran = name === 'lampiran';
    var path = isLampiran
      ? '/api/lampiran/' + enc(id)
      : '/api/collections/' + enc(name) + '/' + enc(id);
    return {
      set: function (data) {
        return request(path, { method: 'PUT', body: JSON.stringify(data) });
      },
      update: function (data) {
        return request(path, { method: isLampiran ? 'PUT' : 'PATCH', body: JSON.stringify(data) });
      },
      delete: function () {
        return request(path, { method: 'DELETE' });
      },
      get: function () {
        return isLampiran ? getLampiran(id) : getDoc(name, id);
      }
    };
  }

  var listeners = {};
  var rev = 0;
  var pollTimer = null;
  var polling = false;

  function notify(col) {
    (listeners[col] || []).forEach(function (fn) { fn(); });
  }

  async function poll() {
    if (polling) return;
    polling = true;
    try {
      var query = rev ? '?since=' + enc(rev) : '';
      var result = await request('/api/changes' + query);
      if (result && typeof result.rev === 'number') rev = result.rev;
      var changed = (result && result.cols) || [];
      changed.forEach(notify);
    } catch (e) {
      /* Jaringan putus: muat ulang semua data yang sedang ditampilkan. */
      Object.keys(listeners).forEach(notify);
    } finally {
      polling = false;
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(poll, POLL_MS);
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function makeCollection(name) {
    return {
      doc: function (id) { return makeDoc(name, id); },
      get: function () { return listCollection(name).then(function (docs) { return { docs: docs }; }); },
      /* simpan banyak dokumen dalam satu permintaan (data contoh / import) */
      setMany: function (items) {
        var docs = (items || []).map(function (item) {
          return { id: item[0], data: item[1] };
        });
        if (!docs.length) return Promise.resolve({ ok: true, count: 0 });
        return request('/api/collections/' + enc(name), {
          method: 'POST',
          body: JSON.stringify({ docs: docs })
        });
      },
      onSnapshot: function (next, error) {
        var closed = false;
        var timer = null;

        function load() {
          if (closed) return;
          listCollection(name).then(function (docs) {
            if (!closed) next({ docs: docs });
          }).catch(function (err) {
            if (!closed && error) error(err);
          });
        }

        function schedule() {
          if (closed) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () { timer = null; load(); }, 120);
        }

        listeners[name] = listeners[name] || [];
        listeners[name].push(schedule);
        load();
        startPolling();

        return function unsubscribe() {
          closed = true;
          if (timer) clearTimeout(timer);
          listeners[name] = (listeners[name] || []).filter(function (fn) { return fn !== schedule; });
          if (!Object.keys(listeners).some(function (key) { return listeners[key].length; })) stopPolling();
        };
      }
    };
  }

  window.ServerDB = {
    create: async function () {
      var health;
      try {
        health = await request('/api/health');
      } catch (e) {
        return null;
      }
      if (!health || !health.ok) return null;

      /* rev awal supaya perubahan berikutnya bisa dideteksi. */
      try {
        var initial = await request('/api/changes');
        if (initial && typeof initial.rev === 'number') rev = initial.rev;
      } catch (e) { /* polling akan menyusul */ }

      var db = { collection: makeCollection, mode: health.store };
      db.close = function () {
        stopPolling();
        listeners = {};
      };
      return db;
    }
  };
})();
