import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import {
  authorizeCommand, CanvasEventSchema, CanvasSnapshotSchema, offlineDecision, ToolCommandSchema,
} from '../core.ts';
import type { CanvasEvent, CanvasSnapshot, Capability, Decision, ToolCommand } from '../core.ts';
import { CANVAS_TOOLS, runCopilot } from './copilot.ts';
import type { CanvasToolGate, CanvasToolName } from './copilot.ts';

export const LIVE_PORT = 4318;
export const LIVE_HOST = '127.0.0.1';
const FRONTEND_ORIGINS = new Set(['http://127.0.0.1:5173', 'http://localhost:5173']);
const MAX_BODY_BYTES = 128 * 1024;

export const runRequestSchema = z.object({
  event: CanvasEventSchema,
  snapshot: CanvasSnapshotSchema,
  mode: z.enum(['jev', 'copilot', 'live']),
  consent: z.literal(true),
}).strict();
export type LiveRunRequest = z.infer<typeof runRequestSchema>;
export type LiveMessage =
  | { type: 'delta'; text: string }
  | { type: 'result'; decision: unknown; commands?: ToolCommand[] }
  | { type: 'error'; message: string };
export type LiveRunner = (request: LiveRunRequest, signal: AbortSignal, emit: (message: LiveMessage) => void) => Promise<unknown>;

export interface ImageProvider {
  generate(input: { prompt: string; context: unknown; signal: AbortSignal }): Promise<{ imageDataUrl: string }>;
}
export interface PerceptionProvider {
  describe(input: { context: unknown; signal: AbortSignal }): Promise<string>;
}
export interface OptionalProviders {
  images?: { enabled: true; confirmed: true; adapter: ImageProvider };
  perception?: { enabled: true; confirmed: true; adapter: PerceptionProvider };
}

export function textContext(event: CanvasEvent, snapshot: CanvasSnapshot) {
  return {
    event,
    capabilities: { imageGeneration: 'unavailable', visualPerception: 'unavailable' },
    objects: snapshot.objects.map(({ id, kind, x, y, text, points }) => ({
      id, kind, x, y, text,
      ...(points ? { strokePointCount: points.length, description: 'A drawn stroke; shape has not been recognized.' } : {}),
    })),
    selectedIds: snapshot.selectedIds,
    recentId: snapshot.recentId,
    workflows: snapshot.workflows,
  };
}

export function makeCanvasGate(event: CanvasEvent, snapshot: CanvasSnapshot, signal: AbortSignal, providers: OptionalProviders = {}) {
  const staged: ToolCommand[] = [];
  let decision: Decision = { type: 'no_action', reason: 'The live assistant abstained; no authorized action was produced.' };
  const policy = offlineDecision(event, snapshot);
  const grants: Capability[] = ['reply'];
  if (policy.type === 'animate') grants.push('animate');
  if (event.type === 'proposal_accept' && event.action === 'save_workflow') grants.push('save_workflow');
  const schemas = Object.fromEntries(ToolCommandSchema.options.map(schema => {
    const json = z.toJSONSchema(schema) as Record<string, unknown>;
    const properties = { ...(json.properties as Record<string, unknown>) };
    delete properties.type;
    return [schema.shape.type.value, {
      ...json, properties, required: (json.required as string[] | undefined)?.filter(key => key !== 'type'),
    }];
  })) as unknown as CanvasToolGate['schemas'];
  const parse = (name: CanvasToolName, args: unknown) => {
    if (args === null || typeof args !== 'object' || Array.isArray(args) || 'type' in args) return undefined;
    const parsed = ToolCommandSchema.safeParse({ ...args, type: name });
    return parsed.success ? parsed.data : undefined;
  };
  const authorized = (name: CanvasToolName, args: unknown): boolean => {
    if (signal.aborted || staged.length >= 8 || !CANVAS_TOOLS.includes(name)) return false;
    const command = parse(name, args);
    if (!command) return false;
    if ((policy.type === 'no_action' || policy.type === 'clarify') && command.type !== 'read_canvas_context') return false;
    if (command.type === 'generate_image' && !(providers.images?.enabled && providers.images.confirmed)) return false;
    // The current UI has no image-result persistence tool; no external generation
    // is called merely because canvas content asks for an illustration.
    if (command.type === 'generate_image') return false;
    return authorizeCommand(command, event, snapshot, grants).allowed;
  };
  const gate: CanvasToolGate = {
    schemas,
    authorize: authorized,
    execute: async (name, args) => {
      signal.throwIfAborted();
      if (!authorized(name, args)) throw new Error('Canvas operation is not authorized.');
      const command = parse(name, args)!;
      if (command.type === 'read_canvas_context') return textContext(event, snapshot);
      staged.push(command);
      if (command.type === 'reply_below_object') decision = { type: 'reply', objectId: command.objectId, text: command.text };
      if (command.type === 'show_action_proposals') decision = { type: 'propose', objectId: command.objectId, proposals: command.proposals };
      if (command.type === 'animate_object') decision = { type: 'animate', objectId: command.objectId, animation: command.animation };
      if (command.type === 'save_workflow') decision = {
        type: 'propose', objectId: event.objectId,
        proposals: [{ capability: 'save_workflow', label: `Save workflow suggestion: ${command.workflow.name}` }],
      };
      return { status: 'staged', command, note: 'The browser must validate this result against its current canvas before applying it.' };
    },
  };
  return { gate, commands: staged, decision: () => decision };
}

