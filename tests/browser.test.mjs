import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBrowser } from '../scripts/browser.mjs';
import { runCommand } from '../scripts/verify.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const browserScript = fileURLToPath(new URL('../scripts/browser.mjs', import.meta.url));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const template = JSON.parse(await readFile(path.join(fixtures, 'verify.config.json'), 'utf8'));
const rules = (result) => result.findings.map((value) => value.rule);
let testChannel = process.env.ETCHA_TEST_BROWSER_CHANNEL;

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function setup(t, mutate = () => {}) {
  const dir = path.join(fixtures, '.runs', randomUUID());
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = structuredClone(template);
  const port = await freePort();
  config.root = fixtures;
  config.browser.baseURL = `http://127.0.0.1:${port}`;
  config.browser.start.command = [process.execPath, path.join(fixtures, 'server.mjs'), String(port)];
  config.browser.artifactsDir = path.join(dir, 'artifacts');
  config.browser.baselineDir = path.join(dir, 'baselines');
  config.browser.approvalManifest = path.join(dir, 'approval.json');
  if (testChannel) config.browser.channel = testChannel;
  mutate(config);
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2));
  return { dir, config, configPath, port };
}

test('real browser: all approved viewports, human digest gate, exact baselines, mismatch never overwrites', { timeout: 120_000 }, async (t) => {
  const { config, configPath, port } = await setup(t);
  let initial = await runBrowser(configPath);
  if (!testChannel && rules(initial).includes('browser.sandbox.unavailable')) {
    testChannel = 'chrome';
    config.browser.channel = testChannel;
    await writeFile(configPath, JSON.stringify(config, null, 2));
    initial = await runBrowser(configPath);
    t.diagnostic('Bundled Chromium unavailable: trying explicitly configured system Chrome with its sandbox still enabled.');
  }
  assert.ok(!rules(initial).includes('browser.sandbox.unavailable'), 'Real Chromium sandbox is required. Set ETCHA_TEST_BROWSER_CHANNEL=chrome if host policy supports system Chrome instead.');
  assert.equal(initial.coverage.axe, true);
  assert.equal(initial.coverage.keyboard, true);
  assert.equal(initial.coverage.focusVisible, true);
  assert.equal(initial.coverage.reducedMotion, true);
  assert.equal(initial.coverage.responsive, true);
  assert.equal(initial.coverage.zoom, false);
  assert.ok(rules(initial).includes('zoom.unsupported'));
  assert.ok(rules(initial).includes('visual.approval.missing'));
  assert.equal(initial.findings.filter((item) => item.rule === 'visual.baseline.missing').length, 3);
  assert.equal(initial.findings.filter((item) => item.rule.startsWith('axe.') && item.severity === 'blocking').length, 0);
  assert.ok(!rules(initial).includes('keyboard.tab-order'), JSON.stringify(initial.findings));
  assert.ok(!rules(initial).includes('keyboard.unexpected-extra-stop'));
  assert.ok(!rules(initial).includes('focus.indicator.missing'));
  const focus = JSON.parse(await readFile(path.join(initial.artifacts, 'home', 'desktop', 'focus-1.json'), 'utf8'));
  assert.equal(focus.after.focusVisible, true);
  assert.ok((await readFile(focus.image)).length > 100);
  await assert.rejects(fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) }));

  // Test-only simulation of an external reviewer. The executable never performs this operation.
  const manifest = { version: 1, approvedBy: 'Fixture reviewer (simulated test only)',
    approvedAt: new Date().toISOString(), configSha256: hash(await readFile(configPath)), baselines: {} };
  await mkdir(path.join(config.browser.baselineDir, 'home'), { recursive: true });
  for (const viewport of config.browser.viewports) {
    const key = `home/${viewport.name}.png`;
    const candidate = path.join(initial.artifacts, 'home', viewport.name, 'candidate.png');
    await copyFile(candidate, path.join(config.browser.baselineDir, key));
    manifest.baselines[key] = hash(await readFile(candidate));
  }
  await writeFile(config.browser.approvalManifest, JSON.stringify(manifest));
  const approved = await runBrowser(configPath);
  assert.deepEqual(approved.findings.filter((item) => item.rule.startsWith('visual.')), [], JSON.stringify(approved.findings));
  assert.equal(approved.coverage.visual, true);
  assert.ok(rules(approved).includes('zoom.unsupported'), 'Approval cannot waive a missing zoom test.');

  const baseline = path.join(config.browser.baselineDir, 'home/desktop.png');
  await writeFile(baseline, 'tampered baseline');
  const changed = await runBrowser(configPath);
  assert.ok(rules(changed).includes('visual.approval.digest'));
  const mismatch = changed.findings.find((item) => item.rule === 'visual.mismatch');
  assert.equal(mismatch.evidence.before, baseline);
  assert.ok(mismatch.evidence.after.includes('candidate.png'));
  assert.equal(await readFile(baseline, 'utf8'), 'tampered baseline');
});

