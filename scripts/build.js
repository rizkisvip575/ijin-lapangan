'use strict';

/* Vercel cukup melayani file statis dari public/.
   Skrip ini menyalinnya ke dist/ sebagai output build. */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'public');
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });

console.log('Output statis siap di dist/');
