#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { blocking, browserChecks, configArgument, finding, loadConfig, terminate, validCommand, validTimeout } from './verify.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sameOrInside = (parent, child) => child === parent || child.startsWith(parent + path.sep);
const targetValid = (target) => target && typeof target.role === 'string' && target.role.length > 0
  && typeof target.name === 'string';
const targetFor = (page, target) => page.getByRole(target.role, { name: target.name, exact: true });
const surfaceFor = (state, viewport) => `${state.name}/${viewport.name}`;

async function canonical(filename) {
  try { return await realpath(filename); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(filename);
    if (parent === filename) throw error;
    return path.join(await canonical(parent), path.basename(filename));
  }
}

function validate(browser) {
  if (!browser || typeof browser !== 'object') throw new Error('browser configuration is required.');
  const url = new URL(browser.baseURL);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password) throw new Error('baseURL must be a credential-free localhost HTTP(S) URL.');
  if (!Array.isArray(browser.viewports) || browser.viewports.length !== 3
    || new Set(browser.viewports.map((value) => value.name)).size !== 3
    || !browser.viewports.every((value) => ['desktop', 'tablet', 'mobile'].includes(value.name)
      && value.approved === true && Number.isInteger(value.width) && value.width >= 240 && value.width <= 3840
      && Number.isInteger(value.height) && value.height >= 240 && value.height <= 2160)) {
    throw new Error('viewports must explicitly approve desktop, tablet, mobile with integer width/height.');
  }
  if (!Array.isArray(browser.states) || !browser.states.length || browser.states.length > 20
    || new Set(browser.states.map((state) => state.name)).size !== browser.states.length) {
    throw new Error('states must contain 1–20 uniquely named states.');
  }
  for (const state of browser.states) {
    if (!/^[a-zA-Z0-9_-]+$/.test(state.name) || typeof state.path !== 'string'
      || !state.path.startsWith('/') || new URL(state.path, url).origin !== url.origin) {
      throw new Error('Each state requires a safe name and same-origin absolute path.');
    }
    if (state.actions !== undefined && (!Array.isArray(state.actions) || state.actions.length > 30
      || !state.actions.every((action) => action && ['click', 'fill', 'press', 'waitFor'].includes(action.type)
        && (action.type === 'press' ? typeof action.key === 'string' : targetValid(action))
        && (action.type !== 'fill' || typeof action.value === 'string')))) {
      throw new Error(`Invalid actions for ${state.name}.`);
    }
    for (const name of ['smoke', 'keyboard']) {
      if (state[name] !== undefined && (!Array.isArray(state[name]) || !state[name].every(targetValid))) {
        throw new Error(`${state.name}.${name} must contain accessible role/name targets.`);
      }
    }
    if (state.reducedMotion !== undefined && (!Array.isArray(state.reducedMotion)
      || !state.reducedMotion.every((item) => item && typeof item.selector === 'string'
        && typeof item.property === 'string' && typeof item.equals === 'string'))) {
      throw new Error(`${state.name}.reducedMotion must contain selector/property/equals expectations.`);
    }
  }
  if (browser.start !== undefined && (!validCommand(browser.start?.command)
    || (browser.start.timeoutMs !== undefined && !validTimeout(browser.start.timeoutMs)))) {
    throw new Error('start requires a command argv and an optional 1–600000 ms timeoutMs.');
  }
  if (browser.checkTimeoutMs !== undefined && !validTimeout(browser.checkTimeoutMs)) throw new Error('Invalid checkTimeoutMs.');
  if (browser.channel !== undefined && !['chrome', 'chromium'].includes(browser.channel)) throw new Error('channel must be chrome or chromium when specified.');
  if (browser.zoom !== undefined && (!['unsupported', 'reflow-model'].includes(browser.zoom?.mode)
    || (browser.zoom.mode === 'unsupported' && (typeof browser.zoom.reason !== 'string' || !browser.zoom.reason.trim()))
    || (browser.zoom.approved !== undefined && typeof browser.zoom.approved !== 'boolean'))) {
    throw new Error('zoom requires mode "reflow-model" with explicit approved: true, or mode "unsupported" with a reason.');
  }
  for (const key of ['baselineDir', 'artifactsDir', 'approvalManifest']) {
    if (browser[key] !== undefined && (typeof browser[key] !== 'string' || !browser[key])) throw new Error(`${key} must be a nonempty path.`);
  }
  return url;
}

