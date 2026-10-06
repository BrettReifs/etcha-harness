import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CopilotClientOptions, SessionConfig, SessionEventHandler } from '@github/copilot-sdk';
import { CANVAS_TOOLS, canvasSessionConfig, guardedTools, runCopilot } from '../src/server/copilot.ts';
import type { CanvasClient, CanvasToolGate } from '../src/server/copilot.ts';
import { createCanvasServer, makeCanvasGate, textContext } from '../src/server/server.ts';
import type { CanvasEvent, CanvasSnapshot } from '../src/core.ts';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return `http://127.0.0.1:${port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function fixtureGate(): CanvasToolGate {
  return {
    schemas: Object.fromEntries(CANVAS_TOOLS.map(name => [name, { type: 'object', additionalProperties: false }])) as CanvasToolGate['schemas'],
    authorize: (name, args) => name === 'read_canvas_context' && !!args && Object.keys(args).length === 0,
    execute: () => ({ fixture: true }),
  };
}

test('mock SDK: custom-only source-qualified allowlist and deny every permission', async () => {
  const config = canvasSessionConfig(fixtureGate(), new AbortController().signal);
  assert.deepEqual(config.availableTools, CANVAS_TOOLS.map(name => `custom:${name}`));
  assert.deepEqual(config.excludedTools, ['builtin:*', 'mcp:*']);
  assert.equal(config.enableConfigDiscovery, false);
  assert.equal(config.enableSkills, false);
  assert.equal(config.skipCustomInstructions, true);
  assert.equal(config.enableFileHooks, false);
  assert.equal(config.enableHostGitOperations, false);
  assert.equal(config.enableSessionTelemetry, false);
  assert.equal(config.remoteSession, 'off');
  assert.deepEqual(await config.onPermissionRequest!({ kind: 'read', path: '/etc/passwd' } as never, { sessionId: 'fixture' }), { kind: 'reject' });
  const input = { toolName: 'bash', toolArgs: {}, sessionId: 'fixture', timestamp: new Date(), workingDirectory: '.' };
  assert.equal((await config.hooks!.onPreToolUse!(input, { sessionId: 'fixture' }))?.permissionDecision, 'deny');
  assert.equal((await config.hooks!.onPreToolUse!({ ...input, toolName: 'read_canvas_context' }, { sessionId: 'fixture' }))?.permissionDecision, 'allow');
});

test('mock SDK: handlers independently deny stale or unauthorized arguments', async () => {
  const tools = guardedTools(fixtureGate(), new AbortController().signal);
  const read = tools.find(tool => tool.name === 'read_canvas_context')!;
  assert.deepEqual(await read.handler!({}, {} as never), { fixture: true });
  await assert.rejects(async () => read.handler!({ targetId: 'stale' }, {} as never), /not authorized/);
  const reply = tools.find(tool => tool.name === 'reply_below_object')!;
  await assert.rejects(async () => reply.handler!({ targetId: 'stale', text: 'injected' }, {} as never), /not authorized/);
});

test('mock SDK: stream deltas, clean up session and client after success', async () => {
  const calls: string[] = [];
  let listener: SessionEventHandler = () => {};
  let options: CopilotClientOptions | undefined;
  const client: CanvasClient = {
    start: async () => { calls.push('start'); },
    createSession: async config => {
      assert.equal(config.streaming, true);
      return {
        on: handler => { listener = handler; return () => { calls.push('unsubscribe'); }; },
        sendAndWait: async () => { listener({ type: 'assistant.message_delta', data: { deltaContent: 'fixture delta' } } as never); },
        abort: async () => { calls.push('abort'); },
        disconnect: async () => { calls.push('disconnect'); },
      };
    },
    stop: async () => { calls.push('stop'); },
  };
  const deltas: string[] = [];
  await runCopilot({
    context: { fixture: true }, gate: fixtureGate(), signal: new AbortController().signal,
    onDelta: text => deltas.push(text), clientFactory: config => { options = config; return client; },
  });
  assert.equal(options!.mode, 'empty');
  assert.equal(options!.env!.JEV_API_KEY, undefined);
  assert.deepEqual(deltas, ['fixture delta']);
  assert.deepEqual(calls, ['start', 'unsubscribe', 'disconnect', 'stop']);
});

test('mock SDK: disconnect cancels generation, aborts and cleans up', async () => {
  const controller = new AbortController();
  const calls: string[] = [];
  const client: CanvasClient = {
    start: async () => {},
    createSession: async () => ({
      on: () => () => { calls.push('unsubscribe'); },
      sendAndWait: async () => { controller.abort(); await new Promise(() => {}); },
      abort: async () => { calls.push('abort'); },
      disconnect: async () => { calls.push('disconnect'); },
    }),
    stop: async () => { calls.push('stop'); },
  };
  await assert.rejects(runCopilot({
    context: {}, gate: fixtureGate(), signal: controller.signal, onDelta: () => {}, clientFactory: () => client,
  }), /cancelled/);
  assert.deepEqual(calls, ['abort', 'unsubscribe', 'disconnect', 'stop']);
});

test('mock SDK: failures never become fake success', async () => {
  let stopped = false;
  const client: CanvasClient = {
    start: async () => { throw new Error('fixture provider offline'); },
    createSession: async () => { throw new Error('not reached'); },
    stop: async () => { stopped = true; },
  };
  await assert.rejects(runCopilot({
    context: {}, gate: fixtureGate(), signal: new AbortController().signal, onDelta: () => {}, clientFactory: () => client,
  }), /offline/);
  assert.equal(stopped, true);
});

test('mock SDK: bounded timeout stops a hung provider and revoked signals deny tools', async () => {
  let stopped = false;
  const controller = new AbortController();
  controller.abort();
  const tool = guardedTools(fixtureGate(), controller.signal)[0]!;
  await assert.rejects(async () => tool.handler!({}, {} as never));
  const client: CanvasClient = {
    start: async () => { await new Promise(() => {}); },
    createSession: async () => { throw new Error('not reached'); },
    stop: async () => { stopped = true; },
  };
  const keepAlive = setTimeout(() => {}, 100);
  try {
    await assert.rejects(runCopilot({
      context: {}, gate: fixtureGate(), signal: new AbortController().signal, onDelta: () => {},
      timeoutMs: 10, clientFactory: () => client,
    }), /timed out/);
    assert.equal(stopped, true);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('loopback transport enforces origin, content-type, consent, strict keys, and body bounds', async () => {
  const server = createCanvasServer(async () => ({ fixture: true }));
  const url = await listen(server);
  try {
    const body = JSON.stringify({ event: gateEvent, snapshot: gateSnapshot, mode: 'copilot', consent: true });
    const headers = { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', body })).status, 403);
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.invalid' }, body })).status, 403);
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body })).status, 415);
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers, body: body.replace('true', 'false') })).status, 400);
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ event: gateEvent, snapshot: gateSnapshot, mode: 'copilot', consent: true, url: 'http://metadata.invalid' }) })).status, 400);
    assert.equal((await fetch(`${url}/api/run`, { method: 'POST', headers, body: 'x'.repeat(128 * 1024 + 1) })).status, 413);
    const reboundStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(`${url}/api/run`, { method: 'POST', headers: { ...headers, Host: 'attacker.invalid' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end(body);
    });
    assert.equal(reboundStatus, 403);
  } finally {
    await close(server);
  }
});

test('loopback SSE streams fixture deltas/results and redacts provider errors', async () => {
  const server = createCanvasServer(async (body, _signal, emit) => {
    if (body.mode === 'jev') throw new Error('fixture-secret-token');
    emit({ type: 'delta', text: 'fixture delta' });
    return { type: 'no_action', reason: 'fixture' };
  });
  const url = await listen(server);
  try {
    const headers = { Origin: 'http://127.0.0.1:5173', 'Content-Type': 'application/json' };
    const response = await fetch(`${url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ event: gateEvent, snapshot: gateSnapshot, mode: 'copilot', consent: true }) });
    assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const text = await response.text();
    assert.match(text, /"type":"delta"/);
    assert.match(text, /"type":"result"/);
    const failed = await fetch(`${url}/api/run`, { method: 'POST', headers, body: JSON.stringify({ event: gateEvent, snapshot: gateSnapshot, mode: 'jev', consent: true }) });
    const failure = await failed.text();
    assert.match(failure, /"type":"error"/);
    assert.doesNotMatch(failure, /fixture-secret-token|"type":"result"/);
  } finally {
    await close(server);
  }
});

