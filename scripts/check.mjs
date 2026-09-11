#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setupEngine } from './setup-engine.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = '.github/skills/impeccable';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  }
  return result.stdout;
}

export async function check() {
  const pins = JSON.parse(await readFile(path.join(root, 'impeccable.lock.json'), 'utf8'));
  const files = [];
  async function walk(relative) {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = `${relative}/${entry.name}`;
      if (name === `${skill}/scripts/bin`) continue;
      if (entry.isDirectory()) await walk(name);
      else {
        assert(entry.isFile(), `Unexpected payload entry: ${name}`);
        files.push(name);
      }
    }
  }
  await walk(skill);
  files.push('.github/hooks/impeccable.json');
  assert.deepEqual(files.sort(), Object.keys(pins.files).sort(), 'Native payload file set changed');
  for (const name of files) {
    assert.equal(digest(await readFile(path.join(root, name))), pins.files[name], `Payload changed: ${name}`);
  }
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.devDependencies.impeccable, pins.cli);
  assert.equal((await readFile(path.join(root, skill, 'scripts/VERSION'), 'utf8')).trim(), pins.engine);
  assert.match(await readFile(path.join(root, skill, 'SKILL.md'), 'utf8'),
    new RegExp(`^version: ${pins.skill.replaceAll('.', '\\.')}\\s*$`, 'm'));
  const engine = await setupEngine(root);
  assert.equal(run(engine, ['engine-probe'], root).trim(), `impeccable-engine ${pins.engine}`);
  const env = { ...process.env, IMPECCABLE_SKILL_DIR: path.join(root, skill), IMPECCABLE_PROVIDER_ID: 'github' };
  const doctor = JSON.parse(run(engine, ['doctor', '--json'], root, { env }));
  assert.deepEqual(doctor.findings, [], 'Native doctor reported setup drift');

  const temporary = await mkdtemp(path.join(os.tmpdir(), 'etcha-hook-'));
  try {
    run('git', ['init', '--quiet'], temporary);
    await mkdir(path.join(temporary, '.github/hooks'), { recursive: true });
    await mkdir(path.join(temporary, skill, 'scripts'), { recursive: true });
    await cp(path.join(root, skill, 'scripts/impeccable'), path.join(temporary, skill, 'scripts/impeccable'));
    await cp(path.join(root, '.github/hooks/impeccable.json'), path.join(temporary, '.github/hooks/impeccable.json'));
    await writeFile(path.join(temporary, 'bad.css'), '.hero { font-family: Inter; }\n');
    const manifest = JSON.parse(await readFile(path.join(root, '.github/hooks/impeccable.json'), 'utf8'));
    assert.equal(manifest.version, 1);
    const hooks = manifest.hooks.postToolUse;
    assert(hooks.some((hook) => hook.matcher.includes('edit')), 'Edit matcher absent');
    const event = JSON.stringify({
      cwd: temporary, sessionId: 'etcha-native-self-check',
      toolName: 'edit', toolArgs: JSON.stringify({ path: path.join(temporary, 'bad.css') }),
      toolResult: { resultType: 'success' },
    });
    const output = hooks.map((hook) => run('bash', ['-c', hook.bash], temporary, {
      input: event,
      env: { ...env, IMPECCABLE_BIN: engine },
    })).join('\n');
    assert.match(output, /overused.font|Inter/i, 'Committed hook did not report the seeded violation');
    const result = spawnSync(engine, ['detect', '--json', 'bad.css'], {
      cwd: temporary, encoding: 'utf8', timeout: 30000, env,
    });
    assert.equal(result.status, 2, 'Seeded detector scan must fail');
    assert.match(result.stdout, /overused.font|Inter/i);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  console.log('Native payload, engine, doctor, detector, and committed Copilot hook passed.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
