// Simple Node static server + test endpoints for performance testing
// Usage: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const WEBROOT = __dirname;

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function serveStatic(filePath, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
      res.end('Not found');
      return;
    }
    res.writeHead(200, {'Content-Type': contentType(filePath)});
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/' || pathname === '/index.html') {
  serveStatic(path.join(WEBROOT, 'performance_test.html'), res);
    return;
  }

  if (pathname === '/delay') {
    // /delay?ms=500
    const ms = Math.max(0, parseInt(parsed.query.ms || '500', 10));
    setTimeout(() => {
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, delayedMs: ms, ts: Date.now() }));
    }, ms);
    return;
  }

  if (pathname === '/cpu') {
    // /cpu?ms=100 -> busy loop for ms milliseconds
    const ms = Math.max(0, parseInt(parsed.query.ms || '100', 10));
    const start = Date.now();
    // Busy-wait loop to simulate CPU load
    while (Date.now() - start < ms) {
      // do nothing
      Math.sqrt(12345); // small op to avoid being optimized away
    }
    res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: true, cpuMs: ms, ts: Date.now() }));
    return;
  }

  if (pathname === '/error') {
    res.writeHead(500, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: false, error: 'simulated server error' }));
    return;
  }

  if (pathname === '/stream') {
    // /stream?chunks=5&delay=200
    const chunks = Math.max(1, parseInt(parsed.query.chunks || '5', 10));
    const delay = Math.max(0, parseInt(parsed.query.delay || '200', 10));
    res.writeHead(200, {'Content-Type': 'text/plain; charset=utf-8', 'Transfer-Encoding': 'chunked'});
    let i = 0;
    function sendChunk() {
      if (i >= chunks) {
        res.end('\n--stream-end--');
        return;
      }
      res.write(`chunk ${i + 1}\n`);
      i++;
      setTimeout(sendChunk, delay);
    }
    sendChunk();
    return;
  }

  // serve other static files from the same folder
  const safePath = path.normalize(path.join(WEBROOT, pathname));
  if (safePath.indexOf(WEBROOT) !== 0) {
    res.writeHead(403, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Forbidden');
    return;
  }
  fs.stat(safePath, (err, stats) => {
    if (!err && stats.isFile()) {
      serveStatic(safePath, res);
      return;
    }
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    res.end('Not found');
  });
});

// Start servers with automatic port fallback for local development.
function bindOnce(serverObj, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onListening = () => {
      cleanup();
      resolve(serverObj.address().port);
    };
    function cleanup() {
      serverObj.removeListener('error', onError);
      serverObj.removeListener('listening', onListening);
    }
    serverObj.once('error', onError);
    serverObj.once('listening', onListening);
    try {
      serverObj.listen(port);
    } catch (e) {
      cleanup();
      reject(e);
    }
  });
}

async function startWithFallback(initialPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const tryPort = initialPort + i;
    try {
      const bound = await bindOnce(server, tryPort);
      console.log(`Perf test server listening on http://localhost:${bound}/`);
      return bound;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Port ${tryPort} in use, trying ${tryPort + 1}...`);
        continue;
      }
      console.error('Failed to bind server:', err);
      process.exit(1);
    }
  }
  console.error(`Unable to bind server to ports ${initialPort}..${initialPort + maxAttempts - 1}`);
  process.exit(1);
}

async function startControlWithFallback(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const tryPort = startPort + i;
    try {
      const bound = await new Promise((resolve, reject) => {
        const onError = (err) => { cleanup(); reject(err); };
        const onListening = () => { cleanup(); resolve(control.address().port); };
        function cleanup() { control.removeListener('error', onError); control.removeListener('listening', onListening); }
        control.once('error', onError);
        control.once('listening', onListening);
        control.listen(tryPort);
      });
      console.log(`Control API listening on http://localhost:${bound}/ (POST /run-test, GET /test/:id)`);
      return bound;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        console.warn(`Control port ${tryPort} in use, trying ${tryPort + 1}...`);
        continue;
      }
      console.error('Failed to bind control server:', err);
      process.exit(1);
    }
  }
  console.error(`Unable to bind control API to ports ${startPort}..${startPort + maxAttempts - 1}`);
  process.exit(1);
}

// startup IIFE moved below so control is declared before use

// --- Simple in-memory test orchestration ---
// POST /run-test  { url, vus, durationSeconds }
// GET  /test/:id  => status + results

