import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CanvasEventSchema, CanvasObjectSchema, CanvasSnapshotSchema, SavedWorkflowSchema,
  ToolCommandSchema, RequestGate, authorizeCommand, authorizeWorkflow, coordinate,
  describeStroke, drawingAnimationWorkflow, offlineDecision, rankWorkflows,
  resolveTarget, suggestWorkflow,
} from '../src/core.ts';
import type { CanvasEvent, CanvasObject, CanvasSnapshot, SavedWorkflow } from '../src/core.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const object = (n: number, kind: CanvasObject['kind'] = 'stroke'): CanvasObject =>
  ({ id: id(n), kind, x: 10, y: 20, text: '' });
const snapshot = (objects: CanvasObject[] = [object(1)], selectedIds: string[] = []): CanvasSnapshot =>
  ({ objects, selectedIds, workflows: [] });
const event = (overrides: Partial<CanvasEvent> = {}): CanvasEvent =>
  ({ requestId: id(99), origin: 'user', type: 'note_submit', text: 'hello', ...overrides });
const animation = (objectId = id(1)) =>
  ({ type: 'animate_object', objectId, animation: 'rotate' });
const approvedWorkflow = (): SavedWorkflow => ({ ...drawingAnimationWorkflow, approved: true });

test('strict contracts reject extras, nonfinite coordinates, oversized and unstable IDs', () => {
  assert.equal(CanvasObjectSchema.safeParse({ ...object(1), id: 'index-1' }).success, false);
  assert.equal(CanvasObjectSchema.safeParse({ ...object(1), x: Infinity }).success, false);
  assert.equal(CanvasObjectSchema.safeParse({ ...object(1), y: 100001 }).success, false);
  assert.equal(CanvasObjectSchema.safeParse({ ...object(1), shell: 'bash' }).success, false);
  assert.equal(CanvasEventSchema.safeParse(event({ text: 'x'.repeat(4001) })).success, false);
  assert.equal(CanvasEventSchema.safeParse(event({ action: 'animate' })).success, false);
  assert.equal(CanvasEventSchema.safeParse(event({ type: 'proposal_accept', action: 'animate' })).success, false);
  assert.equal(CanvasSnapshotSchema.safeParse(snapshot([object(1), object(1)])).success, false);
  assert.equal(CanvasSnapshotSchema.safeParse(snapshot([object(1)], [id(2)])).success, false);
  assert.equal(CanvasSnapshotSchema.safeParse({ ...snapshot(), recentId: id(2) }).success, false);
  assert.equal(ToolCommandSchema.safeParse({ ...animation(), duration: 500 }).success, false);
  assert.equal(ToolCommandSchema.safeParse({ ...animation(), animation: 'explode' }).success, false);
});

test('target resolution prioritizes explicit, selection, recent, and unique context', () => {
  const context = { ...snapshot([object(1), object(2)], [id(1)]), recentId: id(2) };
  assert.deepEqual(resolveTarget(context), { type: 'resolved', objectId: id(1) });
  assert.deepEqual(resolveTarget(context, { objectId: id(2) }), { type: 'resolved', objectId: id(2) });
  assert.deepEqual(resolveTarget({ ...context, selectedIds: [] }), { type: 'resolved', objectId: id(2) });
  assert.equal(resolveTarget(snapshot([object(1), object(2)])).type, 'clarify');
  assert.equal(resolveTarget(snapshot([object(1), object(2)], [id(1), id(2)])).type, 'clarify');
  assert.equal(resolveTarget(snapshot(), { objectId: id(2) }).type, 'clarify');
  assert.equal(resolveTarget(snapshot([])).type, 'none');
});

