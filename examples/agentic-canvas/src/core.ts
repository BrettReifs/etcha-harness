import { z } from 'zod';

const uuid = z.string().uuid();
const text = z.string().trim().min(1).max(4000);
const coordinateValue = z.number().finite().min(-100000).max(100000);
export const CapabilitySchema = z.enum(['reply', 'animate', 'illustrate', 'save_workflow']);
export type Capability = z.infer<typeof CapabilitySchema>;
export const EventTypeSchema = z.enum([
  'note_submit', 'stroke_complete', 'transcript_submit', 'proposal_accept',
]);
export const PointSchema = z.object({ x: coordinateValue, y: coordinateValue }).strict();
export const CanvasObjectSchema = z.object({
  id: uuid,
  kind: z.enum(['note', 'stroke', 'audio']),
  x: coordinateValue,
  y: coordinateValue,
  text: z.string().max(4000),
  points: z.array(PointSchema).max(4096).optional(),
  animation: z.enum(['rotate', 'pulse']).nullable().optional(),
}).strict();
export type CanvasObject = z.infer<typeof CanvasObjectSchema>;

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('animate_object'), animation: z.enum(['rotate', 'pulse']) }).strict(),
  z.object({ type: z.literal('reply_below_object'), text }).strict(),
  z.object({ type: z.literal('generate_image'), prompt: text }).strict(),
]);
export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
const stepCapability = (step: WorkflowStep): Capability =>
  step.type === 'animate_object' ? 'animate' : step.type === 'generate_image' ? 'illustrate' : 'reply';

export const SavedWorkflowSchema = z.object({
  version: z.literal(1),
  id: uuid,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500),
  triggers: z.array(z.object({
    type: EventTypeSchema,
    kind: z.enum(['note', 'stroke', 'audio']).optional(),
  }).strict()).min(1).max(8),
  examples: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  inputs: z.array(z.enum(['objectId', 'text'])).min(1).max(2),
  steps: z.array(WorkflowStepSchema).min(1).max(8),
  approvalRequirements: z.array(CapabilitySchema).min(1).max(4),
  approved: z.boolean().default(false),
}).strict().superRefine((workflow, ctx) => {
  if (new Set(workflow.inputs).size !== workflow.inputs.length ||
      new Set(workflow.approvalRequirements).size !== workflow.approvalRequirements.length) {
    ctx.addIssue({ code: 'custom', message: 'Workflow inputs and requirements must be unique' });
  }
  if (!workflow.inputs.includes('objectId')) {
    ctx.addIssue({ code: 'custom', message: 'Object-targeting steps require objectId input' });
  }
  for (const step of workflow.steps) {
    if (!workflow.approvalRequirements.includes(stepCapability(step))) {
      ctx.addIssue({ code: 'custom', message: 'Every step must declare its capability requirement' });
    }
  }
});
export type SavedWorkflow = z.infer<typeof SavedWorkflowSchema>;
export const CanvasSnapshotSchema = z.object({
  objects: z.array(CanvasObjectSchema).max(500),
  selectedIds: z.array(uuid).max(500),
  recentId: uuid.optional(),
  workflows: z.array(SavedWorkflowSchema).max(100),
}).strict().superRefine((snapshot, ctx) => {
  const ids = new Set(snapshot.objects.map((object) => object.id));
  if (ids.size !== snapshot.objects.length ||
      new Set(snapshot.selectedIds).size !== snapshot.selectedIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Canvas and selection IDs must be unique' });
  }
  if (snapshot.selectedIds.some((id) => !ids.has(id)) ||
      (snapshot.recentId !== undefined && !ids.has(snapshot.recentId))) {
    ctx.addIssue({ code: 'custom', message: 'Context IDs must reference existing objects' });
  }
  if (new Set(snapshot.workflows.map((workflow) => workflow.id)).size !== snapshot.workflows.length) {
    ctx.addIssue({ code: 'custom', message: 'Workflow IDs must be unique' });
  }
});
export type CanvasSnapshot = z.infer<typeof CanvasSnapshotSchema>;
export const CanvasEventSchema = z.object({
  requestId: uuid,
  origin: z.enum(['user', 'agent']),
  type: EventTypeSchema,
  objectId: uuid.optional(),
  text: text.optional(),
  action: CapabilitySchema.optional(),
}).strict().superRefine((event, ctx) => {
  if (event.action !== undefined && event.type !== 'proposal_accept') {
    ctx.addIssue({ code: 'custom', message: 'Only proposal acceptance can carry an approval action' });
  }
  if (event.type === 'proposal_accept' && (!event.action || !event.objectId)) {
    ctx.addIssue({ code: 'custom', message: 'Acceptance requires an action and explicit target' });
  }
});
export type CanvasEvent = z.infer<typeof CanvasEventSchema>;
export const ActionProposalSchema = z.object({
  capability: CapabilitySchema,
  label: z.string().trim().min(1).max(200),
}).strict();
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export const ToolCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('read_canvas_context') }).strict(),
  z.object({ type: z.literal('reply_below_object'), objectId: uuid, text }).strict(),
  z.object({
    type: z.literal('show_action_proposals'), objectId: uuid.optional(),
    proposals: z.array(ActionProposalSchema).min(1).max(4),
  }).strict(),
  z.object({
    type: z.literal('animate_object'), objectId: uuid, animation: z.enum(['rotate', 'pulse']),
  }).strict(),
  z.object({ type: z.literal('generate_image'), objectId: uuid, prompt: text }).strict(),
  z.object({ type: z.literal('save_workflow'), workflow: SavedWorkflowSchema }).strict(),
]);
export type ToolCommand = z.infer<typeof ToolCommandSchema>;
export const DecisionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('no_action'), reason: text }).strict(),
  z.object({ type: z.literal('clarify'), question: text }).strict(),
  z.object({ type: z.literal('reply'), objectId: uuid, text }).strict(),
  z.object({
    type: z.literal('propose'), objectId: uuid.optional(),
    proposals: z.array(ActionProposalSchema).min(1).max(4),
  }).strict(),
  z.object({
    type: z.literal('animate'), objectId: uuid, animation: z.enum(['rotate', 'pulse']),
  }).strict(),
]);
export type Decision = z.infer<typeof DecisionSchema>;
export type TargetResolution =
  | { type: 'resolved'; objectId: string }
  | { type: 'clarify'; question: string }
  | { type: 'none' };

