#!/usr/bin/env node
import { constants } from 'node:fs';
import {
  lstat, mkdir, open, readdir, unlink,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const manifestPath = '.etcha/manifest.json';
const runtimeBin = '.github/skills/impeccable/scripts/bin';
const directories = [
  ['.github/skills/impeccable', true],
  ['.github/skills/etcha-design', false],
];
const files = [
  ['.github/hooks/impeccable.json', '.github/hooks/impeccable.json'],
  ['.impeccable/config.json', '.impeccable/config.json'],
  ['scripts/verify.mjs', '.etcha/harness/scripts/verify.mjs'],
  ['scripts/browser.mjs', '.etcha/harness/scripts/browser.mjs'],
  ['scripts/setup-engine.mjs', '.etcha/harness/scripts/setup-engine.mjs'],
  ['package.json', '.etcha/harness/package.json'],
  ['package-lock.json', '.etcha/harness/package-lock.json'],
  ['licenses/impeccable-LICENSE', '.etcha/harness/licenses/impeccable-LICENSE'],
];
const hash = (content) => createHash('sha256').update(content).digest('hex');

function validRelative(name) {
  return typeof name === 'string' && name.length > 0
    && !name.includes('\\') && !name.includes('\0')
    && !path.posix.isAbsolute(name)
    && name.split('/').every((part) => part && part !== '.' && part !== '..');
}

function ownedPath(name) {
  return validRelative(name) && name !== runtimeBin && !name.startsWith(`${runtimeBin}/`) && (
    directories.some(([directory]) => name.startsWith(`${directory}/`))
    || files.some(([, destination]) => name === destination)
  );
}

async function stat(name) {
  try {
    return await lstat(name);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safePath(name) {
  const absolute = path.resolve(name);
  const root = path.parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const info = await stat(current);
    if (!info) return null;
    if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
    if (index < parts.length - 1 && !info.isDirectory()) {
      throw new Error(`Ancestor is not a directory: ${current}`);
    }
    if (index === parts.length - 1) return info;
  }
  return stat(root);
}

async function readRegular(name, required = true) {
  const info = await safePath(name);
  if (!info) {
    if (required) throw new Error(`Required source file is absent: ${name}`);
    return null;
  }
  if (!info.isFile()) throw new Error(`Expected a regular file: ${name}`);
  const handle = await open(name, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function payload(source) {
  const result = new Map();
  async function collect(relative) {
    if (relative === runtimeBin) return;
    const info = await safePath(path.join(source, relative));
    if (!info) throw new Error(`Required source payload is absent: ${relative}`);
    if (info.isFile()) {
      if (!ownedPath(relative)) throw new Error(`Unsafe source path: ${relative}`);
      result.set(relative, {
        content: await readRegular(path.join(source, relative)),
        mode: info.mode & 0o777,
      });
    } else if (info.isDirectory()) {
      for (const entry of (await readdir(path.join(source, relative))).sort()) {
        await collect(`${relative}/${entry}`);
      }
    } else {
      throw new Error(`Unsupported source file: ${relative}`);
    }
  }
  for (const [directory, required] of directories) {
    const info = await safePath(path.join(source, directory));
    if (!info && !required) continue;
    if (!info?.isDirectory()) throw new Error(`Required source directory is absent: ${directory}`);
    const before = result.size;
    await collect(directory);
    if (required && result.size === before) {
      throw new Error(`Required source payload is empty: ${directory}`);
    }
  }
  for (const [from, to] of files) {
    let content = await readRegular(path.join(source, from));
    if (from === 'package.json') {
      let metadata;
      try {
        metadata = JSON.parse(content.toString('utf8'));
      } catch {
        throw new Error('Invalid source package.json');
      }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new Error('Invalid source package.json');
      }
      content = Buffer.from(`${JSON.stringify({
        ...metadata,
        scripts: { verify: 'node scripts/verify.mjs' },
      }, null, 2)}\n`);
    }
    result.set(to, { content, mode: (await safePath(path.join(source, from))).mode & 0o777 });
  }
  return result;
}

function parseManifest(content) {
  if (content === null) return { files: new Map(), modes: new Map() };
  let manifest;
  try {
    manifest = JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error('Invalid ownership manifest JSON');
  }
  if (!manifest || manifest.version !== 1 || !manifest.files
    || typeof manifest.files !== 'object' || Array.isArray(manifest.files)) {
    throw new Error('Invalid ownership manifest format');
  }
  const entries = Object.entries(manifest.files);
  for (const [name, digest] of entries) {
    if (!ownedPath(name) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) {
      throw new Error(`Unsafe ownership manifest entry: ${name}`);
    }
  }
  const owned = new Map(entries);
  const modes = manifest.modes ?? {};
  if (typeof modes !== 'object' || Array.isArray(modes)) {
    throw new Error('Invalid ownership manifest modes');
  }
  for (const [name, mode] of Object.entries(modes)) {
    if (!owned.has(name) || !Number.isInteger(mode) || mode < 0 || mode > 0o777) {
      throw new Error(`Unsafe ownership manifest mode: ${name}`);
    }
  }
  return { files: owned, modes: new Map(Object.entries(modes)) };
}

/**
 * Plan all changes before writing. An edited owned file blocks adoption;
 * removal preserves it and retains its ownership record for a later retry.
 */
export async function adopt({ source, target, dryRun = false, remove = false }) {
  if (typeof target !== 'string' || !path.isAbsolute(target)
    || target.split(/[\\/]/).includes('..')) {
    throw new Error('Target must be an absolute path without traversal');
  }
  source = path.resolve(source ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
  target = path.resolve(target);
  if (target === path.parse(target).root || target === source
    || source.startsWith(`${target}${path.sep}`)) {
    throw new Error('Refusing root target or the harness itself (including its ancestors)');
  }
  const targetInfo = await safePath(target);
  if (targetInfo && !targetInfo.isDirectory()) throw new Error('Target must be a directory');
  await safePath(source);
  const manifestFile = path.join(target, manifestPath);
  const oldManifest = await readRegular(manifestFile, false);
  const { files: previous, modes: previousModes } = parseManifest(oldManifest);
  const desired = remove ? new Map() : await payload(source);
  const next = new Map();
  const nextModes = new Map();
  const operations = [];
  const changes = [];
  const allPaths = [...new Set([...previous.keys(), ...desired.keys()])].sort();

  for (const name of allPaths) {
    const current = await readRegular(path.join(target, name), false);
    const oldHash = previous.get(name);
    const wanted = desired.get(name);
    if (current !== null && !oldHash) throw new Error(`Unowned file conflict: ${name}`);
    if (current !== null && hash(current) !== oldHash) {
      if (!remove) throw new Error(`Owned file was modified: ${name}`);
      operations.push({ action: 'preserve', path: name });
      next.set(name, oldHash);
      if (previousModes.has(name)) nextModes.set(name, previousModes.get(name));
      continue;
    }
    if (wanted !== undefined) {
      next.set(name, hash(wanted.content));
      nextModes.set(name, wanted.mode);
      if (current !== null && current.equals(wanted.content)) {
        const currentMode = (await safePath(path.join(target, name))).mode & 0o777;
        if (currentMode === wanted.mode) {
          operations.push({ action: 'keep', path: name });
        } else {
          changes.push({ action: 'chmod', path: name, ...wanted, before: current });
        }
      } else {
        changes.push({ action: 'write', path: name, ...wanted, before: current });
      }
    } else if (current !== null) {
      changes.push({ action: 'delete', path: name, before: current });
    }
  }

  if (!remove || next.size > 0) {
    const content = Buffer.from(`${JSON.stringify({
      version: 1,
      files: Object.fromEntries([...next].sort(([a], [b]) => a.localeCompare(b))),
      modes: Object.fromEntries([...nextModes].sort(([a], [b]) => a.localeCompare(b))),
    }, null, 2)}\n`);
    if (oldManifest === null || !oldManifest.equals(content)) {
      changes.push({ action: 'write', path: manifestPath, content, before: oldManifest });
    } else {
      operations.push({ action: 'keep', path: manifestPath });
    }
  } else if (oldManifest !== null) {
    changes.push({ action: 'delete', path: manifestPath, before: oldManifest });
  }

  const neededDirectories = new Set();
  for (const change of changes) {
    if (change.action !== 'write') continue;
    let directory = path.dirname(path.join(target, change.path));
    while (directory !== path.parse(directory).root) {
      const info = await safePath(directory);
      if (info) {
        if (!info.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
        break;
      }
      neededDirectories.add(directory);
      directory = path.dirname(directory);
    }
  }
  const orderedDirectories = [...neededDirectories].sort((a, b) => (
    a.split(path.sep).length - b.split(path.sep).length || a.localeCompare(b)
  ));
  operations.push(...orderedDirectories.map((directory) => ({
    action: 'mkdir', path: path.relative(target, directory) || '.',
  })));
  operations.push(...changes.map(({ action, path: name }) => ({ action, path: name })));
  if (!dryRun) {
    for (const directory of orderedDirectories) {
      const info = await safePath(directory);
      if (info && !info.isDirectory()) throw new Error(`Expected a directory: ${directory}`);
      if (!info) await mkdir(directory);
    }
    for (const change of changes) {
      const destination = path.join(target, change.path);
      const current = await readRegular(destination, false);
      if ((current === null) !== (change.before === null)
        || (current !== null && !current.equals(change.before))) {
        throw new Error(`File changed during adoption: ${change.path}`);
      }
      if (change.action === 'delete') {
        await unlink(destination);
      } else {
        // Replace rather than truncate/chmod through a hard link into product files.
        if (current !== null) await unlink(destination);
        await safePath(path.dirname(destination));
        const handle = await open(destination,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
        try {
          await handle.writeFile(change.content);
          await handle.chmod(change.mode ?? 0o644);
        } finally {
          await handle.close();
        }
      }
    }
  }
  return { operations, changed: changes.length > 0 };
}

async function main(args) {
  let target;
  let dryRun = false;
  let remove = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--target' && !target && args[index + 1] && !args[index + 1].startsWith('--')) {
      target = args[++index];
    } else if (arg === '--dry-run' && !dryRun) {
      dryRun = true;
    } else if (arg === '--remove' && !remove) {
      remove = true;
    } else {
      throw new Error('Usage: node scripts/adopt.mjs --target ABS [--dry-run] [--remove]');
    }
  }
  const result = await adopt({ target, dryRun, remove });
  for (const operation of result.operations) {
    console.log(`${dryRun ? '[dry-run] ' : ''}${operation.action.toUpperCase()} ${operation.path}`);
  }
  if (result.operations.length === 0) console.log('No owned files to remove.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Adoption failed: ${error.message}`);
    process.exitCode = 1;
  });
}
