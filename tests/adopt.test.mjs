import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { adopt } from '../scripts/adopt.mjs';

const skill = '.github/skills/impeccable/SKILL.md';
const hook = '.github/hooks/impeccable.json';
const manifest = '.etcha/manifest.json';
const digest = (value) => createHash('sha256').update(value).digest('hex');

async function put(root, relative, value = 'fixture\n') {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), value);
}

async function fixture(t) {
  const root = path.resolve(`.adopt-test-${randomUUID()}`);
  const source = path.join(root, 'source');
  const target = path.join(root, 'product');
  await mkdir(target, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [
    skill, hook, '.impeccable/config.json', 'scripts/verify.mjs', 'scripts/browser.mjs',
    'scripts/setup-engine.mjs', 'package.json', 'package-lock.json', 'licenses/impeccable-LICENSE',
  ]) await put(source, name, `${name}\n`);
  return { root, source, target };
}

async function snapshot(root) {
  const entries = {};
  async function walk(directory, prefix = '') {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) {
        entries[`${name}/`] = 'directory';
        await walk(path.join(directory, entry.name), `${name}/`);
      } else if (entry.isSymbolicLink()) {
        entries[name] = 'symlink';
      } else {
        entries[name] = (await readFile(path.join(directory, entry.name))).toString('base64');
      }
    }
  }
  await walk(root);
  return entries;
}

test('installs only explicit payload and preserves product files and unrelated hooks/skills', async (t) => {
  const { source, target } = await fixture(t);
  const preserved = ['PRODUCT.md', 'DESIGN.md', 'AGENTS.md', 'package.json',
    '.github/hooks/other.json', '.github/skills/other/SKILL.md'];
  for (const name of preserved) await put(target, name, `product ${name}`);
  await put(source, '.github/skills/etcha-design/SKILL.md', 'Etcha guidance');
  await put(source, 'unrelated.txt', 'do not install');
  const result = await adopt({ source, target });
  assert.equal(result.changed, true);
  for (const name of preserved) {
    assert.equal(await readFile(path.join(target, name), 'utf8'), `product ${name}`);
  }
  assert.equal(await readFile(path.join(target, '.etcha/harness/package.json'), 'utf8'), 'package.json\n');
  assert.equal(await readFile(path.join(target, '.etcha/harness/scripts/verify.mjs'), 'utf8'), 'scripts/verify.mjs\n');
  assert.equal(await readFile(path.join(target, '.etcha/harness/scripts/setup-engine.mjs'), 'utf8'), 'scripts/setup-engine.mjs\n');
  assert.equal(await readFile(path.join(target, '.etcha/harness/licenses/impeccable-LICENSE'), 'utf8'), 'licenses/impeccable-LICENSE\n');
  const owned = JSON.parse(await readFile(path.join(target, manifest), 'utf8'));
  assert.equal(Object.keys(owned.files).length, 10);
  for (const [name, expected] of Object.entries(owned.files)) {
    assert.equal(digest(await readFile(path.join(target, name))), expected);
  }
  await assert.rejects(readFile(path.join(target, 'unrelated.txt')), { code: 'ENOENT' });
});

test('first-run conflicts preflight all changes, including identical unowned content', async (t) => {
  for (const name of [skill, '.etcha/harness/package-lock.json']) {
    const { source, target } = await fixture(t);
    await put(target, name, name === skill ? `${skill}\n` : 'conflict');
    const before = await snapshot(target);
    await assert.rejects(adopt({ source, target }), /Unowned file conflict/);
    assert.deepEqual(await snapshot(target), before);
  }
});

