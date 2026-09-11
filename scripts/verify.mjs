#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const browserChecks = ['axe', 'smoke', 'keyboard', 'focusVisible', 'responsive', 'reducedMotion', 'zoom', 'visual'];
export const finding = (severity, rule, surface, evidence, action) => ({ severity, rule, surface, evidence, action });
export const blocking = (rule, surface, evidence, action) => finding('blocking', rule, surface, evidence, action);
export const validCommand = (command) => Array.isArray(command) && command.length > 0
  && command.every((part) => typeof part === 'string' && part.length > 0 && !part.includes('\0'));
export const validTimeout = (value) => Number.isInteger(value) && value >= 1 && value <= 600_000;

export async function loadConfig(configPath) {
  const absolute = path.resolve(configPath);
  const config = JSON.parse(await readFile(absolute, 'utf8'));
  if (!config || typeof config !== 'object' || Array.isArray(config) || config.version !== 1) {
    throw new Error('Configuration must be an object with version: 1.');
  }
  if (config.root !== undefined && typeof config.root !== 'string') throw new Error('root must be a path string.');
  return { config, configPath: absolute, root: path.resolve(path.dirname(absolute), config.root ?? '.') };
}

export function configArgument(argv) {
  if (argv.length !== 2 || argv[0] !== '--config' || !path.isAbsolute(argv[1])) {
    throw new Error('Usage: node scripts/verify.mjs --config ABSOLUTE_JSON_PATH');
  }
  return argv[1];
}

// Each spawned command owns a process group on POSIX, including its descendants.
export function terminate(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

export function runCommand(command, { cwd, timeoutMs = 60_000, maxOutput = 64_000 } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputTruncated = false;
    let spawnError;
    let killTimer;
    const child = spawn(command[0], command.slice(1), {
      cwd, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    const collect = (current, chunk) => {
      const next = current + chunk.toString();
      if (next.length > maxOutput) outputTruncated = true;
      return next.slice(-maxOutput);
    };
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.on('error', (error) => { spawnError = error.message; });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
      killTimer = setTimeout(() => terminate(child, 'SIGKILL'), 200);
    }, timeoutMs);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      // A command may exit while a descendant remains in its process group.
      terminate(child, 'SIGKILL');
      resolve({ code, signal, stdout, stderr, timedOut, outputTruncated, error: spawnError });
    });
  });
}

function commandSpec(value) {
  return value && validCommand(value.command) && (value.timeoutMs === undefined || validTimeout(value.timeoutMs));
}

