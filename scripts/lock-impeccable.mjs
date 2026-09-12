#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = '.github/skills/impeccable';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--reviewed-skill' || !/^\d+\.\d+\.\d+$/.test(args[1])) {
  throw new Error('Usage: node scripts/lock-impeccable.mjs --reviewed-skill VERSION (after reviewing the native diff)');
}
const text = await readFile(path.join(root, skill, 'SKILL.md'), 'utf8');
const version = /^version: (.+)$/m.exec(text)?.[1].trim();
if (version !== args[1]) throw new Error('Reviewed skill version does not match installed version');
const files = {};
async function walk(relative) {
  for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true }))
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const name = `${relative}/${entry.name}`;
    if (name === `${skill}/scripts/bin`) continue;
    if (entry.isDirectory()) await walk(name);
    else {
      if (!entry.isFile()) throw new Error(`Unexpected payload entry: ${name}`);
      files[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
    }
  }
}
await walk(skill);
const hook = '.github/hooks/impeccable.json';
files[hook] = createHash('sha256').update(await readFile(path.join(root, hook))).digest('hex');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
await writeFile(path.join(root, 'impeccable.lock.json'), `${JSON.stringify({
  source: `https://github.com/pbakaus/impeccable/releases/tag/skill-v${version}`,
  cli: pkg.devDependencies.impeccable,
  skill: version,
  engine: (await readFile(path.join(root, skill, 'scripts/VERSION'), 'utf8')).trim(),
  files,
}, null, 2)}\n`);
console.log('Recorded native payload hashes. Review and commit the lock with the payload.');
