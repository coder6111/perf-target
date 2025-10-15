const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 4000;
const ROOT = __dirname;

function contentType(p){ const ext = path.extname(p).toLowerCase(); switch(ext){case '.html': return 'text/html; charset=utf-8'; case '.js': return 'application/javascript'; case '.css': return 'text/css'; case '.json': return 'application/json'; default: return 'text/plain; charset=utf-8'; }}

function serveStatic(p, res){ fs.readFile(p, (err,data)=>{ if(err){ res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; } res.writeHead(200, {'Content-Type': contentType(p)}); res.end(data); }); }

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if(pathname === '/' || pathname === '/index.html'){
    serveStatic(path.join(ROOT, 'index.html'), res);
    return;
  }

  if(pathname === '/api/delay'){
    const ms = Math.max(0, parseInt(parsed.query.ms || '500', 10));
    setTimeout(()=>{
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ ok: true, delayedMs: ms, ts: Date.now() }));
    }, ms);
    return;
  }

  if(pathname === '/api/cpu'){
    const ms = Math.max(0, parseInt(parsed.query.ms || '100', 10));
    const start = Date.now();
    while(Date.now() - start < ms){ Math.sqrt(12345); }
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: true, cpuMs: ms, ts: Date.now() }));
    return;
  }

  if(pathname === '/api/stream'){
    const chunks = Math.max(1, parseInt(parsed.query.chunks || '5', 10));
    const delay = Math.max(0, parseInt(parsed.query.delay || '200', 10));
    res.writeHead(200, {'Content-Type':'text/plain; charset=utf-8', 'Transfer-Encoding':'chunked'});
    let i = 0;
    const send = () => {
      if(i>=chunks){ res.end('\n--end--'); return; }
      res.write('chunk ' + (i+1) + '\n');
      i++; setTimeout(send, delay);
    };
    send();
    return;
  }

  if(pathname === '/api/error'){
    res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ ok: false, error: 'simulated' }));
    return;
  }

  // fallback static
  const safe = path.normalize(path.join(ROOT, pathname));
  if(safe.indexOf(ROOT) !== 0){ res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(safe, (err,st)=>{ if(!err && st.isFile()){ serveStatic(safe, res); return; } res.writeHead(404); res.end('Not found'); });
});

server.listen(PORT, () => console.log(`Sample test site listening on http://localhost:${PORT}/`));
