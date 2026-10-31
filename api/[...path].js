'use strict';

/* Satu fungsi serverless untuk semua rute /api/* di Vercel.
   File statis (public/) dilayani langsung oleh Vercel. */

const { createApp } = require('../lib/app');

const app = createApp();

module.exports = (req, res) => {
  if (typeof req.url !== 'string' || req.url.charAt(0) !== '/') {
    req.url = '/' + (req.url || '');
  }
  if (req.url.indexOf('/api') !== 0) {
    req.url = '/api' + (req.url === '/' ? '' : req.url);
  }
  return app(req, res);
};