export function createLiveRunner(): LiveRunner {
  return async (request, signal, emit) => {
    const event = CanvasEventSchema.parse(request.event);
    const snapshot = CanvasSnapshotSchema.parse(request.snapshot);
    signal.throwIfAborted();
    if (event.origin !== 'user') return { type: 'no_action', reason: 'Agent-origin events do not trigger live agents.' };
    if (request.mode !== 'copilot') throw new Error('Jev is not configured.');
    const canvas = makeCanvasGate(event, snapshot, signal);
    await runCopilot({
      context: textContext(event, snapshot), gate: canvas.gate, signal,
      onDelta: text => emit({ type: 'delta', text }), model: process.env.COPILOT_MODEL,
    });
    return canvas.decision();
  };
}

function jsonError(response: ServerResponse, status: number, message: string) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify({ type: 'error', message }));
}

class BodyLimitError extends Error {}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY_BYTES) throw new BodyLimitError('Request exceeds the 128 KiB limit.');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createCanvasServer(runner: LiveRunner) {
  let active = 0;
  return createServer(async (request, response) => {
    const host = request.headers.host;
    const port = (response.socket?.address() as { port?: number } | null)?.port ?? LIVE_PORT;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      jsonError(response, 403, 'Loopback host required.');
      return;
    }
    const origin = request.headers.origin;
    if (!origin || !FRONTEND_ORIGINS.has(origin)) {
      jsonError(response, 403, 'Explicit loopback frontend origin required.');
      return;
    }
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.url !== '/api/run') {
      jsonError(response, 404, 'Route unavailable.');
      return;
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      response.end();
      return;
    }
    if (request.method !== 'POST') {
      jsonError(response, 405, 'Use POST.');
      return;
    }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
      jsonError(response, 415, 'JSON content type required.');
      return;
    }
    if (Number(request.headers['content-length']) > MAX_BODY_BYTES) {
      jsonError(response, 413, 'Request exceeds the 128 KiB limit.');
      return;
    }
    if (active >= 2) {
      jsonError(response, 429, 'Live capacity reached; wait for the current request.');
      return;
    }
    let body: LiveRunRequest;
    try {
      body = runRequestSchema.parse(await readBody(request));
    } catch (error) {
      jsonError(response, error instanceof BodyLimitError ? 413 : 400,
        error instanceof BodyLimitError ? 'Request exceeds the 128 KiB limit.' : 'Invalid request: explicit consent, mode, event and snapshot are required.');
      return;
    }
    if (active >= 2) {
      jsonError(response, 429, 'Live capacity reached; wait for the current request.');
      return;
    }
    active++;
    const controller = new AbortController();
    const disconnected = () => controller.abort(new Error('Browser disconnected.'));
    response.on('close', disconnected);
    request.on('aborted', disconnected);
    const deadline = setTimeout(() => controller.abort(new Error('Live request timed out.')), 90_000);
    response.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const emit = (message: LiveMessage) => {
      if (!controller.signal.aborted && !response.destroyed) response.write(`data: ${JSON.stringify(message)}\n\n`);
    };
    try {
      const decision = await runner(body, controller.signal, emit);
      controller.signal.throwIfAborted();
      emit({ type: 'result', decision });
    } catch {
      // Never send SDK/provider errors: those may contain credentials or URLs.
      if (!response.destroyed) response.write(`data: ${JSON.stringify({ type: 'error', message: controller.signal.aborted ? 'Live request cancelled or timed out.' : 'Live provider unavailable or returned an invalid response. No action was applied.' })}\n\n`);
    } finally {
      clearTimeout(deadline);
      response.off('close', disconnected);
      request.off('aborted', disconnected);
      active--;
      response.end();
    }
  });
}

// The concrete coordinator wiring is below; exported factory supports transport
// tests without credentials or provider calls.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createCanvasServer(createLiveRunner());
  server.listen(LIVE_PORT, LIVE_HOST, () => console.log(`Canvas live server listening on http://${LIVE_HOST}:${LIVE_PORT}`));
}
