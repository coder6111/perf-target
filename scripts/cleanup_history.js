#!/usr/bin/env node
// Small helper to trim tests_history.ndjson locally.
const fs = require('fs');
const path = require('path');
const HISTORY_FILE = path.join(__dirname, '..', 'tests_history.ndjson');
const arg = process.argv[2] || '1000';
const max = Math.max(1, Math.min(100000, parseInt(arg, 10)));
if (!fs.existsSync(HISTORY_FILE)) { console.log('No history file'); process.exit(0); }
const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
const kept = lines.slice(-max);
fs.writeFileSync(HISTORY_FILE, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
console.log('Kept', kept.length, 'entries');