export function resolveTarget(
  input: CanvasSnapshot,
  options: { excludeId?: string; objectId?: string } = {},
): TargetResolution {
  const snapshot = CanvasSnapshotSchema.parse(input);
  const candidates = snapshot.objects.filter((object) => object.id !== options.excludeId);
  if (options.objectId !== undefined) {
    return candidates.some((object) => object.id === options.objectId)
      ? { type: 'resolved', objectId: options.objectId }
      : { type: 'clarify', question: 'That target is unavailable. Select an existing object.' };
  }
  const selected = snapshot.selectedIds.filter((id) => id !== options.excludeId);
  if (selected.length > 1) return { type: 'clarify', question: 'Select just one object to continue.' };
  if (selected.length === 1) return { type: 'resolved', objectId: selected[0]! };
  if (snapshot.recentId && candidates.some((object) => object.id === snapshot.recentId)) {
    return { type: 'resolved', objectId: snapshot.recentId };
  }
  if (candidates.length > 1) {
    return { type: 'clarify', question: 'Which object do you mean? Select one on the canvas.' };
  }
  return candidates.length === 1
    ? { type: 'resolved', objectId: candidates[0]!.id }
    : { type: 'none' };
}

export const routeRules = [
  { id: 'unsupported', priority: 100, eventTypes: ['note_submit', 'transcript_submit'],
    pattern: /\b(shell|bash|terminal|exec|sudo|curl|rm\s+-rf|powershell)\b/i },
  { id: 'cancel', priority: 95, eventTypes: ['note_submit', 'transcript_submit'],
    pattern: /\b(do not|don't|dont|never|stop|cancel)\b.{0,60}\b(animate|animation|rotate|spin|pulse|illustrate|workflow)\b/i },
  { id: 'animation', priority: 90, eventTypes: ['note_submit', 'transcript_submit'],
    pattern: /\b(animate|animation|rotate|spin|pulse)\b/i, capability: 'animate' },
  { id: 'illustration', priority: 80, eventTypes: ['note_submit', 'transcript_submit'],
    pattern: /\b(illustrate|illustration|generate\s+(an?\s+)?image)\b/i, capability: 'illustrate' },
  { id: 'workflow', priority: 70, eventTypes: ['note_submit', 'transcript_submit'],
    pattern: /\b(save|remember)\b.{0,60}\b(workflow|routine)\b/i, capability: 'save_workflow' },
] as const;

function eventText(event: CanvasEvent, snapshot: CanvasSnapshot): string {
  return event.text ?? snapshot.objects.find((object) => object.id === event.objectId)?.text ?? '';
}

export function describeStroke(object: CanvasObject): string {
  const parsed = CanvasObjectSchema.parse(object);
  const points = parsed.points ?? [];
  if (parsed.kind !== 'stroke' || points.length < 3) {
    return 'Offline heuristic: not enough stroke points to describe a shape.';
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const start = points[0]!;
  const end = points[points.length - 1]!;
  const closed = Math.hypot(start.x - end.x, start.y - end.y) <= Math.max(width, height) * 0.2;
  const extent = width > height * 1.8 ? 'wide' : height > width * 1.8 ? 'tall' : 'roughly balanced';
  return `Offline heuristic: a ${extent}, ${closed ? 'closed' : 'open'} stroke. This is geometry, not shape recognition.`;
}

export function offlineDecision(eventInput: CanvasEvent, snapshotInput: CanvasSnapshot): Decision {
  const event = CanvasEventSchema.parse(eventInput);
  const snapshot = CanvasSnapshotSchema.parse(snapshotInput);
  if (event.origin === 'agent') return { type: 'no_action', reason: 'Agent-origin events do not trigger agents.' };
  if (event.objectId && !snapshot.objects.some((object) => object.id === event.objectId)) {
    return { type: 'clarify', question: 'The source object no longer exists. Select a current object.' };
  }
  const source = snapshot.objects.find((object) => object.id === event.objectId);
  const content = eventText(event, snapshot);
  const rule = routeRules.filter((candidate) =>
    candidate.eventTypes.some((type) => type === event.type) && candidate.pattern.test(content))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0];
  if (rule?.id === 'unsupported') {
    return { type: 'no_action', reason: 'Shell and system commands are not supported by this canvas.' };
  }
  if (rule?.id === 'cancel') {
    return { type: 'no_action', reason: 'The input asks not to perform that action.' };
  }
  if (event.type === 'proposal_accept' || (rule && 'capability' in rule)) {
    const capability = event.action ?? (rule && 'capability' in rule ? rule.capability : undefined);
    const target = resolveTarget(snapshot, event.type === 'proposal_accept'
      ? { objectId: event.objectId }
      : { excludeId: source?.kind === 'note' || source?.kind === 'audio' ? source.id : undefined });
    if (target.type === 'clarify') return target;
    if (target.type === 'none') return { type: 'clarify', question: 'Add or select an object to act on first.' };
    if (capability === 'animate') {
      return { type: 'animate', objectId: target.objectId, animation: /\b(pulse|pulsing)\b/i.test(content) ? 'pulse' : 'rotate' };
    }
    if (capability === 'reply') {
      return { type: 'reply', objectId: target.objectId, text: 'What would you like to explore about this object?' };
    }
    return {
      type: 'propose', objectId: target.objectId,
      proposals: [{ capability: capability ?? 'reply',
        label: capability === 'save_workflow' ? 'Save this as a reusable workflow' : 'Illustrate this object' }],
    };
  }
  if (event.type === 'stroke_complete') {
    if (source?.kind !== 'stroke') {
      return { type: 'no_action', reason: 'A stroke-complete event requires an existing stroke.' };
    }
    return {
      type: 'propose', objectId: source.id,
      proposals: [
        { capability: 'animate', label: 'Try a rotating drawing animation (requires approval)' },
        { capability: 'illustrate', label: 'Illustrate this drawing (requires an available image adapter)' },
        { capability: 'reply', label: 'Clarify this drawing' },
      ],
    };
  }
  if (!content.trim()) return { type: 'no_action', reason: 'There is no input to interpret.' };
  const target = source ? { type: 'resolved' as const, objectId: source.id } : resolveTarget(snapshot);
  if (target.type === 'clarify') return target;
  if (target.type === 'none') return { type: 'clarify', question: 'Add a note or select an object first.' };
  return { type: 'reply', objectId: target.objectId, text: `Offline reply: You wrote “${content.slice(0, 500)}”. What would you like to do with it?` };
}

export type Authorization =
  | { allowed: true; command: ToolCommand }
  | { allowed: false; reason: string };

export function authorizeCommand(
  commandInput: unknown,
  eventInput: CanvasEvent,
  snapshotInput: CanvasSnapshot,
  approvedCapabilities: readonly Capability[] = [],
): Authorization {
  const commandResult = ToolCommandSchema.safeParse(commandInput);
  const eventResult = CanvasEventSchema.safeParse(eventInput);
  const snapshotResult = CanvasSnapshotSchema.safeParse(snapshotInput);
  const grants = z.array(CapabilitySchema).max(4).safeParse(approvedCapabilities);
  if (!commandResult.success || !eventResult.success || !snapshotResult.success || !grants.success) {
    return { allowed: false, reason: 'Invalid or unsupported command, event, context, or capability.' };
  }
  const command = commandResult.data;
  const event = eventResult.data;
  const snapshot = snapshotResult.data;
  if (event.origin === 'agent' && command.type !== 'read_canvas_context') {
    return { allowed: false, reason: 'Agent-origin events cannot recursively cause effects.' };
  }
  if (event.objectId && !snapshot.objects.some((object) => object.id === event.objectId)) {
    return { allowed: false, reason: 'The event source no longer exists.' };
  }
  if ('objectId' in command && command.objectId &&
      !snapshot.objects.some((object) => object.id === command.objectId)) {
    return { allowed: false, reason: 'The command target does not exist.' };
  }
  if (command.type === 'read_canvas_context' || command.type === 'show_action_proposals') {
    return { allowed: true, command };
  }
  const capability: Capability = command.type === 'animate_object' ? 'animate'
    : command.type === 'generate_image' ? 'illustrate'
    : command.type === 'save_workflow' ? 'save_workflow' : 'reply';
  const acceptance = event.origin === 'user' && event.type === 'proposal_accept' &&
    event.action === capability && ('objectId' in command ? command.objectId === event.objectId : true);
  if (!grants.data.includes(capability) && !acceptance) {
    return { allowed: false, reason: `The ${capability} capability has not been approved.` };
  }
  if (command.type === 'animate_object' || command.type === 'generate_image') {
    const source = snapshot.objects.find((object) => object.id === event.objectId);
    const target = resolveTarget(snapshot, event.type === 'proposal_accept'
      ? { objectId: event.objectId }
      : { excludeId: source?.kind === 'note' || source?.kind === 'audio' ? source.id : undefined });
    if (target.type !== 'resolved' || target.objectId !== command.objectId) {
      return { allowed: false, reason: 'The target is ambiguous or does not match user context.' };
    }
  }
  if (command.type === 'reply_below_object') {
    const target = event.objectId ? { type: 'resolved', objectId: event.objectId } : resolveTarget(snapshot);
    if (target.type !== 'resolved' || target.objectId !== command.objectId) {
      return { allowed: false, reason: 'Replies must target the source or an unambiguous context object.' };
    }
  }
  // Saving a suggestion does not approve running its steps.
  if (command.type === 'save_workflow' && command.workflow.approved) {
    return { allowed: false, reason: 'New workflows must be saved as unapproved suggestions.' };
  }
  return { allowed: true, command };
}

export type JudgmentAdapter = (event: CanvasEvent, snapshot: CanvasSnapshot) => Promise<unknown>;

export async function coordinate(
  eventInput: CanvasEvent,
  snapshotInput: CanvasSnapshot,
  judgment?: JudgmentAdapter,
): Promise<Decision> {
  const event = CanvasEventSchema.parse(eventInput);
  const snapshot = CanvasSnapshotSchema.parse(snapshotInput);
  const fallback = offlineDecision(event, snapshot);
  if (!judgment || event.origin === 'agent' || fallback.type === 'clarify' ||
      fallback.type === 'no_action') return fallback;
  const abstain = (reason: string): Decision => ({ type: 'no_action', reason });
  try {
    const prediction = DecisionSchema.safeParse(await judgment(structuredClone(event), structuredClone(snapshot)));
    if (!prediction.success) return abstain('Live judgment returned a malformed decision; no action was taken.');
    const decision = prediction.data;
    if (decision.type === 'animate') {
      // A prediction may suggest a capability, never grant it.
      const authorization = authorizeCommand(
        { type: 'animate_object', objectId: decision.objectId, animation: decision.animation },
        event, snapshot, ['animate'],
      );
      return authorization.allowed
        ? { type: 'propose', objectId: decision.objectId,
          proposals: [{ capability: 'animate', label: `Try ${decision.animation} animation (requires approval)` }] }
        : abstain('Live judgment chose an unauthorized or ambiguous target; no action was taken.');
    }
    if (decision.type === 'reply') {
      return authorizeCommand({ type: 'reply_below_object', objectId: decision.objectId, text: decision.text },
        event, snapshot, ['reply']).allowed ? decision
        : abstain('Live judgment chose an unauthorized reply target; no action was taken.');
    }
    if (decision.type === 'propose' && decision.objectId !== undefined) {
      const target = resolveTarget(snapshot, { objectId: event.objectId });
      if (target.type !== 'resolved' || target.objectId !== decision.objectId) {
        return abstain('Live judgment chose an unauthorized proposal target; no action was taken.');
      }
    }
    return decision;
  } catch {
    return abstain('Live judgment is unavailable; no action was taken. Choose offline mode explicitly to continue.');
  }
}

export const drawingAnimationWorkflow: SavedWorkflow = SavedWorkflowSchema.parse({
  version: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Animate a drawing',
  description: 'Suggest a rotating animation after a completed stroke; execution requires approval.',
  triggers: [{ type: 'stroke_complete', kind: 'stroke' }],
  examples: ['animate a drawing', 'rotate this sketch'],
  inputs: ['objectId'],
  steps: [{ type: 'animate_object', animation: 'rotate' }],
  approvalRequirements: ['animate'],
  approved: false,
});

export type RankedWorkflow = { workflow: SavedWorkflow; score: number };
const tokens = (value: string): Set<string> =>
  new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);

export function rankWorkflows(eventInput: CanvasEvent, snapshotInput: CanvasSnapshot): RankedWorkflow[] {
  const event = CanvasEventSchema.parse(eventInput);
  const snapshot = CanvasSnapshotSchema.parse(snapshotInput);
  if (event.origin === 'agent' || event.type === 'proposal_accept') return [];
  const kind = snapshot.objects.find((object) => object.id === event.objectId)?.kind;
  const content = eventText(event, snapshot).trim().toLowerCase();
  const words = tokens(content);
  return snapshot.workflows.filter((workflow) => workflow.triggers.some((trigger) =>
    trigger.type === event.type && (trigger.kind === undefined || trigger.kind === kind)))
    .map((workflow) => {
      const exampleScore = Math.max(...workflow.examples.map((example) => {
        if (example.toLowerCase() === content) return 1;
        const exampleWords = tokens(example);
        const overlap = [...exampleWords].filter((word) => words.has(word)).length;
        return overlap / Math.max(exampleWords.size, words.size, 1);
      }));
      return { workflow, score: exampleScore };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.workflow.id.localeCompare(b.workflow.id))
    .slice(0, 3);
}

export function suggestWorkflow(event: CanvasEvent, snapshot: CanvasSnapshot): SavedWorkflow | null {
  const ranked = rankWorkflows(event, snapshot);
  const best = ranked[0];
  if (!best || best.score < 0.75 || (ranked[1] && best.score - ranked[1].score < 0.15)) return null;
  return best.workflow;
}

export function authorizeWorkflow(
  workflowInput: unknown, event: CanvasEvent, snapshot: CanvasSnapshot,
  approvedCapabilities: readonly Capability[] = [],
): { allowed: true; commands: ToolCommand[] } | { allowed: false; reason: string } {
  const result = SavedWorkflowSchema.safeParse(workflowInput);
  if (!result.success) return { allowed: false, reason: 'Invalid workflow.' };
  const workflow = result.data;
  const context = CanvasSnapshotSchema.safeParse(snapshot);
  const parsedEvent = CanvasEventSchema.safeParse(event);
  if (!context.success || !parsedEvent.success) return { allowed: false, reason: 'Invalid workflow context.' };
  const saved = context.data.workflows.find((candidate) => candidate.id === workflow.id);
  if (!workflow.approved || !saved?.approved || JSON.stringify(saved) !== JSON.stringify(workflow)) {
    return { allowed: false, reason: 'This exact saved workflow has not been approved.' };
  }
  if (!workflow.approvalRequirements.every((capability) => approvedCapabilities.includes(capability))) {
    return { allowed: false, reason: 'Workflow capabilities require explicit approval.' };
  }
  const source = context.data.objects.find((object) => object.id === parsedEvent.data.objectId);
  if (parsedEvent.data.type !== 'proposal_accept' && !workflow.triggers.some((trigger) =>
    trigger.type === parsedEvent.data.type && (trigger.kind === undefined || trigger.kind === source?.kind))) {
    return { allowed: false, reason: 'This event does not match a workflow trigger.' };
  }
  const target = resolveTarget(context.data, parsedEvent.data.type === 'proposal_accept'
    ? { objectId: parsedEvent.data.objectId }
    : { excludeId: source?.kind === 'note' || source?.kind === 'audio' ? source.id : undefined });
  if (target.type !== 'resolved') return { allowed: false, reason: 'Workflow target is ambiguous or missing.' };
  const commands: ToolCommand[] = [];
  for (const step of workflow.steps) {
    const command = { ...step, objectId: target.objectId };
    const authorization = authorizeCommand(command, parsedEvent.data, context.data, approvedCapabilities);
    if (!authorization.allowed) return authorization;
    commands.push(authorization.command);
  }
  return { allowed: true, commands };
}

export class RequestGate {
  private generation = 0;
  private active = false;

  begin(): number {
    this.active = true;
    return ++this.generation;
  }

  cancel(): void {
    this.active = false;
    this.generation++;
  }

  current(token: number): boolean {
    return this.active && token === this.generation;
  }
}