const sourceId = '10000000-0000-4000-8000-000000000001';
const targetId = '10000000-0000-4000-8000-000000000002';
const gateSnapshot: CanvasSnapshot = {
  objects: [
    { id: sourceId, kind: 'note', x: 0, y: 0, text: 'hello' },
    { id: targetId, kind: 'stroke', x: 10, y: 20, text: '', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
  ],
  selectedIds: [targetId], recentId: targetId, workflows: [],
};
const gateEvent: CanvasEvent = {
  requestId: '10000000-0000-4000-8000-000000000003',
  origin: 'user', type: 'note_submit', objectId: sourceId, text: 'hello',
};

test('live gate checks schema, source target, independent intent and opt-in unavailable images', async () => {
  const canvas = makeCanvasGate(gateEvent, gateSnapshot, new AbortController().signal);
  assert.equal(canvas.gate.authorize('reply_below_object', { objectId: sourceId, text: 'A live reply' }), true);
  assert.equal(canvas.gate.authorize('reply_below_object', { objectId: targetId, text: 'Wrong target' }), false);
  assert.equal(canvas.gate.authorize('reply_below_object', { objectId: sourceId, text: 'A live reply', shell: 'bash' }), false);
  assert.equal(canvas.gate.authorize('animate_object', { objectId: targetId, animation: 'rotate' }), false);
  assert.equal(canvas.gate.authorize('generate_image', { objectId: targetId, prompt: 'Draw' }), false);
  assert.equal(canvas.gate.authorize('reply_below_object', { objectId: '10000000-0000-4000-8000-000000000099', text: 'Stale' }), false);
  const explicit = makeCanvasGate({ ...gateEvent, text: 'rotate this drawing' }, gateSnapshot, new AbortController().signal);
  assert.equal(explicit.gate.authorize('animate_object', { objectId: targetId, animation: 'rotate' }), true);
  assert.equal(explicit.gate.authorize('animate_object', { objectId: sourceId, animation: 'rotate' }), false);
  await explicit.gate.execute('animate_object', { objectId: targetId, animation: 'rotate' });
  assert.deepEqual(explicit.decision(), { type: 'animate', objectId: targetId, animation: 'rotate' });
  const negative = makeCanvasGate({ ...gateEvent, text: 'do not rotate this drawing' }, gateSnapshot, new AbortController().signal);
  assert.equal(negative.gate.authorize('animate_object', { objectId: targetId, animation: 'rotate' }), false);
});

test('live perception context contains text JSON, no raw stroke points', () => {
  const context = textContext(gateEvent, gateSnapshot);
  assert.equal('points' in context.objects[1]!, false);
  assert.equal(context.objects[1]!.strokePointCount, 2);
  assert.equal(JSON.stringify(context).includes('base64'), false);
});

test('browser SSE disconnect aborts the live provider signal', async () => {
  let disconnected!: () => void;
  const observed = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createCanvasServer(async (_body, signal, emit) => {
    emit({ type: 'delta', text: 'fixture pending' });
    await new Promise<void>(resolve => signal.addEventListener('abort', () => {
      disconnected();
      resolve();
    }, { once: true }));
    signal.throwIfAborted();
  });
  const url = await listen(server);
  try {
    const controller = new AbortController();
    const response = await fetch(`${url}/api/run`, {
      method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: gateEvent, snapshot: gateSnapshot, mode: 'copilot', consent: true }),
      signal: controller.signal,
    });
    await response.body!.getReader().read();
    controller.abort();
    await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Disconnect did not abort provider')), 1000))]);
  } finally {
    await close(server);
  }
});