test('repeat adoption is idempotent and applies additions, updates, and removed payload files', async (t) => {
  const { source, target } = await fixture(t);
  await put(source, '.github/skills/impeccable/obsolete.md', 'old');
  await adopt({ source, target });
  const before = await snapshot(target);
  const unchanged = await adopt({ source, target });
  assert.equal(unchanged.changed, false);
  assert.ok(unchanged.operations.every(({ action }) => action === 'keep'));
  assert.deepEqual(await snapshot(target), before);
  await put(source, skill, 'updated');
  await put(source, '.github/skills/etcha-design/SKILL.md', 'new');
  await rm(path.join(source, '.github/skills/impeccable/obsolete.md'));
  await adopt({ source, target });
  assert.equal(await readFile(path.join(target, skill), 'utf8'), 'updated');
  assert.equal(await readFile(path.join(target, '.github/skills/etcha-design/SKILL.md'), 'utf8'), 'new');
  await assert.rejects(readFile(path.join(target, '.github/skills/impeccable/obsolete.md')), { code: 'ENOENT' });
});

test('modified owned files block updates and deletions before any writes', async (t) => {
  for (const deleted of [false, true]) {
    const { source, target } = await fixture(t);
    const extra = '.github/skills/impeccable/extra.md';
    await put(source, extra);
    await adopt({ source, target });
    await put(target, extra, 'user edit');
    await put(source, hook, 'new hook');
    if (deleted) await rm(path.join(source, extra));
    const before = await snapshot(target);
    await assert.rejects(adopt({ source, target }), /Owned file was modified/);
    assert.deepEqual(await snapshot(target), before);
  }
});

test('dry-run reports writes, directories, updates, deletions, and removal without writes', async (t) => {
  const { source, target } = await fixture(t);
  let before = await snapshot(target);
  const first = await adopt({ source, target, dryRun: true });
  assert.ok(first.operations.some(({ action }) => action === 'mkdir'));
  assert.equal(first.operations.filter(({ action }) => action === 'write').length, 10);
  assert.deepEqual(await snapshot(target), before);
  await put(source, '.github/skills/impeccable/old.md', 'old');
  await adopt({ source, target });
  await put(source, skill, 'new');
  await rm(path.join(source, '.github/skills/impeccable/old.md'));
  before = await snapshot(target);
  const update = await adopt({ source, target, dryRun: true });
  assert.ok(update.operations.some(({ action }) => action === 'delete'));
  assert.ok(update.operations.some(({ action }) => action === 'write'));
  const removal = await adopt({ source, target, dryRun: true, remove: true });
  assert.equal(removal.operations.filter(({ action }) => action === 'delete').length, 11);
  assert.deepEqual(await snapshot(target), before);
});

test('removal preserves edited files, unowned files, and all directories', async (t) => {
  const { source, target } = await fixture(t);
  await adopt({ source, target });
  await put(target, skill, 'edited');
  await put(target, '.github/hooks/custom.json', 'custom');
  await put(target, '.etcha/harness/unowned.txt', 'unowned');
  await put(target, 'PRODUCT.md', 'product');
  await rm(source, { recursive: true });
  const result = await adopt({ source, target, remove: true });
  assert.ok(result.operations.some(({ action, path: name }) => action === 'preserve' && name === skill));
  assert.equal(await readFile(path.join(target, skill), 'utf8'), 'edited');
  assert.equal(await readFile(path.join(target, '.github/hooks/custom.json'), 'utf8'), 'custom');
  assert.equal(await readFile(path.join(target, '.etcha/harness/unowned.txt'), 'utf8'), 'unowned');
  assert.equal(await readFile(path.join(target, 'PRODUCT.md'), 'utf8'), 'product');
  assert.deepEqual(JSON.parse(await readFile(path.join(target, manifest), 'utf8')).files, {
    [skill]: digest(`${skill}\n`),
  });
  await put(target, skill, `${skill}\n`);
  await adopt({ source, target, remove: true });
  await assert.rejects(readFile(path.join(target, manifest)), { code: 'ENOENT' });
  assert.ok((await snapshot(target))['.github/skills/impeccable/']);
  assert.equal((await adopt({ source, target, remove: true })).changed, false);
});

test('required native payload must exist and be nonempty before any writes', async (t) => {
  for (const missing of [skill, '.github/skills/impeccable', hook,
    '.impeccable/config.json', 'scripts/verify.mjs', 'scripts/setup-engine.mjs',
    'package-lock.json', 'licenses/impeccable-LICENSE']) {
    const { source, target } = await fixture(t);
    await rm(path.join(source, missing), { recursive: true });
    await assert.rejects(adopt({ source, target }), /Required source/);
    assert.deepEqual(await snapshot(target), {});
  }
});