async function startServer(spec, root, baseURL, onStarted) {
  if (!spec) return undefined;
  const child = spawn(spec.command[0], spec.command.slice(1), {
    cwd: root, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe'],
  });
  onStarted(child);
  let error;
  let stderrBytes = 0;
  child.on('error', (value) => { error = value.message; });
  child.stderr.on('data', (chunk) => { stderrBytes += chunk.length; });
  const deadline = Date.now() + (spec.timeoutMs ?? 15_000);
  try {
    while (Date.now() < deadline) {
      if (error || child.exitCode !== null) throw new Error(error ?? `Server exited (${child.exitCode}); ${stderrBytes} stderr bytes withheld.`);
      try {
        const response = await fetch(baseURL, { signal: AbortSignal.timeout(500), redirect: 'manual' });
        await response.body?.cancel();
        if (response.status >= 200 && response.status < 400) return child;
      } catch { /* Retry until the bounded readiness deadline. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Server readiness timed out; ${stderrBytes} stderr bytes withheld.`);
  } catch (error) {
    await stopServer(child);
    throw error;
  }
}

async function stopServer(child) {
  if (!child) return;
  terminate(child);
  await new Promise((resolve) => setTimeout(resolve, 200));
  terminate(child, 'SIGKILL');
}

async function applyActions(page, state) {
  for (const action of state.actions ?? []) {
    if (action.type === 'press') await page.keyboard.press(action.key);
    else if (action.type === 'click') await targetFor(page, action).click();
    else if (action.type === 'fill') await targetFor(page, action).fill(action.value);
    else await targetFor(page, action).waitFor({ state: 'visible' });
  }
}

async function openState(page, state, baseURL) {
  const response = await page.goto(new URL(state.path, baseURL).href, { waitUntil: 'load' });
  if (!response?.ok()) throw new Error(`Navigation returned HTTP ${response?.status() ?? 'no response'}.`);
  await applyActions(page, state);
  await page.evaluate(() => document.fonts.ready);
}

async function approvalFor(browser, root, configPath) {
  if (!browser.baselineDir || !browser.approvalManifest) return { error: 'baselineDir and approvalManifest are required.' };
  try {
    const manifest = JSON.parse(await readFile(path.resolve(root, browser.approvalManifest), 'utf8'));
    const configSha256 = digest(await readFile(configPath));
    if (manifest.version !== 1 || manifest.configSha256 !== configSha256
      || typeof manifest.approvedBy !== 'string' || !manifest.approvedBy.trim()
      || typeof manifest.approvedAt !== 'string' || !Number.isFinite(Date.parse(manifest.approvedAt))
      || !manifest.baselines || typeof manifest.baselines !== 'object' || Array.isArray(manifest.baselines)) {
      return { error: 'Approval must identify a human reviewer/date, exact configuration SHA-256, and baseline digests.' };
    }
    return { manifest };
  } catch (error) { return { error: `Cannot read human approval manifest: ${error.message}` }; }
}

async function focusEvidence(locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth, outlineColor: style.outlineColor,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow, backgroundColor: style.backgroundColor,
      borderColor: style.borderColor, borderWidth: style.borderWidth,
    };
  });
}

async function localContext(instance, baseURL, options = {}) {
  const context = await instance.newContext({ ...options, serviceWorkers: 'block' });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === baseURL.origin || ['data:', 'blob:'].includes(url.protocol)
      ? route.continue() : route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', (socket) => { socket.close(); });
  return context;
}

async function checkReflow(instance, browser, baseURL, state, viewport, surfaceDir, findings) {
  const modeledViewport = { width: Math.floor(viewport.width / 2), height: Math.floor(viewport.height / 2) };
  const context = await localContext(instance, baseURL, { viewport: modeledViewport, deviceScaleFactor: 2 });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(browser.checkTimeoutMs ?? 5000);
    page.setDefaultNavigationTimeout(browser.checkTimeoutMs ?? 5000);
    await openState(page, state, baseURL);
    if (!state.smoke?.length) throw new Error('Explicit smoke expectations are required to check information at modeled 200% reflow.');
    const metrics = await page.evaluate(() => ({
      width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio,
      documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body?.scrollWidth ?? 0,
    }));
    if (metrics.width !== modeledViewport.width || metrics.height !== modeledViewport.height || metrics.deviceScaleFactor !== 2) {
      throw new Error('The browser did not apply the requested half-size CSS viewport and deviceScaleFactor 2.');
    }
    const surface = `${state.name}/desktop/200%-reflow-model`;
    if (Math.max(metrics.documentWidth, metrics.bodyWidth) > metrics.width + 1) {
      findings.push(blocking('zoom.reflow-overflow', surface, metrics, 'Remove horizontal overflow at the modeled 200% layout.'));
    }
    for (const target of [...state.smoke, ...(state.keyboard ?? [])]) {
      const locator = targetFor(page, target);
      const count = await locator.count();
      const box = count === 1 ? await locator.boundingBox() : null;
      if (count !== 1 || !box || !await locator.isVisible() || box.x < -1 || box.x + box.width > metrics.width + 1) {
        findings.push(blocking('zoom.required-information', surface, { target, count, box },
          'Keep the declared information and controls visible and horizontally reachable at modeled 200% reflow.'));
      }
    }
    const image = path.join(surfaceDir, 'zoom-200-reflow-model.png');
    const imageSha256 = digest(await page.screenshot({ path: image, fullPage: true, animations: 'disabled' }));
    const evidence = {
      mode: 'reflow-model', genuineBrowserZoom: false, originalViewport: viewport,
      modeledViewport, metrics, image, imageSha256, requiredInformation: state.smoke,
    };
    await writeFile(path.join(surfaceDir, 'zoom-200-reflow-model.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' });
    findings.push(finding('advisory', 'zoom.reflow-model.evidence', surface, evidence,
      'This is simulated CSS-viewport reflow, not genuine browser-UI zoom; human review is still needed.'));
  } finally {
    await context.close();
  }
}

export async function runBrowser(configPath) {
  const findings = [];
  const coverage = Object.fromEntries(browserChecks.map((key) => [key, false]));
  let server;
  let instance;
  let interrupted = false;
  let profileDirectory;
  const originalTmp = process.env.TMPDIR;
  const onSignal = () => { interrupted = true; terminate(server, 'SIGKILL'); void instance?.close(); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  try {
    const { config, root, configPath: absoluteConfig } = await loadConfig(configPath);
    const browser = config.browser;
    const baseURL = validate(browser);
    const artifactsRoot = await canonical(path.resolve(root, browser.artifactsDir ?? '.etcha-artifacts'));
    const baselineRoot = browser.baselineDir ? await canonical(path.resolve(root, browser.baselineDir)) : undefined;
    const approvalPath = browser.approvalManifest ? await canonical(path.resolve(root, browser.approvalManifest)) : undefined;
    if ((baselineRoot && (sameOrInside(baselineRoot, artifactsRoot) || sameOrInside(artifactsRoot, baselineRoot)))
      || (approvalPath && sameOrInside(artifactsRoot, approvalPath))) {
      throw new Error('Artifact directory must be separate from baseline and approval paths (including symlinks).');
    }
    const runDir = path.join(artifactsRoot, randomUUID());
    await mkdir(runDir, { recursive: true });
    // Keep socket paths short and temporary browser profiles outside the product.
    profileDirectory = await mkdtemp(path.join(tmpdir(), 'etcha-browser-'));
    process.env.TMPDIR = profileDirectory;
    const approval = await approvalFor(browser, root, absoluteConfig);
    if (approval.error) findings.push(blocking('visual.approval.missing', 'visual', approval.error,
      'A human must review candidate images externally, copy accepted baselines, and sign their digests in the product-owned manifest. The harness never approves or updates baselines.'));
    server = await startServer(browser.start, root, baseURL.href, (child) => { server = child; });
    try {
      instance = await chromium.launch({
        headless: true, chromiumSandbox: true, channel: browser.channel,
        ignoreDefaultArgs: ['--disable-ipc-flooding-protection', '--unsafely-disable-devtools-self-xss-warnings', '--enable-unsafe-swiftshader'],
      });
    }
    catch (error) {
      findings.push(blocking('browser.sandbox.unavailable', 'browser', { error: error.message.split('\n')[0], channel: browser.channel ?? 'bundled headless shell' },
        'Install Chromium and enable a supported non-root Chromium sandbox environment. This harness never disables the sandbox.'));
      return { schemaVersion: 1, findings, coverage, artifacts: runDir };
    }
    const complete = Object.fromEntries(browserChecks.map((key) => [key, true]));
    const modelZoom = browser.zoom?.mode === 'reflow-model' && browser.zoom.approved === true;
    complete.zoom = modelZoom;
    if (!modelZoom) findings.push(blocking('zoom.unsupported', 'all states/viewports',
      { requested: '200% layout coverage', reason: browser.zoom?.mode === 'reflow-model'
        ? 'The reflow model requires explicit approved: true.' : browser.zoom?.reason ?? 'No zoom strategy is configured.' },
      'Select zoom: {mode: "reflow-model", approved: true} for explicitly modeled reflow, or use a replacement adapter with genuine browser zoom evidence.'));
    findings.push(finding('advisory', 'focus.evidence.limit', 'keyboard',
      'Evidence checks :focus-visible and computed-style changes, plus focused screenshots; it does not prove contrast, unclipped appearance, or perceptual visibility.',
      'Human review must assess focus indicator visibility and contrast on the saved focused images.'));
    const context = await localContext(instance, baseURL);
    for (const state of browser.states) {
      for (const viewport of browser.viewports) {
        if (interrupted) throw new Error('Browser verification interrupted.');
        const surface = surfaceFor(state, viewport);
        const page = await context.newPage();
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        page.setDefaultTimeout(browser.checkTimeoutMs ?? 5000);
        page.setDefaultNavigationTimeout(browser.checkTimeoutMs ?? 5000);
        const surfaceDir = path.join(runDir, state.name, viewport.name);
        await mkdir(surfaceDir, { recursive: true });
        const check = async (key, operation) => {
          try { await operation(); }
          catch (error) {
            complete[key] = false;
            findings.push(blocking(`${key}.error`, surface, error.message, `Fix the ${key} check or state, then rerun.`));
          }
        };
        try {
          await openState(page, state, baseURL);
        } catch (error) {
          for (const key of browserChecks) complete[key] = false;
          findings.push(blocking('state.unavailable', surface, error.message, 'Make this named state reachable and its actions deterministic.'));
          await page.close();
          continue;
        }
        if (modelZoom && viewport.name === 'desktop') {
          await check('zoom', () => checkReflow(instance, browser, baseURL, state, viewport, surfaceDir, findings));
        }
        await check('smoke', async () => {
          if (!state.smoke?.length) throw new Error('At least one explicit smoke role/name expectation is required.');
          for (const target of state.smoke) {
            const locator = targetFor(page, target);
            if (await locator.count() !== 1 || !await locator.isVisible()) {
              findings.push(blocking('smoke.expected-target', surface, target, 'Restore the unique visible accessible role/name.'));
            }
          }
        });
        await check('axe', async () => {
          const result = await new AxeBuilder({ page }).analyze();
          for (const violation of result.violations) findings.push(blocking(`axe.${violation.id}`, surface,
            { impact: violation.impact, help: violation.help, nodes: violation.nodes.slice(0, 10).map((node) => ({ target: node.target, summary: node.failureSummary })) },
            violation.helpUrl));
          for (const incomplete of result.incomplete) findings.push(finding('high-value', `axe.review.${incomplete.id}`, surface,
            { help: incomplete.help, targets: incomplete.nodes.slice(0, 10).map((node) => node.target) }, 'Review this inconclusive axe result manually.'));
        });
        await check('responsive', async () => {
          const metrics = await page.evaluate(() => ({
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            bodyWidth: document.body?.scrollWidth ?? 0,
          }));
          if (Math.max(metrics.documentWidth, metrics.bodyWidth) > metrics.viewportWidth + 1) {
            findings.push(blocking('responsive.horizontal-overflow', surface, metrics, 'Remove unintended horizontal document overflow at this approved viewport.'));
          }
        });
        await check('visual', async () => {
          const candidate = path.join(surfaceDir, 'candidate.png');
          const bytes = await page.screenshot({ path: candidate, fullPage: true, animations: 'disabled' });
          const key = `${state.name}/${viewport.name}.png`;
          if (!baselineRoot) throw new Error(`No baselineDir configured. Candidate: ${candidate}`);
          const baseline = path.join(baselineRoot, key);
          let expected;
          try { expected = await readFile(baseline); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            findings.push(blocking('visual.baseline.missing', surface, { candidate, baseline }, 'Ask a human to review the candidate externally and establish an approved baseline.'));
            return;
          }
          const baselineDigest = digest(expected);
          if (approval.manifest?.baselines[key] !== baselineDigest) {
            findings.push(blocking('visual.approval.digest', surface, { baseline, baselineSha256: baselineDigest, candidate },
              'A human must approve this exact baseline digest for this exact configuration; do not autoapprove.'));
          }
          if (!expected.equals(bytes)) {
            findings.push(blocking('visual.mismatch', surface, { before: baseline, after: candidate,
              baselineSha256: baselineDigest, candidateSha256: digest(bytes) },
            'Review before/after images externally. Fix the change or obtain explicit human approval of a new baseline outside this tool.'));
          }
        });
        await check('keyboard', async () => {
          if (!state.keyboard?.length) {
            complete.focusVisible = false;
            throw new Error('An explicit complete keyboard role/name tab order is required.');
          }
          // Restore the state, then seed navigation before its first element; every tested focus is a real Tab.
          await openState(page, state, baseURL);
          await page.evaluate(() => {
            const start = document.createElement('span');
            start.tabIndex = -1;
            document.body.prepend(start);
            start.focus();
            start.remove();
          });
          const before = [];
          for (const target of state.keyboard) before.push(await focusEvidence(targetFor(page, target)));
          for (const [index, target] of state.keyboard.entries()) {
            await page.keyboard.press('Tab');
            const locator = targetFor(page, target);
            const focused = await locator.evaluate((element) => element.matches(':focus'));
            if (!focused) {
              complete.focusVisible = false;
              findings.push(blocking('keyboard.tab-order', surface,
                { step: index + 1, expected: target, actual: await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500)) },
                'Restore the exact expected Tab order, including all interactive elements.'));
              continue;
            }
            const evidence = await focusEvidence(locator);
            const focusImage = path.join(surfaceDir, `focus-${index + 1}.png`);
            await page.screenshot({ path: focusImage, animations: 'disabled' });
            const outline = !['none', 'hidden'].includes(evidence.outlineStyle)
              && parseFloat(evidence.outlineWidth) > 0 && !['transparent', 'rgba(0, 0, 0, 0)'].includes(evidence.outlineColor)
              && ['outlineStyle', 'outlineWidth', 'outlineColor', 'outlineOffset'].some((key) => evidence[key] !== before[index][key]);
            const changed = ['boxShadow', 'backgroundColor', 'borderColor', 'borderWidth']
              .some((key) => evidence[key] !== before[index][key]);
            await writeFile(path.join(surfaceDir, `focus-${index + 1}.json`), JSON.stringify({ target, before: before[index], after: evidence, image: focusImage }, null, 2), { flag: 'wx' });
            if (!evidence.focusVisible || (!outline && !changed)) findings.push(blocking('focus.indicator.missing', surface,
              { step: index + 1, target, ...evidence, image: focusImage }, 'Provide a visible keyboard focus indicator; review its screenshot for perceptual visibility.'));
          }
          await page.keyboard.press('Tab');
          const extra = await page.evaluate(() => {
            const element = document.activeElement;
            return element && element !== document.body && element !== document.documentElement ? element.outerHTML.slice(0, 500) : null;
          });
          if (extra) findings.push(blocking('keyboard.unexpected-extra-stop', surface, extra, 'Include every Tab stop in the exact expected order, or remove unintended focusability.'));
        });
        if (!complete.keyboard) complete.focusVisible = false;
        await check('reducedMotion', async () => {
          if (!state.reducedMotion?.length) throw new Error('Explicit reducedMotion CSS expectations are required.');
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await openState(page, state, baseURL);
          for (const expected of state.reducedMotion) {
            const locator = page.locator(expected.selector);
            if (await locator.count() !== 1) throw new Error(`Reduced motion selector must match one element: ${expected.selector}`);
            const actual = await locator.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), expected.property);
            if (actual.trim() !== expected.equals) findings.push(blocking('motion.expected-style', surface,
              { ...expected, actual }, 'Honor the reduced-motion media preference with the configured computed style.'));
          }
        });
        await page.close();
      }
    }
    Object.assign(coverage, complete);
    await context.close();
    return { schemaVersion: 1, findings, coverage, artifacts: runDir, browserVersion: instance.version() };
  } catch (error) {
    findings.push(blocking('browser.failed', 'browser', error.message, 'Correct browser configuration/startup and rerun all required coverage.'));
    return { schemaVersion: 1, findings, coverage };
  } finally {
    await instance?.close().catch(() => {});
    await stopServer(server);
    // Playwright removes its uniquely named child directories; retain others if runs overlap.
    if (profileDirectory) await rm(profileDirectory, { recursive: true, force: true }).catch(() => {});
    if (originalTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmp;
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('SIGINT', onSignal);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let report;
  try { report = await runBrowser(configArgument(process.argv.slice(2))); }
  catch (error) { report = { schemaVersion: 1, findings: [blocking('config.invalid', 'browser', error.message, 'Pass --config ABSOLUTE_JSON_PATH.')], coverage: {} }; }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.findings.some((item) => item.severity === 'blocking') || browserChecks.some((key) => report.coverage[key] !== true) ? 1 : 0;
}