const tests = new Map();
let nextTestId = 1;
// Running tests counter and history file
let runningTestsCount = 0;
const MAX_CONCURRENT_TESTS = Math.max(1, parseInt(process.env.MAX_CONCURRENT_TESTS || '3', 10));
const HISTORY_FILE = path.join(__dirname, 'tests_history.ndjson');
const EventEmitter = require('events');
const historyEmitter = new EventEmitter();

function appendHistory(entry) {
  try {
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(entry) + '\n', 'utf8');
  try { historyEmitter.emit('entry', entry); } catch (e) {}
  } catch (e) {
    console.error('Failed to write history:', e.message);
  }
}

function safeHostAllowed(targetUrl) {
  // Basic safety: allow localhost by default; set ALLOW_ALL=true to allow any host
  if (process.env.ALLOW_ALL === 'true') return true;
  try {
    const u = new URL(targetUrl);
    const allowed = ['localhost', '127.0.0.1', '::1', 'example.com'];
    return allowed.includes(u.hostname);
  } catch (e) {
    return false;
  }
}

async function singleRequest(target) {
  const start = Date.now();
  if (typeof fetch === 'function') {
    const resp = await fetch(target, { method: 'GET' });
    const took = Date.now() - start;
    return { status: resp.status, took };
  }
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(target);
      const lib = parsed.protocol === 'https:' ? require('https') : require('http');
      const r = lib.request(parsed, { method: 'GET' }, (response) => {
        const t0 = Date.now();
        // consume data
        response.on('data', () => {});
        response.on('end', () => {
          resolve({ status: response.statusCode, took: Date.now() - start });
        });
      });
      r.on('error', (err) => reject(err));
      r.end();
    } catch (err) { reject(err); }
  });
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const copy = arr.slice().sort((a,b)=>a-b);
  const idx = Math.ceil((p/100) * copy.length) - 1;
  return copy[Math.max(0, Math.min(idx, copy.length-1))];
}

function runTestAsync(id, target, vus, durationSeconds) {
  const maxVUs = Math.min(500, Math.max(1, parseInt(process.env.MAX_VUS || '200', 10)));
  const maxDuration = Math.min(3600, Math.max(1, parseInt(process.env.MAX_DURATION || '300', 10)));
  if (vus > maxVUs) vus = maxVUs;
  if (durationSeconds > maxDuration) durationSeconds = maxDuration;

  const endAt = Date.now() + durationSeconds * 1000;
  const latencies = [];
  let total = 0, success = 0, errors = 0;
  tests.set(id, { status: 'running', total: 0, success: 0, errors: 0, startedAt: Date.now() });

  const worker = async () => {
    while (Date.now() < endAt) {
      try {
        const r = await singleRequest(target);
        total++; if (r.status >=200 && r.status < 400) success++; else errors++;
        latencies.push(r.took);
        tests.set(id, { status: 'running', total, success, errors });
      } catch (e) {
        errors++;
        total++;
        tests.set(id, { status: 'running', total, success, errors });
      }
    }
  };

  const promises = [];
  for (let i=0;i<vus;i++) promises.push(worker());
  Promise.all(promises).then(() => {
    const avg = latencies.length ? Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length) : 0;
    const p95 = percentile(latencies, 95);
    const p99 = percentile(latencies, 99);
  const result = { status: 'completed', total, success, errors, avgLatencyMs: avg, p95, p99, finishedAt: Date.now() };
  tests.set(id, result);
  appendHistory(Object.assign({ id }, result));
  runningTestsCount = Math.max(0, runningTestsCount - 1);
  }).catch((err)=>{
  const result = { status: 'failed', error: String(err) };
  tests.set(id, result);
  appendHistory(Object.assign({ id }, result));
  runningTestsCount = Math.max(0, runningTestsCount - 1);
  });
}

