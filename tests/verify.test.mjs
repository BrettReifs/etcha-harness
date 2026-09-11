import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { browserChecks, groupFindings, loadConfig, runCommand, verify } from '../scripts/verify.mjs';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const script = fileURLToPath(new URL('../scripts/verify.mjs', import.meta.url));
const successful = { command: [process.execPath, '-e', 'process.exit(0)'] };
const report = (overrides = {}) => ({
  schemaVersion: 1, findings: [], coverage: Object.fromEntries(browserChecks.map((key) => [key, true])), ...overrides,
});
const adapter = (output = report()) => ({ command: [process.execPath, '-e', `console.log(${JSON.stringify(JSON.stringify(output))})`, '--'] });

async function workspace(t, config) {
  const dir = path.join(fixtures, '.runs', randomUUID());
  await mkdir(dir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = path.join(dir, 'config.json');
  await writeFile(configPath, JSON.stringify(config));
  return { dir, configPath };
}

test('grouping preserves actionable structured severity buckets', () => {
  const input = ['blocking', 'high-value', 'advisory'].map((severity) => ({
    severity, rule: 'fixture.rule', surface: 'home/mobile', evidence: 'observed', action: 'fix',
  }));
  const grouped = groupFindings(input);
  for (const value of input) assert.deepEqual(grouped[value.severity], [value]);
});

test('config root defaults to configuration parent and resolves optional relative root', async (t) => {
  const { configPath, dir } = await workspace(t, { version: 1 });
  assert.equal((await loadConfig(configPath)).root, dir);
  await writeFile(configPath, JSON.stringify({ version: 1, root: '..' }));
  assert.equal((await loadConfig(configPath)).root, path.dirname(dir));
});

test('explicit successful commands and replacement adapter can pass', async (t) => {
  const { configPath } = await workspace(t, { version: 1, build: successful, detect: successful, browser: { adapter: adapter() } });
  const result = await verify(configPath);
  assert.equal(result.ok, true);
  assert.deepEqual(result.findings.blocking, []);
  const cli = await runCommand([process.execPath, script, '--config', configPath]);
  assert.equal(cli.code, 0);
  assert.equal(JSON.parse(cli.stdout).ok, true);
});

test('build timeout remains blocking while detector and browser independently run', async (t) => {
  const { configPath, dir } = await workspace(t, {
    version: 1,
    build: { command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], timeoutMs: 100 },
    detect: { command: [process.execPath, '-e', "require('node:fs').writeFileSync('detected', 'yes')"] },
    browser: { adapter: adapter(report({ findings: [{ severity: 'advisory', rule: 'adapter.ran', surface: 'fixture', evidence: true, action: 'None needed.' }] })) },
  });
  const start = Date.now();
  const result = await verify(configPath);
  assert.ok(Date.now() - start < 5000);
  assert.equal(result.ok, false);
  assert.ok(result.findings.blocking.some((item) => item.rule === 'build.timeout'));
  assert.equal(await readFile(path.join(dir, 'detected'), 'utf8'), 'yes');
  assert.ok(result.findings.advisory.some((item) => item.rule === 'adapter.ran'));
});

test('nonzero build and detector are grouped without suppressing browser findings', async (t) => {
  const failure = { command: [process.execPath, '-e', 'process.exit(7)'] };
  const { configPath } = await workspace(t, {
    version: 1, build: failure, detect: failure,
    browser: { adapter: adapter(report({ findings: [{ severity: 'high-value', rule: 'manual.review', surface: 'fixture', evidence: 'incomplete', action: 'Review.' }] })) },
  });
  const result = await verify(configPath);
  assert.deepEqual(result.findings.blocking.map((item) => item.rule), ['build.failed', 'detect.failed']);
  assert.equal(result.findings['high-value'].length, 1);
});

test('missing native detector and missing adapter coverage cannot yield green', async (t) => {
  const { configPath } = await workspace(t, {
    version: 1, build: successful, browser: { adapter: adapter(report({ coverage: { axe: true } })) },
  });
  const result = await verify(configPath);
  assert.equal(result.ok, false);
  assert.ok(result.findings.blocking.some((item) => item.rule === 'detect.missing'));
  assert.equal(result.findings.blocking.filter((item) => item.rule === 'coverage.missing').length, 7);
});

test('malformed adapter output and invalid command config fail closed', async (t) => {
  const { configPath } = await workspace(t, {
    version: 1, build: { command: 'npm run build' }, detect: successful,
    browser: { adapter: { command: [process.execPath, '-e', "console.log('not JSON')", '--'] } },
  });
  const result = await verify(configPath);
  assert.ok(result.findings.blocking.some((item) => item.rule === 'build.missing'));
  assert.ok(result.findings.blocking.some((item) => item.rule === 'browser.adapter.invalid-report'));
  assert.equal(result.ok, false);
});

test('argv is not interpreted by a shell and output is bounded', async () => {
  const result = await runCommand([process.execPath, '-e', 'console.log(process.argv[1]); console.error("x".repeat(1000))', 'hello; echo unsafe'], { maxOutput: 100 });
  assert.equal(result.stdout.trim(), 'hello; echo unsafe');
  assert.equal(result.stderr.length, 100);
  assert.equal(result.outputTruncated, true);
});

test('CLI rejects relative config and reports invalid JSON as structured failures', async (t) => {
  const relative = await runCommand([process.execPath, script, '--config', 'relative.json']);
  assert.equal(relative.code, 1);
  assert.equal(JSON.parse(relative.stdout).findings.blocking[0].rule, 'config.invalid');
  const { configPath } = await workspace(t, {});
  await writeFile(configPath, '{');
  assert.equal((await verify(configPath)).findings.blocking[0].rule, 'config.invalid');
});