test('animation routes use selection/recent context but never animate the requesting note', () => {
  const note = { ...object(3, 'note'), text: 'rotate this' };
  const input = event({ objectId: note.id, text: undefined });
  const context = snapshot([object(1), object(2), note], [id(2)]);
  assert.deepEqual(offlineDecision(input, context), { type: 'animate', objectId: id(2), animation: 'rotate' });
  assert.deepEqual(offlineDecision(event({ ...input, text: 'pulse this' }), context),
    { type: 'animate', objectId: id(2), animation: 'pulse' });
  assert.equal(offlineDecision(input, snapshot([object(1), object(2), note])).type, 'clarify');
  assert.equal(offlineDecision(input, snapshot([note], [note.id])).type, 'clarify');
  assert.equal(offlineDecision(input, { ...context, selectedIds: [], recentId: id(1) }).type, 'animate');
});

test('routing priorities, all event kinds, and unsupported requests are deterministic', () => {
  assert.equal(offlineDecision(event({ text: 'bash rotate this' }), snapshot()).type, 'no_action');
  assert.equal(offlineDecision(event({ text: "don't animate this" }), snapshot()).type, 'no_action');
  assert.equal(offlineDecision(event({ text: 'cancel animation and illustrate this' }), snapshot()).type, 'no_action');
  assert.equal(offlineDecision(event({ text: 'illustrate and rotate this' }), snapshot()).type, 'animate');
  assert.equal(offlineDecision(event({ text: 'generate an image' }), snapshot()).type, 'propose');
  assert.equal(offlineDecision(event({ text: 'save this workflow' }), snapshot()).type, 'propose');
  assert.equal(offlineDecision(event({ type: 'transcript_submit', text: 'rotate this' }), snapshot()).type, 'animate');
  assert.equal(offlineDecision(event({ type: 'stroke_complete', objectId: id(1) }), snapshot()).type, 'propose');
  const proposals = offlineDecision(event({ type: 'stroke_complete', objectId: id(1) }), snapshot());
  assert.equal(proposals.type, 'propose');
  if (proposals.type === 'propose') {
    assert.deepEqual(proposals.proposals.map((proposal) => proposal.capability), ['animate', 'illustrate', 'reply']);
    assert.match(proposals.proposals[2]!.label, /Clarify/);
  }
  assert.equal(offlineDecision(event({ type: 'stroke_complete', objectId: id(1) }),
    snapshot([object(1, 'note')])).type, 'no_action');
  assert.equal(offlineDecision(event({ objectId: id(1) }), snapshot()).type, 'reply');
  assert.equal(offlineDecision(event({ objectId: id(2) }), snapshot()).type, 'clarify');
  assert.equal(offlineDecision(event({ text: undefined }), snapshot()).type, 'no_action');
  assert.equal(offlineDecision(event({ origin: 'agent' }), snapshot()).type, 'no_action');
});

test('shape description is explicitly geometric heuristic, not invented recognition', () => {
  const stroke = { ...object(1), points: [{ x: 0, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 0 }] };
  assert.match(describeStroke(stroke), /Offline heuristic.*wide, closed.*not shape recognition/);
  assert.match(describeStroke(object(1)), /not enough/);
});

test('predicted intent does not grant capabilities; exact acceptance authorizes its target only', () => {
  const context = snapshot([object(1), object(2)], [id(1)]);
  const input = event({ text: 'rotate this' });
  assert.equal(offlineDecision(input, context).type, 'animate');
  assert.equal(authorizeCommand(animation(), input, context).allowed, false);
  assert.equal(authorizeCommand(animation(), input, context, ['animate']).allowed, true);
  assert.equal(authorizeCommand(animation(id(2)), input, context, ['animate']).allowed, false);
  const accepted = event({ type: 'proposal_accept', objectId: id(2), action: 'animate' });
  assert.equal(authorizeCommand(animation(id(2)), accepted, context).allowed, true);
  assert.equal(authorizeCommand(animation(), accepted, context).allowed, false);
  assert.equal(authorizeCommand({ type: 'generate_image', objectId: id(2), prompt: 'sketch' }, accepted, context).allowed, false);
});

