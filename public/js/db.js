/* Penghubung penyimpanan: API Node.js + Server-Sent Events untuk pembaruan langsung.
   Bentuk API sengaja menyerupai collection/doc yang dipakai aplikasi:
   DB.collection(nama).doc(id).set / update / delete / get
   DB.collection(nama).get / onSnapshot */
(function () {
  'use strict';

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

  function listCollection(name) {
    if (name === 'lampiran') {
      return request('/api/lampiran').then(function (rows) {
        return (rows || []).map(function (row) {
          return { id: row.id, data: function () { return row; } };
        });
      });
    }
    return request('/api/collections/' + enc(name)).then(function (rows) {
      return (rows || []).map(function (row) {
        return { id: row.id, data: function () { return row; } };
      });
    });
  }

  function getLampiran(id) {
    return request('/api/lampiran/' + enc(id)).then(function (data) {
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
        if (name === 'lampiran') return getLampiran(id);
        return request('/api/collections/' + enc(name)).then(function (rows) {
          var hit = (rows || []).find(function (row) { return row.id === id; });
          return hit
            ? { exists: true, data: function () { return hit; } }
            : { exists: false, data: function () { return null; } };
        });
      }
    };
  }

  var source = null;
  var listeners = {};

  function ensureEvents() {
    if (source || typeof EventSource === 'undefined') return;
    source = new EventSource('/api/events');
    source.onmessage = function (event) {
      var payload = null;
      try { payload = JSON.parse(event.data); } catch (e) { return; }
      var col = payload && payload.col;
      if (!col) return;
      (listeners[col] || []).forEach(function (fn) { fn(); });
    };
    source.onerror = function () {
      /* EventSource mencoba menyambung ulang sendiri. */
    };
  }

  function makeCollection(name) {
    return {
      doc: function (id) { return makeDoc(name, id); },
      get: function () { return listCollection(name).then(function (docs) { return { docs: docs }; }); },
      onSnapshot: function (next, error) {
        var closed = false;
        var timer = null;
        var loaded = false;

        function load() {
          if (closed) return;
          listCollection(name).then(function (docs) {
            if (!closed) { loaded = true; next({ docs: docs }); }
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
        ensureEvents();
        load();

        return function unsubscribe() {
          closed = true;
          if (timer) clearTimeout(timer);
          listeners[name] = (listeners[name] || []).filter(function (fn) { return fn !== schedule; });
        };
      }
    };
  }

  window.ServerDB = {
    create: async function () {
      try {
        await request('/api/health');
      } catch (e) {
        return null;
      }
      var db = { collection: makeCollection };
      db.close = function () {
        if (source) { source.close(); source = null; }
        listeners = {};
      };
      return db;
    }
  };
})();
