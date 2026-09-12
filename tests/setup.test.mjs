import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupEngine } from '../scripts/setup-engine.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'etcha-engine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, '.github/skills/impeccable/scripts');
  await mkdir(scripts, { recursive: true });
  await writeFile(path.join(scripts, 'VERSION'), '0.1.5\n');
  return { root, scripts };
}

test('stage the locked npm engine with executable permissions; repeat safely', async (t) => {
  const { root } = await fixture(t);
  const engine = await setupEngine(root);
  const before = await readFile(engine);
  await setupEngine(root);
  assert.deepEqual(await readFile(engine), before);
  assert((await stat(engine)).mode & 0o100);
  const probe = spawnSync(engine, ['engine-probe'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(probe.status, 0);
  assert.equal(probe.stdout.trim(), 'impeccable-engine 0.1.5');
});

test('engine version mismatch stops before staging', async (t) => {
  const { root, scripts } = await fixture(t);
  await writeFile(path.join(scripts, 'VERSION'), '9.9.9\n');
  await assert.rejects(setupEngine(root), /Engine mismatch/);
  await assert.rejects(stat(path.join(scripts, 'bin')), { code: 'ENOENT' });
});

test('reject symlinked runtime directory without changing its target', async (t) => {
  const { root, scripts } = await fixture(t);
  const elsewhere = path.join(root, 'unrelated');
  await mkdir(elsewhere);
  await symlink(elsewhere, path.join(scripts, 'bin'), 'dir');
  await assert.rejects(setupEngine(root), /Symlink/);
});

test('reject symlinked engine file', async (t) => {
  const { root } = await fixture(t);
  const engine = await setupEngine(root);
  const unrelated = path.join(root, 'product.txt');
  await writeFile(unrelated, 'keep');
  await rm(engine);
  await symlink(unrelated, engine);
  await assert.rejects(setupEngine(root), /Symlink/);
  assert.equal(await readFile(unrelated, 'utf8'), 'keep');
});
