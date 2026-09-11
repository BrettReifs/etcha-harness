#!/usr/bin/env node
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function rejectSymlinks(name) {
  const absolute = path.resolve(name);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Symlink not allowed: ${current}`);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

export async function setupEngine(root = home) {
  root = path.resolve(root);
  await rejectSymlinks(root);
  const os = { linux: 'linux', darwin: 'darwin', win32: 'windows' }[process.platform];
  if (!os || !['x64', 'arm64'].includes(process.arch)) {
    throw new Error(`Unsupported engine platform: ${process.platform}-${process.arch}`);
  }
  const platform = `${os}-${process.arch}`;
  const pkgPath = require.resolve(`@impeccable/cli-${platform}/package.json`);
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  const skill = path.join(root, '.github/skills/impeccable');
  await rejectSymlinks(path.join(skill, 'scripts/VERSION'));
  const version = (await readFile(path.join(skill, 'scripts/VERSION'), 'utf8')).trim();
  if (pkg.version !== version) throw new Error(`Engine mismatch: ${pkg.version} != ${version}`);
  const executable = os === 'windows' ? 'impeccable.exe' : 'impeccable';
  const directory = path.join(skill, 'scripts/bin', platform);
  await rejectSymlinks(directory);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, executable);
  await rejectSymlinks(destination);
  const bytes = await readFile(path.join(path.dirname(pkgPath), 'bin', executable));
  try {
    const info = await lstat(destination);
    if (!info.isFile()) throw new Error(`Expected regular engine file: ${destination}`);
    await unlink(destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const handle = await open(destination,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o755);
  try {
    await handle.writeFile(bytes);
    await handle.chmod(0o755);
  } finally {
    await handle.close();
  }
  return destination;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--root' || !path.isAbsolute(args[1]))) {
    console.error('Usage: node scripts/setup-engine.mjs [--root ABS]');
    process.exitCode = 1;
  } else {
    setupEngine(args[1]).then(
      () => console.log('Pinned native engine ready.'),
      (error) => { console.error(error.message); process.exitCode = 1; },
    );
  }
}