function parseCsvResults(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { total: 0, latencies: [], success: 0, errors: 0, bytes: 0, timeRange: null };
  const header = lines[0].split(',').map(h => h.trim());
  const idx = (name) => {
    const i = header.indexOf(name);
    return i === -1 ? -1 : i;
  };
  const elapsedIdx = idx('elapsed');
  const successIdx = idx('success');
  const bytesIdx = idx('bytes');
  const tsIdx = idx('timeStamp') !== -1 ? idx('timeStamp') : idx('timeStampMillis') || idx('time');
  const values = [];
  let success = 0, errors = 0, bytes = 0;
  let minTs = Number.POSITIVE_INFINITY, maxTs = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const rawElapsed = elapsedIdx !== -1 ? cols[elapsedIdx] : null;
    const v = rawElapsed ? parseInt(rawElapsed, 10) : NaN;
    if (!Number.isNaN(v)) values.push(v);
    const s = successIdx !== -1 ? (cols[successIdx] || '').toLowerCase() : '';
    if (s === 'true' || s === 't' || s === '1') success++; else if (s === 'false' || s === 'f' || s === '0') errors++;
    const b = bytesIdx !== -1 ? parseInt(cols[bytesIdx], 10) : NaN;
    if (!Number.isNaN(b)) bytes += b;
    const tsRaw = tsIdx !== -1 ? cols[tsIdx] : null;
    if (tsRaw) {
      const t = parseInt(tsRaw, 10);
      if (!Number.isNaN(t)) { minTs = Math.min(minTs, t); maxTs = Math.max(maxTs, t); }
    }
  }
  const total = values.length;
  const timeRange = (minTs < Infinity && maxTs > 0) ? { min: minTs, max: maxTs, durationMs: Math.max(1, maxTs - minTs) } : null;
  return { total, latencies: values, success, errors, bytes, timeRange };
}

function runJMeterTest(id, target, vus, durationSeconds) {
  const template = path.join(__dirname, 'jmeter_template.jmx');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), `jmeter-${id}-`));
  const resultsFile = path.join(tmp, 'results.csv');
  const logFile = path.join(tmp, 'jmeter.log');

  try {
    const u = new URL(target);
    const host = u.hostname;
    const pathPart = (u.pathname || '/') + (u.search || '');
    const protocol = (u.protocol || 'http').replace(':','');
    const port = u.port || (protocol === 'https' ? '443' : '80');

    tests.set(id, { status: 'running', runner: 'jmeter', startedAt: Date.now() });

    const args = [
      '-n',
      '-t', template,
      '-l', resultsFile,
      '-j', logFile,
      `-Jhost=${host}`,
      `-Jpath=${pathPart}`,
      `-Jprotocol=${protocol}`,
      `-Jport=${port}`,
      `-Jthreads=${vus}`,
      `-Jduration=${durationSeconds}`,
      '-Jjmeter.save.saveservice.output_format=csv'
    ];

    const jmeter = require('child_process').spawn('jmeter', args, { stdio: 'ignore' });
    jmeter.on('error', (err) => {
      tests.set(id, { status: 'failed', error: `failed to start jmeter: ${err.message}` });
    });
    jmeter.on('close', (code) => {
      if (code !== 0) {
  const result = { status: 'failed', error: `jmeter exited with code ${code}. See ${logFile}` };
  tests.set(id, result);
  appendHistory(Object.assign({ id }, result));
  runningTestsCount = Math.max(0, runningTestsCount - 1);
        return;
      }
      // read results
      try {
        const csv = fs.readFileSync(resultsFile, 'utf8');
    const parsed = parseCsvResults(csv);
    const total = parsed.total || 0;
    const success = parsed.success || 0;
    const errors = parsed.errors || Math.max(0, total - success);
    const lat = parsed.latencies || [];
    const avg = lat.length ? Math.round(lat.reduce((a,b)=>a+b,0)/lat.length) : 0;
    const p95 = percentile(lat,95);
    const p99 = percentile(lat,99);
    const throughput = parsed.timeRange && parsed.timeRange.durationMs ? Math.round((total / (parsed.timeRange.durationMs/1000)) * 100)/100 : null;
  const result = { status: 'completed', total, success, errors, avgLatencyMs: avg, p95, p99, throughput, bytes: parsed.bytes || 0, artifact: resultsFile, finishedAt: Date.now() };
  tests.set(id, result);
  appendHistory(Object.assign({ id }, result));
  runningTestsCount = Math.max(0, runningTestsCount - 1);
      } catch (e) {
  const result = { status: 'failed', error: `unable to read results: ${e.message}` };
  tests.set(id, result);
  appendHistory(Object.assign({ id }, result));
  runningTestsCount = Math.max(0, runningTestsCount - 1);
      }
    });
  } catch (e) {
    tests.set(id, { status: 'failed', error: `invalid target url: ${e.message}` });
  }
}

// Add API routes for run-test and query
const origServerListen = server.address;

// We need to intercept requests earlier; create a small wrapper server to handle API paths first
// (Since we already created server above, we'll add a small extra route handler by patching the createServer callback isn't trivial here.)
// Simpler: create a tiny HTTP server on a sibling port for test control. We'll start it on PORT+1.