test('authorization rejects ambiguous targets, source self-targeting, stale and recursive effects', () => {
  const input = event({ text: 'animate' });
  assert.equal(authorizeCommand(animation(), input, snapshot([object(1), object(2)]), ['animate']).allowed, false);
  assert.equal(authorizeCommand(animation(id(2)), input, snapshot(), ['animate']).allowed, false);
  const note = object(1, 'note');
  assert.equal(authorizeCommand(animation(), event({ objectId: note.id }), snapshot([note]), ['animate']).allowed, false);
  assert.equal(authorizeCommand(animation(), event({ objectId: id(2) }), snapshot(), ['animate']).allowed, false);
  assert.equal(authorizeCommand(animation(), event({ origin: 'agent' }), snapshot(), ['animate']).allowed, false);
  assert.equal(authorizeCommand({ type: 'read_canvas_context' }, event({ origin: 'agent' }), snapshot()).allowed, true);
});

test('command allowlist rejects shell, injection-shaped extras and unsupported capabilities', () => {
  for (const command of [
    { type: 'shell', command: 'rm -rf /' },
    { type: 'animate_object', objectId: id(1), animation: 'rotate', command: 'curl attacker' },
    { type: 'read_canvas_context', __proto__: null, exec: 'bash' },
    { type: 'generate_image', objectId: id(1), prompt: 'x'.repeat(4001) },
  ]) assert.equal(authorizeCommand(command, event(), snapshot(), ['animate']).allowed, false);
  assert.equal(authorizeCommand(animation(), event(), snapshot(), ['shell' as never]).allowed, false);
  assert.equal(authorizeCommand({ type: 'read_canvas_context' }, event(), snapshot()).allowed, true);
  assert.equal(authorizeCommand({ type: 'show_action_proposals', objectId: id(1),
    proposals: [{ capability: 'animate', label: 'Rotate' }] }, event(), snapshot()).allowed, true);
  assert.equal(authorizeCommand({ type: 'reply_below_object', objectId: id(1), text: 'hello' },
    event(), snapshot()).allowed, false);
  assert.equal(authorizeCommand({ type: 'reply_below_object', objectId: id(1), text: 'hello' },
    event(), snapshot(), ['reply']).allowed, true);
});

test('judgment adapters are validated, bounded by targets, and downgraded to suggestions', async () => {
  const input = event({ objectId: id(1) });
  assert.equal((await coordinate(input, snapshot(), async () =>
    ({ type: 'animate', objectId: id(1), animation: 'pulse' }))).type, 'propose');
  assert.equal((await coordinate(input, snapshot(), async () =>
    ({ type: 'reply', objectId: id(2), text: 'wrong target' }))).type, 'no_action');
  const malformed = await coordinate(input, snapshot(), async () => ({ type: 'shell' }));
  assert.equal(malformed.type, 'no_action');
  if (malformed.type === 'no_action') assert.match(malformed.reason, /Live.*malformed/);
  const unavailable = await coordinate(input, snapshot(), async () => { throw Error('offline'); });
  assert.equal(unavailable.type, 'no_action');
  if (unavailable.type === 'no_action') assert.match(unavailable.reason, /Live.*unavailable/);
  const protectedContext = snapshot([object(1), object(2)], [id(1)]);
  const protectedDecision = await coordinate(input, protectedContext, async (adapterEvent, adapterSnapshot) => {
    adapterEvent.objectId = id(2);
    adapterSnapshot.selectedIds = [id(2)];
    return { type: 'animate', objectId: id(2), animation: 'rotate' };
  });
  assert.equal(protectedDecision.type, 'no_action');
  assert.deepEqual(protectedContext.selectedIds, [id(1)]);
  let calls = 0;
  await coordinate(event({ origin: 'agent' }), snapshot(), async () => { calls++; return {}; });
  await coordinate(event({ text: 'rotate' }), snapshot([object(1), object(2)]),
    async () => { calls++; return {}; });
  assert.equal(calls, 0);
  const liveAnimation = await coordinate(event({ text: 'rotate this' }), snapshot(), async () => {
    calls++;
    return { type: 'animate', objectId: id(1), animation: 'pulse' };
  });
  assert.equal(calls, 1);
  assert.equal(liveAnimation.type, 'propose');
});