function evidenceFor(result) {
  const safeOutput = (value) => value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_.=-]+/gi, '[REDACTED AUTHORIZATION]')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi, '$1[REDACTED]@')
    .replace(/((?:password|passwd|token|secret|api[_-]?key)\s*["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED TOKEN]')
    .slice(-4000);
  return { exitCode: result.code, signal: result.signal, timedOut: result.timedOut,
    error: result.error, outputBytes: Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
    stdout: safeOutput(result.stdout), stderr: safeOutput(result.stderr), outputTruncated: result.outputTruncated,
    evidenceTruncated: result.stdout.length > 4000 || result.stderr.length > 4000 };
}

function nativeDetectorFindings(result) {
  if (![0, 2].includes(result.code) || result.timedOut || result.outputTruncated) return null;
  let values;
  try { values = JSON.parse(result.stdout); } catch { return null; }
  if (!Array.isArray(values) || !values.every((item) => item
    && ['antipattern', 'name', 'description', 'file'].every((key) => typeof item[key] === 'string')
    && Number.isInteger(item.line))) return null;
  return values.map((item) => finding(
    result.code === 2 ? 'blocking' : 'high-value',
    `detect.${item.antipattern}`, `${item.file}:${item.line}`,
    { name: item.name, nativeSeverity: item.severity, category: item.category, exitCode: result.code },
    item.description || 'Resolve the native detector finding and rerun.',
  ));
}

export function groupFindings(findings) {
  return {
    blocking: findings.filter((item) => item.severity === 'blocking'),
    'high-value': findings.filter((item) => item.severity === 'high-value'),
    advisory: findings.filter((item) => item.severity === 'advisory'),
  };
}

function validateBrowserReport(report) {
  if (report?.schemaVersion !== 1 || !Array.isArray(report.findings) || !report.coverage
    || typeof report.coverage !== 'object') return false;
  return report.findings.every((item) => item && ['blocking', 'high-value', 'advisory'].includes(item.severity)
    && ['rule', 'surface', 'action'].every((key) => typeof item[key] === 'string' && item[key].length > 0)
    && Object.hasOwn(item, 'evidence'));
}

export async function verify(configPath) {
  const findings = [];
  const commands = {};
  let loaded;
  try { loaded = await loadConfig(configPath); }
  catch (error) {
    findings.push(blocking('config.invalid', 'configuration', error.message, 'Provide a readable version 1 JSON configuration.'));
    return { schemaVersion: 1, ok: false, findings: groupFindings(findings) };
  }
  const { config, root } = loaded;
  for (const name of ['build', 'detect']) {
    if (!commandSpec(config[name])) {
      findings.push(blocking(`${name}.missing`, name, 'An explicit command argv and valid optional timeoutMs are required.',
        name === 'detect' ? 'Configure the product-native detector; no substitute detector is inferred.' : 'Configure the product build command.'));
      continue;
    }
    const result = await runCommand(config[name].command, { cwd: root, timeoutMs: config[name].timeoutMs });
    commands[name] = evidenceFor(result);
    const nativeReport = name === 'detect' ? nativeDetectorFindings(result) : null;
    const nativeFindings = nativeReport ?? [];
    findings.push(...nativeFindings);
    if (name === 'detect' && result.code === 0 && result.outputTruncated) {
      findings.push(blocking('detect.output-truncated', 'detect', evidenceFor(result),
        'Reduce detector output to a bounded complete report before accepting the result.'));
    }
    if (result.code !== 0 || result.error || result.timedOut) {
      if (!nativeFindings.length) {
        const outcome = result.timedOut ? 'timeout' : name === 'detect' && result.code === 2 ? 'findings' : 'failed';
        findings.push(blocking(`${name}.${outcome}`, name, evidenceFor(result),
          outcome === 'findings' ? 'Resolve native detector primary findings and rerun with --json for structured details.'
            : `Fix the ${name} command and rerun verification.`));
      }
    }
  }
  let coverage = Object.fromEntries(browserChecks.map((key) => [key, false]));
  let browserEvidence;
  if (!config.browser || typeof config.browser !== 'object') {
    findings.push(blocking('browser.missing', 'browser', 'No browser configuration.', 'Configure explicit states and approved viewports.'));
  } else {
    const adapter = config.browser.adapter;
    const command = adapter === undefined
      ? [process.execPath, fileURLToPath(new URL('./browser.mjs', import.meta.url))]
      : adapter?.command;
    const timeoutMs = config.browser.timeoutMs ?? 120_000;
    if (!validCommand(command) || !validTimeout(timeoutMs)) {
      findings.push(blocking('browser.adapter.invalid', 'browser', 'Invalid adapter command or timeoutMs.', 'Use an argv command and a timeout between 1 and 600000 ms.'));
    } else {
      const result = await runCommand([...command, '--config', loaded.configPath], { cwd: root, timeoutMs, maxOutput: 1_000_000 });
      let report;
      try { report = JSON.parse(result.stdout); } catch { /* Invalid output is a blocking adapter contract failure. */ }
      if (!validateBrowserReport(report) || result.outputTruncated) {
        findings.push(blocking('browser.adapter.invalid-report', 'browser', evidenceFor(result),
          'Return one JSON object with schemaVersion: 1, findings: [], and all browser coverage keys.'));
      } else {
        findings.push(...report.findings);
        coverage = Object.fromEntries(browserChecks.map((key) => [key, report.coverage[key] === true]));
        browserEvidence = { artifacts: report.artifacts, browserVersion: report.browserVersion };
      }
      if (result.error || result.timedOut || (result.code !== 0
        && (!validateBrowserReport(report) || !report.findings.some((item) => item.severity === 'blocking')))) {
        findings.push(blocking(`browser.${result.timedOut ? 'timeout' : 'failed'}`, 'browser', evidenceFor(result),
          'Fix the browser adapter or its reported failures and rerun.'));
      }
    }
  }
  for (const key of browserChecks) {
    if (!coverage[key]) findings.push(blocking('coverage.missing', key, `No completed ${key} coverage.`, `Provide and execute explicit ${key} checks; unsupported checks remain blocking.`));
  }
  return { schemaVersion: 1, ok: !findings.some((item) => item.severity === 'blocking'),
    findings: groupFindings(findings), coverage, browser: browserEvidence, commands };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await verify(configArgument(process.argv.slice(2)));
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } catch (error) {
    console.log(JSON.stringify({ schemaVersion: 1, ok: false, findings: groupFindings([
      blocking('config.invalid', 'configuration', error.message, 'Pass --config followed by an absolute JSON path.'),
    ]) }, null, 2));
    process.exitCode = 1;
  }
}