const controlPort = parseInt(process.env.PORT || '3000',10) + 1;
const control = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  // Allow simple CORS from the content server (same host, port-1)
  const origin = req.headers.origin || '';
  // In dev, allow http://localhost:3000 and file origins when ALLOW_ALL is true
  if (process.env.ALLOW_CORS === 'true' || origin.endsWith(':3000') || origin === '') {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'POST' && parsed.pathname === '/run-test') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      try {
  const params = JSON.parse(body || '{}');
  const { url: target, vus = 10, durationSeconds = 10, engine = 'jmeter' } = params;
        if (!target) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'missing target url' })); return; }
        if (!safeHostAllowed(target)) { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'target host not allowed (set ALLOW_ALL=true to override)' })); return; }
        // Support two engines:
        //  - 'jmeter' -> runs JMeter (requires jmeter installed)
        //  - 'demo'   -> runs in-process demo runner (only when ALLOW_DEMO=true)
        const allowDemo = process.env.ALLOW_DEMO === 'true';
        if (engine !== 'jmeter' && engine !== 'demo') {
          res.writeHead(400, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ error: 'unsupported engine', supported: ['jmeter', 'demo'] }));
          return;
        }
        if (engine === 'demo' && !allowDemo) {
          res.writeHead(403, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ error: 'demo engine disabled on server. Start with ALLOW_DEMO=true to enable' }));
          return;
        }
        // Apply demo-specific caps when running demo engine
        let actualVus = parseInt(vus, 10);
        let actualDuration = parseInt(durationSeconds, 10);
        if (engine === 'demo') {
          const maxDemoVus = Math.max(1, parseInt(process.env.MAX_DEMO_VUS || '50', 10));
          const maxDemoDuration = Math.max(1, parseInt(process.env.MAX_DEMO_DURATION || '120', 10));
          if (actualVus > maxDemoVus) actualVus = maxDemoVus;
          if (actualDuration > maxDemoDuration) actualDuration = maxDemoDuration;
        }
        const id = String(nextTestId++);
        const entry = { id, status: 'queued', requested: { target, vus: actualVus, durationSeconds: actualDuration, engine }, createdAt: Date.now() };
        tests.set(id, entry);
        appendHistory(entry);
        // Throttle concurrently running tests
        if (runningTestsCount >= MAX_CONCURRENT_TESTS) {
          // remain queued; runner (demo or jmeter) will start when capacity frees
          tests.set(id, Object.assign({}, entry, { status: 'queued' }));
          res.writeHead(202, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ testId: id, queued: true, message: 'queued due to concurrency limit' }));
        } else {
          // start immediately
          runningTestsCount++;
          tests.set(id, Object.assign({}, entry, { status: 'starting' }));
          appendHistory(Object.assign({}, entry, { status: 'starting', startedAt: Date.now() }));
          if (engine === 'jmeter') {
            runJMeterTest(id, target, actualVus, actualDuration);
          } else {
            runTestAsync(id, target, actualVus, actualDuration);
          }
          res.writeHead(202, {'Content-Type':'application/json'});
          res.end(JSON.stringify({ testId: id, queued: false }));
        }
        res.writeHead(202, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ testId: id }));
      } catch (e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: 'invalid json', detail: String(e) }));
      }
    });
    return;
  }

  // Health endpoint: GET /health
  if (req.method === 'GET' && parsed.pathname === '/health') {
    // run the check_jmeter script synchronously-ish
    try {
      const { spawnSync } = require('child_process');
      const checker = path.join(__dirname, 'scripts', 'check_jmeter.js');
      const out = spawnSync(process.execPath, [checker], { encoding: 'utf8', timeout: 3000 });
      let installed = false, version = null;
      try {
        const j = JSON.parse(out.stdout || out.stderr || '{}');
        installed = !!j.installed; version = j.version || null;
      } catch (e) {
        // ignore
      }
  const demoLimits = { maxVus: Math.max(1, parseInt(process.env.MAX_DEMO_VUS || '50', 10)), maxDuration: Math.max(1, parseInt(process.env.MAX_DEMO_DURATION || '120', 10)) };
  res.writeHead(200, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ uptime: process.uptime(), jmeter: { installed, version }, demoAllowed: process.env.ALLOW_DEMO === 'true', demoLimits }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // GET /test/:id or /test?id=xx
  if (req.method === 'GET' && parsed.pathname.startsWith('/test')) {
    const parts = parsed.pathname.split('/');
    const id = parts.length >= 3 && parts[2] ? parts[2] : parsed.query.id;
    if (!id) { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'missing id' })); return; }
    const data = tests.get(id);
    if (!data) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'not found' })); return; }
    res.writeHead(200, {'Content-Type':'application/json'});
    res.end(JSON.stringify(data));
    return;
  }

  // GET /history?limit=50
  if (req.method === 'GET' && parsed.pathname === '/history') {
    const limit = Math.max(1, Math.min(1000, parseInt(parsed.query.limit || '50', 10)));
    try {
      if (!fs.existsSync(HISTORY_FILE)) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify([])); return; }
      const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
      const last = lines.slice(-limit).map(l => { try { return JSON.parse(l); } catch (e) { return { raw: l }; } });
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(last));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // GET /history/download -> returns raw NDJSON file for download
  if (req.method === 'GET' && parsed.pathname === '/history/download') {
    try {
      if (!fs.existsSync(HISTORY_FILE)) { res.writeHead(404, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'no history file' })); return; }
      const stat = fs.statSync(HISTORY_FILE);
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Length': String(stat.size),
        'Content-Disposition': 'attachment; filename="tests_history.ndjson"'
      });
      const stream = fs.createReadStream(HISTORY_FILE);
      stream.pipe(res);
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // GET /history/tail -> SSE live tail of history entries
  if (req.method === 'GET' && parsed.pathname === '/history/tail') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    const onEntry = (entry) => {
      try { res.write('data: ' + JSON.stringify(entry) + '\n\n'); } catch (e) {}
    };
    historyEmitter.on('entry', onEntry);
    req.on('close', () => { historyEmitter.removeListener('entry', onEntry); });
    return;
  }

  // POST /admin/seed-history -> append a few fake entries for UI testing (gated)
  if (req.method === 'POST' && parsed.pathname === '/admin/seed-history') {
    if (process.env.ALLOW_ADMIN !== 'true') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'admin API disabled (set ALLOW_ADMIN=true)' })); return; }
    try {
      const now = Date.now();
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const id = String(nextTestId++);
        const entry = { id, status: 'completed', total: 100 + i, success: 100 + i, errors: 0, avgLatencyMs: 50 + i, p95: 80 + i, p99: 120 + i, finishedAt: now - (i * 1000) };
        appendHistory(Object.assign({ id }, entry));
        samples.push(entry);
      }
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ seeded: samples.length }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // POST /admin/clear-history -> remove history file (gated)
  if (req.method === 'POST' && parsed.pathname === '/admin/clear-history') {
    if (process.env.ALLOW_ADMIN !== 'true') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'admin API disabled (set ALLOW_ADMIN=true)' })); return; }
    try {
      if (fs.existsSync(HISTORY_FILE)) fs.unlinkSync(HISTORY_FILE);
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ cleared: true }));
    } catch (e) {
      res.writeHead(500, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  // POST /admin/cleanup-history { maxEntries }
  if (req.method === 'POST' && parsed.pathname === '/admin/cleanup-history') {
    if (process.env.ALLOW_ADMIN !== 'true') { res.writeHead(403, {'Content-Type':'application/json'}); res.end(JSON.stringify({ error: 'admin API disabled (set ALLOW_ADMIN=true)' })); return; }
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', () => {
      try {
        const params = JSON.parse(body || '{}');
        const maxEntries = Math.max(1, Math.min(10000, parseInt(params.maxEntries || '1000', 10)));
        if (!fs.existsSync(HISTORY_FILE)) { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ kept: 0 })); return; }
        const lines = fs.readFileSync(HISTORY_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
        const toKeep = lines.slice(-maxEntries);
        fs.writeFileSync(HISTORY_FILE, toKeep.join('\n') + (toKeep.length ? '\n' : ''), 'utf8');
        res.writeHead(200, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ kept: toKeep.length }));
      } catch (e) {
        res.writeHead(400, {'Content-Type':'application/json'});
        res.end(JSON.stringify({ error: 'invalid json', detail: String(e) }));
      }
    });
    return;
  }

  res.writeHead(404, {'Content-Type':'application/json'});
  res.end(JSON.stringify({ error: 'not found' }));
});

// control server is started above with fallback

(async () => {
  const startPort = parseInt(process.env.PORT || String(PORT), 10);
  const boundPort = await startWithFallback(startPort, 10);
  // start control on next port after boundPort
  await startControlWithFallback(boundPort + 1, 10);
})();