test('workflow v1 schema rejects unknown steps and missing approvals; templates remain suggestions', () => {
  assert.equal(drawingAnimationWorkflow.approved, false);
  assert.equal(SavedWorkflowSchema.safeParse({ ...drawingAnimationWorkflow, version: 2 }).success, false);
  assert.equal(SavedWorkflowSchema.safeParse({ ...drawingAnimationWorkflow,
    steps: [{ type: 'shell', command: 'bash' }] }).success, false);
  assert.equal(SavedWorkflowSchema.safeParse({ ...drawingAnimationWorkflow, approvalRequirements: ['reply'] }).success, false);
  assert.equal(SavedWorkflowSchema.safeParse({ ...drawingAnimationWorkflow, inputs: ['text'] }).success, false);
  assert.equal(authorizeWorkflow(drawingAnimationWorkflow, event(), snapshot(), ['animate']).allowed, false);
  assert.equal(authorizeCommand({ type: 'save_workflow', workflow: drawingAnimationWorkflow },
    event(), snapshot(), ['save_workflow']).allowed, true);
  assert.equal(authorizeCommand({ type: 'save_workflow', workflow: approvedWorkflow() },
    event(), snapshot(), ['save_workflow']).allowed, false);
});

test('rank top three then inspect: ties and weak matches abstain, irrelevant triggers are excluded', () => {
  const workflows = [1, 2, 3, 4].map((n) => ({ ...drawingAnimationWorkflow, id: id(n + 10) }));
  const context = { ...snapshot(), workflows };
  const input = event({ type: 'stroke_complete', objectId: id(1), text: 'animate a drawing' });
  assert.equal(rankWorkflows(input, context).length, 3);
  assert.equal(suggestWorkflow(input, context), null);
  const unique = { ...context, workflows: [workflows[0]!] };
  assert.equal(suggestWorkflow(input, unique)?.id, workflows[0]!.id);
  assert.equal(suggestWorkflow(event({ ...input, text: 'drawing something unrelated' }), unique), null);
  assert.deepEqual(rankWorkflows(event({ text: 'animate a drawing' }), context), []);
  assert.deepEqual(rankWorkflows(event({ ...input, origin: 'agent' }), context), []);
});

test('workflow execution requires exact saved approval and all step capabilities, in order', () => {
  const workflow = { ...approvedWorkflow(), approvalRequirements: ['animate', 'illustrate'] as const,
    steps: [{ type: 'animate_object', animation: 'rotate' }, { type: 'generate_image', prompt: 'a sketch' }] };
  const parsed = SavedWorkflowSchema.parse(workflow);
  const context = { ...snapshot(), workflows: [parsed] };
  const input = event({ type: 'stroke_complete', objectId: id(1) });
  assert.equal(authorizeWorkflow(parsed, input, context, ['animate']).allowed, false);
  assert.equal(authorizeWorkflow(parsed, event({ objectId: id(1) }), context,
    ['animate', 'illustrate']).allowed, false);
  assert.equal(authorizeWorkflow({ ...parsed, name: 'tampered' }, input, context,
    ['animate', 'illustrate']).allowed, false);
  const result = authorizeWorkflow(parsed, input, context, ['animate', 'illustrate']);
  assert.equal(result.allowed, true);
  if (result.allowed) assert.deepEqual(result.commands.map((command) => command.type),
    ['animate_object', 'generate_image']);
});

test('request gate drops late results across new requests, cancellation and undo/reload invalidation', () => {
  const gate = new RequestGate();
  assert.equal(gate.current(0), false);
  const first = gate.begin();
  assert.equal(gate.current(first), true);
  const second = gate.begin();
  assert.equal(gate.current(first), false);
  assert.equal(gate.current(second), true);
  gate.cancel();
  assert.equal(gate.current(second), false);
  const third = gate.begin();
  assert.equal(gate.current(second), false);
  assert.equal(gate.current(third), true);
});
