import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runBrowser } from '../scripts/browser.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'etcha-regression-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const html = `<!doctype html><html lang="en"><head><title>Isolation fixture</title>
    <style>body{color:#000;background:#fff}button:focus-visible{outline:3px solid #000}</style>
    </head><body><main><h1 id="count">Count 0</h1><button>Add</button></main>
    <script>
    let count = Number(localStorage.getItem('count') || 0);
    const heading = document.querySelector('h1');
    function render() { heading.textContent = 'Count ' + count; heading.style.setProperty('--count', count); }
    render();
    document.querySelector('button').onclick = () => { count++; localStorage.setItem('count', count); render(); };
    </script></body></html>`;
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const config = {
    version: 1, root,
    browser: {
      baseURL: `http://127.0.0.1:${server.address().port}`,
      channel: process.env.ETCHA_TEST_BROWSER_CHANNEL,
      artifactsDir: 'artifacts', baselineDir: 'baselines', approvalManifest: 'approval.json',
      checkTimeoutMs: 5000,
      zoom: { mode: 'reflow-model', approved: true },
      viewports: [
        { name: 'desktop', width: 1280, height: 800, approved: true },
        { name: 'tablet', width: 768, height: 1024, approved: true },
        { name: 'mobile', width: 390, height: 844, approved: true },
      ],
      states: [{
        name: 'home', path: '/',
        actions: [{ type: 'click', role: 'button', name: 'Add' }],
        smoke: [{ role: 'heading', name: 'Count 1' }],
        keyboard: [{ role: 'button', name: 'Add' }],
        reducedMotion: [{ selector: '#count', property: '--count', equals: '1' }],
      }],
    },
  };
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  return { root, config, configPath };
}

test('server startup refuses an occupied endpoint before spawning', async (t) => {
  const { root, config, configPath } = await fixture(t);
  const marker = path.join(root, 'spawned');
  config.browser.start = { command: [process.execPath, '-e',
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(()=>{},1000)`] };
  await writeFile(configPath, JSON.stringify(config));
  const result = await runBrowser(configPath);
  assert(result.findings.some((item) => item.rule === 'browser.failed'
    && item.evidence.includes('port is already in use')));
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('surface replays are isolated and simultaneous runs do not mutate TMPDIR', { timeout: 120000 }, async (t) => {
  const first = await fixture(t);
  const second = await fixture(t);
  const original = process.env.TMPDIR;
  const reports = await Promise.all([runBrowser(first.configPath), runBrowser(second.configPath)]);
  assert.equal(process.env.TMPDIR, original);
  for (const report of reports) {
    assert.equal(report.coverage.smoke, true, JSON.stringify(report.findings));
    assert.equal(report.coverage.reducedMotion, true, JSON.stringify(report.findings));
    assert.equal(report.coverage.zoom, true, JSON.stringify(report.findings));
    assert(!report.findings.some((item) => [
      'smoke.expected-target', 'motion.expected-style', 'state.unavailable',
      'zoom.required-information', 'browser.failed', 'browser.sandbox.unavailable',
    ].includes(item.rule)), JSON.stringify(report.findings));
  }
});

test('verifier cancellation stops detached workers and does not start the next check', { timeout: 15000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'etcha-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pidFile = path.join(root, 'worker.pid');
  const nextCheck = path.join(root, 'detector-started');
  const configPath = path.join(root, 'config.json');
  await writeFile(configPath, JSON.stringify({
    version: 1,
    build: { command: [process.execPath, '-e',
      `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); setInterval(()=>{},1000)`] },
    detect: { command: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(nextCheck)},'bad')`] },
  }));
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url)), '--config', configPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.resume();
  const exited = new Promise((resolve) => child.once('close', resolve));
  t.after(() => child.kill('SIGKILL'));
  let pid;
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try { pid = Number(await readFile(pidFile, 'utf8')); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert(pid, 'Worker never started');
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} });
  child.kill('SIGTERM');
  assert.equal(await exited, 1);
  assert(JSON.parse(output).findings.blocking.some((item) => item.rule === 'verification.cancelled'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  await assert.rejects(readFile(nextCheck), { code: 'ENOENT' });
});
