#!/usr/bin/env node
// Simple parser for JMeter CSV results created by the included template.
// Usage: node scripts/parse_jmeter_results.js /path/to/results.csv

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) { console.error('Usage: node parse_jmeter_results.js <results.csv>'); process.exit(2); }

try {
  const csv = fs.readFileSync(file, 'utf8');
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) { console.error('No data in CSV'); process.exit(0); }
  const header = lines[0].split(',');
  const elapsedIdx = header.indexOf('elapsed');
  const successIdx = header.indexOf('success');
  let total = 0, success = 0, errors = 0, bytes = 0; const latencies = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const e = elapsedIdx !== -1 ? parseInt(cols[elapsedIdx],10) : NaN;
    if (!isNaN(e)) latencies.push(e);
    const s = successIdx !== -1 ? (cols[successIdx] || '').toLowerCase() : '';
    if (s === 'true' || s === 't' || s === '1') success++; else errors++;
    total++;
  }
  const avg = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : 0;
  const p95 = latencies.length ? latencies.sort((a,b)=>a-b)[Math.floor(0.95*latencies.length)] : 0;
  const p99 = latencies.length ? latencies.sort((a,b)=>a-b)[Math.floor(0.99*latencies.length)] : 0;
  const result = { timestamp: Date.now(), total, success, errors, avgLatencyMs: avg, p95, p99, source: path.basename(file) };
  // append to tests_history.ndjson
  try {
    fs.appendFileSync(path.join(process.cwd(), 'tests_history.ndjson'), JSON.stringify(result) + '\n', 'utf8');
    console.log('Appended summary to tests_history.ndjson: ', JSON.stringify(result));
  } catch (e) { console.error('Failed to append history:', e.message); }
} catch (e) {
  console.error('Failed to parse CSV:', e.message);
}
