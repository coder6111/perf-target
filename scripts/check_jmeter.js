const { exec } = require('child_process');

exec('jmeter -v', (err, stdout, stderr) => {
  if (err) {
    console.error('jmeter not found or error running jmeter -v');
    process.exitCode = 2;
    console.log(JSON.stringify({ installed: false, version: null }));
    return;
  }
  // try to extract version from stdout/stderr
  const out = stdout + '\n' + stderr;
  const m = out.match(/(\d+\.\d+(?:\.\d+)?)/);
  const version = m ? m[0] : null;
  console.log(JSON.stringify({ installed: true, version }));
  process.exitCode = 0;
});