test('rejects target root, own harness, relative target, and traversal', async (t) => {
  const { source, target, root } = await fixture(t);
  for (const unsafe of ['/', source, root, 'relative-product', `${target}/../elsewhere`]) {
    await assert.rejects(adopt({ source, target: unsafe }), /Refusing|absolute path/);
  }
});

test('rejects symlink targets, ancestors, destination files, and manifest before writes', async (t) => {
  for (const link of ['target', '.github', skill, '.etcha', manifest]) {
    const { source, target, root } = await fixture(t);
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await put(outside, 'sentinel', 'safe');
    const location = link === 'target' ? path.join(root, 'linked') : path.join(target, link);
    await mkdir(path.dirname(location), { recursive: true });
    await symlink(link === skill || link === manifest ? path.join(outside, 'sentinel') : outside, location);
    const before = await snapshot(target);
    await assert.rejects(adopt({ source, target: link === 'target' ? location : target }), /Symlink/);
    assert.deepEqual(await snapshot(target), before);
    assert.equal(await readFile(path.join(outside, 'sentinel'), 'utf8'), 'safe');
  }
});

test('rejects source symlinks rather than copying external content', async (t) => {
  const { source, target, root } = await fixture(t);
  await put(root, 'outside.txt', 'private');
  await symlink(path.join(root, 'outside.txt'), path.join(source, '.github/skills/impeccable/link.md'));
  await assert.rejects(adopt({ source, target }), /Symlink/);
  assert.deepEqual(await snapshot(target), {});
});

test('rejects malicious manifest paths and hashes for both adoption and removal', async (t) => {
  const { source, target } = await fixture(t);
  const malicious = [
    '../PRODUCT.md', '/PRODUCT.md', '.github/skills/impeccable/../../hooks/custom.json',
    '.github/skills/impeccable/../impeccable/SKILL.md',
    '.github/skills/impeccable\\escape.md', '.github/skills/impeccable//file.md',
    'PRODUCT.md', 'package.json', '.github/hooks/custom.json', '.etcha/manifest.json',
    '.etcha/harness/other.mjs', '.github/skills/impeccable/',
  ];
  for (const name of malicious) {
    await put(target, manifest, JSON.stringify({ version: 1, files: { [name]: digest('safe') } }));
    const before = await snapshot(target);
    for (const remove of [false, true]) {
      await assert.rejects(adopt({ source, target, remove }), /Unsafe ownership/);
    }
    assert.deepEqual(await snapshot(target), before);
  }
  for (const value of ['bad json', '{"version":2,"files":{}}',
    JSON.stringify({ version: 1, files: { [skill]: 'invalid' } })]) {
    await put(target, manifest, value);
    await assert.rejects(adopt({ source, target }), /manifest/);
  }
});

test('symlink replacement of an owned file blocks removal without deleting other files', async (t) => {
  const { source, target, root } = await fixture(t);
  await adopt({ source, target });
  await put(root, 'outside.txt', 'safe');
  await rm(path.join(target, skill));
  await symlink(path.join(root, 'outside.txt'), path.join(target, skill));
  const before = await snapshot(target);
  await assert.rejects(adopt({ source, target, remove: true }), /Symlink/);
  assert.deepEqual(await snapshot(target), before);
});

test('missing target is not created by a dry-run or a failed preflight', async (t) => {
  const { source, target } = await fixture(t);
  await rm(target, { recursive: true });
  await adopt({ source, target, dryRun: true });
  await assert.rejects(readdir(target), { code: 'ENOENT' });
  await rm(path.join(source, hook));
  await assert.rejects(adopt({ source, target }), /Required source/);
  await assert.rejects(readdir(target), { code: 'ENOENT' });
});

test('file and directory collisions are rejected in preflight', async (t) => {
  for (const directory of [true, false]) {
    const { source, target } = await fixture(t);
    if (directory) await mkdir(path.join(target, '.etcha/harness/package.json'), { recursive: true });
    else await put(target, '.etcha', 'not a directory');
    const before = await snapshot(target);
    await assert.rejects(adopt({ source, target }), /regular file|not a directory/);
    assert.deepEqual(await snapshot(target), before);
  }
});