test('real browser: deliberately bad page surfaces axe, focus, extra Tab, overflow and motion failures', { timeout: 60_000 }, async (t) => {
  const { configPath } = await setup(t, (config) => {
    config.browser.states = [{
      name: 'bad', path: '/bad',
      smoke: [{ role: 'heading', name: 'Deliberately failing fixture' }, { role: 'button', name: 'Missing control' }],
      keyboard: [{ role: 'button', name: 'First' }, { role: 'button', name: 'Second' }],
      reducedMotion: [{ selector: '#status', property: 'transition-duration', equals: '0s' }],
    }];
  });
  const result = await runBrowser(configPath);
  for (const rule of ['axe.html-has-lang', 'axe.button-name', 'focus.indicator.missing', 'keyboard.unexpected-extra-stop',
    'responsive.horizontal-overflow', 'motion.expected-style', 'smoke.expected-target']) {
    assert.ok(rules(result).includes(rule), `Expected ${rule}: ${JSON.stringify(result.findings)}`);
  }
  assert.equal(result.coverage.axe, true, 'Completed checks retain coverage even when they find a bug.');
});

test('real browser: actions establish a named state and keyboard starts before all its controls', { timeout: 60_000 }, async (t) => {
  const { configPath } = await setup(t, (config) => {
    config.browser.states[0].actions = [
      { type: 'click', role: 'button', name: 'Add item' },
      { type: 'waitFor', role: 'status', name: 'Item added' },
    ];
    config.browser.states[0].smoke = [{ role: 'status', name: 'Item added' }];
  });
  const result = await runBrowser(configPath);
  assert.equal(result.coverage.smoke, true);
  assert.equal(result.coverage.keyboard, true);
  assert.ok(!result.findings.some((item) => /^(smoke|keyboard|state)\./.test(item.rule)), JSON.stringify(result.findings));
});

test('real browser: missing expectations and exact reordered roles fail coverage and tab order', { timeout: 60_000 }, async (t) => {
  const { configPath } = await setup(t, (config) => {
    config.browser.states[0].keyboard.reverse();
    delete config.browser.states[0].smoke;
    delete config.browser.states[0].reducedMotion;
  });
  const result = await runBrowser(configPath);
  assert.ok(rules(result).includes('keyboard.tab-order'));
  assert.equal(result.coverage.smoke, false);
  assert.equal(result.coverage.reducedMotion, false);
  assert.equal(result.coverage.focusVisible, false);
});

test('browser rejects remote URLs, unapproved viewport coverage, and unsafe state names', async (t) => {
  for (const mutate of [
    (config) => { config.browser.baseURL = 'https://example.com'; },
    (config) => { config.browser.viewports[0].approved = false; },
    (config) => { config.browser.states[0].name = '../escape'; },
    (config) => { config.browser.states[0].path = '//example.com/'; },
  ]) {
    const { configPath } = await setup(t, mutate);
    const result = await runBrowser(configPath);
    assert.ok(rules(result).includes('browser.failed'));
    assert.ok(Object.values(result.coverage).every((value) => value === false));
  }
});

test('artifact paths cannot overlap baseline or approval paths', async (t) => {
  const { configPath } = await setup(t, (config) => {
    config.browser.artifactsDir = config.browser.baselineDir;
  });
  const result = await runBrowser(configPath);
  assert.ok(rules(result).includes('browser.failed'));
  assert.match(result.findings[0].evidence, /separate/);
});

test('server readiness is bounded and its process is cleaned up', async (t) => {
  let pidPath;
  const { configPath } = await setup(t, (config) => {
    pidPath = path.join(path.dirname(config.browser.approvalManifest), 'server.pid');
    config.browser.start = {
      command: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setInterval(() => {}, 1000)`],
      timeoutMs: 350,
    };
  });
  const started = Date.now();
  const result = await runBrowser(configPath);
  assert.ok(Date.now() - started < 5000);
  assert.ok(result.findings.some((item) => String(item.evidence).includes('readiness timed out')));
  const pid = Number(await readFile(pidPath, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('browser CLI rejects invalid configuration with nonzero structured output', async (t) => {
  const { configPath } = await setup(t, (config) => { config.browser.states = []; });
  const result = await runCommand([process.execPath, browserScript, '--config', configPath]);
  assert.equal(result.code, 1);
  assert.ok(rules(JSON.parse(result.stdout)).includes('browser.failed'));
});