test('CLI adopts fixture payload, reports dry-run and removal, and rejects invalid arguments', async (t) => {
  const { source, target } = await fixture(t);
  await put(source, 'scripts/adopt.mjs', await readFile(new URL('../scripts/adopt.mjs', import.meta.url)));
  const script = path.join(source, 'scripts/adopt.mjs');
  const run = (...args) => promisify(execFile)(process.execPath, [script, ...args]);
  const preview = await run('--target', target, '--dry-run');
  assert.match(preview.stdout, /\[dry-run\] WRITE .etcha\/manifest.json/);
  assert.deepEqual(await snapshot(target), {});
  await run('--target', target);
  assert.match((await run('--target', target)).stdout, /KEEP/);
  assert.match((await run('--target', target, '--remove')).stdout, /DELETE/);
  for (const args of [[], ['--unknown'], ['--target'], ['--target', target, '--unknown']]) {
    await assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /Adoption failed:/);
      return true;
    });
  }
});

test('preserves executable launcher modes and repairs them idempotently without changing product files', async (t) => {
  const { source, target } = await fixture(t);
  const launcher = '.github/skills/impeccable/scripts/impeccable';
  const windowsLauncher = `${launcher}.cmd`;
  await put(source, launcher, '#!/usr/bin/env node\nconsole.log("hook works");\n');
  await chmod(path.join(source, launcher), 0o755);
  await put(source, windowsLauncher, '@echo off\n');
  await chmod(path.join(source, windowsLauncher), 0o644);
  await adopt({ source, target });
  assert.equal((await stat(path.join(target, launcher))).mode & 0o777, 0o755);
  assert.equal((await stat(path.join(target, windowsLauncher))).mode & 0o777, 0o644);
  assert.equal(JSON.parse(await readFile(path.join(target, manifest))).modes[launcher], 0o755);
  assert.match((await promisify(execFile)(path.join(target, launcher))).stdout, /hook works/);
  assert.equal((await adopt({ source, target })).changed, false);

  await chmod(path.join(target, launcher), 0o644);
  await link(path.join(target, launcher), path.join(target, 'product-launcher'));
  const preview = await adopt({ source, target, dryRun: true });
  assert.ok(preview.operations.some(({ action, path: name }) => action === 'chmod' && name === launcher));
  assert.equal((await stat(path.join(target, launcher))).mode & 0o777, 0o644);
  await adopt({ source, target });
  assert.equal((await stat(path.join(target, launcher))).mode & 0o777, 0o755);
  assert.equal((await stat(path.join(target, 'product-launcher'))).mode & 0o777, 0o644);
  assert.equal((await adopt({ source, target })).changed, false);

  await chmod(path.join(source, launcher), 0o750);
  await adopt({ source, target });
  assert.equal((await stat(path.join(target, launcher))).mode & 0o777, 0o750);
  assert.equal((await adopt({ source, target })).changed, false);
});

test('never installs, owns, or removes downloaded runtime binaries', async (t) => {
  const { source, target } = await fixture(t);
  const binary = '.github/skills/impeccable/scripts/bin/platform/impeccable';
  await put(source, binary, 'downloaded native binary');
  const preview = await adopt({ source, target, dryRun: true });
  assert.ok(preview.operations.every(({ path: name }) => !name.includes('/scripts/bin')));
  await adopt({ source, target });
  await assert.rejects(readFile(path.join(target, binary)), { code: 'ENOENT' });
  const owned = JSON.parse(await readFile(path.join(target, manifest)));
  assert.equal(owned.files[binary], undefined);
  assert.equal(owned.modes[binary], undefined);
  await put(target, binary, 'product runtime binary');
  assert.equal((await adopt({ source, target })).changed, false);
  await adopt({ source, target, remove: true });
  assert.equal(await readFile(path.join(target, binary), 'utf8'), 'product runtime binary');
});
