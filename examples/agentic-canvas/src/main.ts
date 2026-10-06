import './style.css'
import {
  CanvasSnapshotSchema, DecisionSchema, SavedWorkflowSchema, RequestGate,
  authorizeCommand, authorizeWorkflow, offlineDecision, describeStroke, drawingAnimationWorkflow,
  suggestWorkflow,
  type CanvasSnapshot, type CanvasObject, type CanvasEvent, type Decision,
  type ToolCommand, type SavedWorkflow, type Capability,
} from './core'

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = `
  <header>
    <div class="identity">
      <svg class="mark" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 23V5h18M10 23V10h13M15 23v-8h8" stroke="currentColor" stroke-width="1.6"/></svg>
      <div><h1>Agentic canvas</h1><p class="subtitle">A little room to think.</p></div>
    </div>
    <div class="top-actions"><span class="saved" id="save-state">Stored on this device</span><button id="workflows">Workflows</button><button id="settings">Settings</button></div>
  </header>
  <nav class="toolbar" aria-label="Canvas tools">
    <div class="tools">
      <button id="select-tool" aria-pressed="true">Select</button><button id="draw-tool" aria-pressed="false">Draw</button><button id="pan-tool" aria-pressed="false">Pan</button>
      <span class="separator" aria-hidden="true"></span>
      <button id="add-note">Add note</button><button id="microphone">Record audio</button><button id="undo">Undo</button>
    </div>
    <div class="zoom"><button id="zoom-out" aria-label="Zoom out">−</button><output id="zoom-level" aria-label="Zoom level">100%</output><button id="zoom-in" aria-label="Zoom in">+</button><button id="home">Center</button></div>
  </nav>
  <main id="viewport" aria-label="Canvas. Use Pan mode to drag, plus or minus to zoom." tabindex="0">
    <div id="world"></div>
    <svg id="draft" aria-hidden="true"><path fill="none" stroke="#3c5948" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <div class="empty" id="empty"><h2>Start with a thought.<br>See where it goes.</h2><p>Draw something, leave a note, or record an idea.<br>Your assistant works right here, beneath your work.</p><div class="sample"><svg viewBox="0 0 84 45" fill="none" aria-hidden="true"><path d="M8 30c8-35 11 12 21-5S47 9 51 27s15-13 25-9" stroke="#77725f" stroke-width="1.6" stroke-linecap="round"/></svg><span>Nothing leaves your device by default.</span></div></div>
  </main>
  <footer class="bottom-bar"><p class="hint">Draw to begin · Submit notes to ask · Arrow keys move a selected object</p><nav class="object-list" id="object-list" aria-label="Canvas objects"></nav></footer>
  <div id="status" role="status" aria-live="polite" hidden></div>
  <section id="panel" class="panel" hidden aria-label="Canvas options"></section>
`

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const world = $('world')
const viewport = $('viewport')
const panel = $('panel')
const status = $('status')
const svgNS = 'http://www.w3.org/2000/svg'
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag)
  if (text !== undefined) node.textContent = text
  if (className) node.className = className
  return node
}
const button = (text: string, action: () => void, className?: string) => {
  const node = element('button', text, className)
  node.type = 'button'
  node.addEventListener('click', action)
  return node
}
function announce(message: string) {
  status.textContent = message
  status.hidden = !message
}

let recorder: MediaRecorder | undefined
let microphoneStream: MediaStream | undefined
let recordingTimer: ReturnType<typeof setTimeout> | undefined
let discardRecording = false
let microphonePending = false
function releaseMicrophone() {
  microphoneStream?.getTracks().forEach(track => track.stop())
  microphoneStream = undefined
  clearTimeout(recordingTimer)
  $('microphone').textContent = 'Record audio'
  $('microphone').setAttribute('aria-pressed', 'false')
}
async function captureAudio(onRecording: (dataUrl: string) => void) {
  if (microphonePending) return
  if (recorder?.state === 'recording') {
    recorder.stop()
    releaseMicrophone()
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    announce('Recording is unavailable in this browser. Add a note and type your transcript instead.')
    return
  }
  try {
    microphonePending = true
    $('microphone').setAttribute('disabled', '')
    announce('Waiting for microphone permission. Audio stays on this device.')
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    recorder = new MediaRecorder(microphoneStream)
    const chunks: BlobPart[] = []
    let bytes = 0
    discardRecording = false
    recorder.ondataavailable = event => {
      bytes += event.data.size
      if (bytes <= 2_000_000) chunks.push(event.data)
      else { discardRecording = true; if (recorder?.state === 'recording') recorder.stop() }
    }
    recorder.onerror = () => { announce('Recording failed. Type your transcript in a note instead.'); releaseMicrophone() }
    recorder.onstop = () => {
      releaseMicrophone()
      if (discardRecording) {
        announce('Recording was too large to save locally. Try a shorter recording or type a note.')
        return
      }
      const recording = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
      if (!recording.size) { announce('No audio was captured. Type your transcript in a note instead.'); return }
      const reader = new FileReader()
      reader.onload = () => onRecording(String(reader.result))
      reader.onerror = () => announce('The recording could not be stored. Try again or type a note.')
      reader.readAsDataURL(recording)
    }
    recorder.start(1000)
    $('microphone').textContent = 'Stop recording'
    $('microphone').setAttribute('aria-pressed', 'true')
    announce('Recording locally. Stop when ready; add your own transcript afterward. No speech service is used.')
    recordingTimer = setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop()
      releaseMicrophone()
    }, 60_000)
  } catch {
    releaseMicrophone()
    announce('Microphone access was denied or unavailable. Add a note and type your transcript instead.')
  } finally {
    microphonePending = false
    $('microphone').removeAttribute('disabled')
  }
}
window.addEventListener('pagehide', () => {
  discardRecording = true
  if (recorder?.state === 'recording') recorder.stop()
  releaseMicrophone()
})

const STORAGE_KEY = 'agentic-canvas.workspace.v1'
const AUDIO_KEY = 'agentic-canvas.audio.v1'
let snapshot: CanvasSnapshot = { objects: [], selectedIds: [], workflows: [] }
let audioData: Record<string, string> = {}
const history: CanvasSnapshot[] = []
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const payload = JSON.parse(stored)
    if (payload.version !== 1) throw new Error('Unsupported workspace version')
    snapshot = CanvasSnapshotSchema.parse(payload.snapshot)
  }
  const recordings = JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}')
  if (recordings && typeof recordings === 'object') {
    for (const [key, value] of Object.entries(recordings)) {
      if (typeof value === 'string' && value.length < 2_800_000 && /^data:audio\/[\w.+-]+(?:;codecs=[\w.,-]+)?;base64,[a-zA-Z0-9+/=]+$/.test(value))
        audioData[key] = value
    }
  }
} catch {
  announce('The saved workspace could not be read. A new canvas is open; the original saved data has not been overwritten.')
}
type Reply = {
  text: string; targetId?: string; choices?: boolean; animation?: boolean;
  loading?: boolean; error?: boolean; workflow?: SavedWorkflow;
}
const replies = new Map<string, Reply>()
for (const object of snapshot.objects) {
  if (object.kind === 'stroke' || object.animation) replies.set(object.id, {
    text: object.animation ? 'Your saved animation is active. Stop or reset it at any time.' : describeStroke(object),
    targetId: object.id, choices: !object.animation, animation: !!object.animation,
  })
}
let tool: 'select' | 'draw' | 'pan' = 'select'
let camera = { x: 0, y: 0, zoom: 1 }
let liveMode: 'jev' | 'copilot' | 'live' | null = null
let imageConsent = false
const requestGate = new RequestGate()
let activeRequest: AbortController | undefined
let activeAnchor: string | undefined
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, snapshot: CanvasSnapshotSchema.parse(snapshot) }))
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audioData))
    $('save-state').textContent = 'Stored on this device'
  } catch { $('save-state').textContent = 'Not saved'; announce('Local storage is full or unavailable. Export workflows before closing this page.') }
}
function change(operation: () => void) {
  history.push(structuredClone(snapshot))
  if (history.length > 60) history.shift()
  operation()
  persist()
  render()
}
function select(id: string) {
  snapshot.selectedIds = [id]
  persist()
  render()
}
function eventFor(type: CanvasEvent['type'], objectId: string, text?: string, action?: Capability): CanvasEvent {
  return { requestId: crypto.randomUUID(), origin: 'user', type, objectId, ...(text ? { text } : {}), ...(action ? { action } : {}) }
}
function apply(command: ToolCommand, event: CanvasEvent, grants: Capability[] = []) {
  const authorization = authorizeCommand(command, event, snapshot, grants)
  if (!authorization.allowed) { announce(authorization.reason); return false }
  if (command.type === 'animate_object') {
    change(() => { snapshot.objects.find(object => object.id === command.objectId)!.animation = command.animation })
  } else if (command.type === 'reply_below_object') {
    replies.set(command.objectId, { text: command.text, choices: true, targetId: command.objectId })
    render()
  } else if (command.type === 'show_action_proposals') {
    const anchor = event.objectId || command.objectId
    if (anchor) replies.set(anchor, { text: command.proposals.map(proposal => proposal.label).join(' '), choices: true, targetId: command.objectId || anchor })
    render()
  } else if (command.type === 'generate_image') {
    announce(imageConsent ? 'No image provider is configured. No image was generated. Configure a server-side provider before trying again.' : 'Image generation requires separate confirmation in Settings. No request was sent.')
  } else if (command.type === 'save_workflow') {
    change(() => { snapshot.workflows.push(command.workflow) })
  }
  return true
}
function receive(decision: Decision, event: CanvasEvent) {
  const anchor = event.objectId!
  if (decision.type === 'reply') {
    apply({ type: 'reply_below_object', objectId: decision.objectId, text: decision.text }, event, ['reply'])
  } else if (decision.type === 'propose') {
    apply({ type: 'show_action_proposals', objectId: decision.objectId, proposals: decision.proposals }, event)
    const source = snapshot.objects.find(object => object.id === anchor)
    if (source?.kind === 'stroke') replies.get(anchor)!.text = `${describeStroke(source)} Try a movement, or tell me more.`
  } else if (decision.type === 'animate') {
    const approval = authorizeCommand({ type: 'animate_object', objectId: decision.objectId, animation: decision.animation }, event, snapshot, ['animate'])
    replies.set(anchor, approval.allowed
      ? { text: `I can ${decision.animation === 'rotate' ? 'Rotate' : 'Pulse'} the selected drawing. Choose a movement to approve it.`, targetId: decision.objectId, animation: true }
      : { text: approval.reason, error: true })
  } else {
    replies.set(anchor, { text: decision.type === 'clarify' ? decision.question : decision.reason, choices: false })
  }
  const matched = suggestWorkflow(event, snapshot)
  if (matched && replies.has(anchor)) replies.get(anchor)!.workflow = matched
  announce(decision.type === 'clarify' ? decision.question : 'Assistant response ready beneath your object.')
  render()
}
async function submit(event: CanvasEvent) {
  if (!liveMode) { receive(offlineDecision(event, snapshot), event); return }
  if (activeAnchor) replies.set(activeAnchor, { text: 'Request superseded by newer input. No further action will be applied.' })
  activeRequest?.abort()
  const token = requestGate.begin()
  const controller = new AbortController()
  activeRequest = controller
  const anchor = event.objectId!
  activeAnchor = anchor
  replies.set(anchor, { text: 'Waiting for the live provider…', loading: true })
  render()
  const selected = snapshot.objects.filter(object => snapshot.selectedIds.includes(object.id) || object.id === snapshot.recentId || object.id === event.objectId)
  const minimal: CanvasSnapshot = {
    objects: selected.map(object => ({ ...object, text: object.text.slice(0, 4000), ...(object.points ? { points: object.points.filter((_, index) => index % Math.max(1, Math.ceil(object.points!.length / 100)) === 0) } : {}) })),
    selectedIds: snapshot.selectedIds.filter(id => selected.some(object => object.id === id)),
    ...(snapshot.recentId && selected.some(object => object.id === snapshot.recentId) ? { recentId: snapshot.recentId } : {}),
    workflows: [],
  }
  try {
    const response = await fetch('http://127.0.0.1:4318/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ event, snapshot: minimal, mode: liveMode, consent: true }),
    })
    if (!response.ok || !response.body) throw new Error('The live server is unavailable. Start the configured local server and try again.')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '', streamed = '', result: Decision | undefined
    while (true) {
      const chunk = await reader.read()
      if (!requestGate.current(token)) { await reader.cancel(); return }
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      if (buffer.length > 200_000) throw new Error('The live response exceeded its safety limit.')
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop()!
      for (const frame of frames) {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')
        if (!data) continue
        const message = JSON.parse(data)
        if (message.type === 'error') throw new Error('Live provider unavailable or returned an invalid response. No action was applied.')
        if (message.type === 'delta' && typeof message.text === 'string') {
          streamed = (streamed + message.text).slice(0, 8000)
          replies.set(anchor, { text: streamed, loading: true })
          render()
        }
        if (message.type === 'result') result = DecisionSchema.parse(message.decision)
      }
    }
    if (!result) throw new Error('The live provider ended without a validated result.')
    if (requestGate.current(token)) receive(result, event)
  } catch (error) {
    if (!requestGate.current(token)) return
    replies.set(anchor, { text: error instanceof Error ? error.message : 'Live request failed. No action was applied.', error: true })
    announce('The live request failed. Review the error beneath your object and try again.')
    render()
  } finally {
    if (requestGate.current(token)) { activeRequest = undefined; activeAnchor = undefined; requestGate.cancel() }
  }
}
function cancelRequest(anchor: string) {
  requestGate.cancel()
  activeRequest?.abort()
  activeRequest = undefined
  activeAnchor = undefined
  replies.set(anchor, { text: 'Request cancelled. No further action will be applied.' })
  render()
}
function newNote(kind: 'note' | 'audio' = 'note', recording?: string) {
  const id = crypto.randomUUID()
  const position = { x: (viewport.clientWidth / 2 - camera.x) / camera.zoom - 140, y: (180 - camera.y) / camera.zoom }
  change(() => {
    snapshot.objects.push({ id, kind, ...position, text: '', animation: null })
    // A new transcript must not replace the target the user selected.
    if (!snapshot.selectedIds.length && !snapshot.recentId) snapshot.selectedIds = [id]
    if (recording) audioData[id] = recording
  })
  if (recording) announce($('save-state').textContent === 'Not saved'
    ? 'Audio is available for this session, but local storage is full. It will not survive a reload. Type a transcript to keep the idea.'
    : 'Audio saved locally. Type a transcript, then submit. Nothing has been transcribed or uploaded.')
  document.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] textarea`)?.focus()
}
function setTool(next: typeof tool) {
  tool = next
  for (const name of ['select', 'draw', 'pan']) $(`${name}-tool`).setAttribute('aria-pressed', String(name === tool))
  viewport.style.cursor = tool === 'draw' ? 'crosshair' : tool === 'pan' ? 'grab' : 'default'
}
function updateCamera() {
  world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.zoom})`
  $('zoom-level').textContent = `${Math.round(camera.zoom * 100)}%`
}
function zoom(factor: number, x = viewport.clientWidth / 2, y = viewport.clientHeight / 2) {
  const next = Math.max(.25, Math.min(3, camera.zoom * factor))
  const ratio = next / camera.zoom
  camera.x = x - (x - camera.x) * ratio
  camera.y = y - (y - camera.y) * ratio
  camera.zoom = next
  updateCamera()
}
function center() {
  const object = snapshot.objects.find(item => snapshot.selectedIds.includes(item.id)) || snapshot.objects[0]
  camera = { x: object ? viewport.clientWidth / 2 - object.x - 140 : 0, y: object ? 170 - object.y : 0, zoom: 1 }
  updateCamera()
}
function motion(object: CanvasObject, action: 'rotate' | 'pulse' | 'stop' | 'reset') {
  if (action === 'stop' || action === 'reset') {
    change(() => { object.animation = null })
    announce(action === 'reset' ? 'Animation reset to its original appearance.' : 'Animation stopped.')
  } else apply({ type: 'animate_object', objectId: object.id, animation: action }, eventFor('proposal_accept', object.id, action, 'animate'))
}
function showPanel(title: string) {
        panel.replaceChildren()
        panel.hidden = false
        const heading = element('div', undefined, 'panel-heading')
        const headingText = element('h2', title)
        headingText.tabIndex = -1
        heading.append(headingText, button('Close', () => { panel.hidden = true; $('workflows').focus() }))
        panel.append(heading)
        headingText.focus()
      }
      function labelledInput(container: HTMLElement, label: string, value: string) {
        const input = element('input')
        const id = `field-${crypto.randomUUID()}`
        input.id = id; input.value = value
        const caption = element('label', label)
        caption.htmlFor = id
        container.append(caption, input)
        return input
      }
      function workflowFields(container: HTMLElement, workflow: SavedWorkflow, existing = false) {
        const name = labelledInput(container, 'Workflow name', workflow.name)
        name.maxLength = 100
        const description = element('p', 'Version 1 · Edit the definition below. Saving approves this exact definition. Triggers only suggest it; running requires a separate click.')
        container.append(description)
        const definition = element('textarea')
        definition.rows = 12
        definition.setAttribute('aria-label', 'Workflow definition: triggers, examples, inputs, steps and approvals')
        definition.value = JSON.stringify({
          description: workflow.description, triggers: workflow.triggers, examples: workflow.examples,
          inputs: workflow.inputs, steps: workflow.steps, approvalRequirements: workflow.approvalRequirements,
        }, null, 2)
        container.append(definition)
        const capabilities = element('p', `Approval includes: ${workflow.approvalRequirements.join(', ')}. Generated images still require separate provider consent.`)
        container.append(capabilities)
        const controls = element('div', undefined, 'actions')
        controls.append(button(existing ? 'Save changes' : 'Approve and save', () => {
          try {
            const edited = SavedWorkflowSchema.parse({ ...workflow, ...JSON.parse(definition.value), name: name.value, id: workflow.id, version: 1, approved: false })
            if (existing) change(() => {
              const index = snapshot.workflows.findIndex(item => item.id === workflow.id)
              snapshot.workflows[index] = { ...edited, approved: true }
            })
            else {
              const target = snapshot.objects.find(object => snapshot.selectedIds.includes(object.id)) || snapshot.objects.find(object => object.id === snapshot.recentId)
              if (!target) { announce('Select an object before saving its workflow.'); return }
              if (!apply({ type: 'save_workflow', workflow: edited }, eventFor('proposal_accept', target.id, undefined, 'save_workflow'))) return
              change(() => { snapshot.workflows.find(item => item.id === workflow.id)!.approved = true })
            }
            announce('Workflow approved and saved on this device.')
            showWorkflows()
          } catch { announce('The workflow definition is invalid. Check its triggers, examples, objectId input, supported steps and capability requirements.') }
        }, 'primary'))
        if (existing) controls.append(
          button('Run on selected', () => runWorkflow(snapshot.workflows.find(item => item.id === workflow.id)!)),
          button('Export workflow', () => {
            const saved = snapshot.workflows.find(item => item.id === workflow.id)!
            const url = URL.createObjectURL(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }))
            const link = element('a')
            link.href = url; link.download = `canvas-workflow-${saved.id}.json`; link.click()
            setTimeout(() => URL.revokeObjectURL(url), 1000)
          }),
          button('Delete workflow', () => { change(() => { snapshot.workflows = snapshot.workflows.filter(item => item.id !== workflow.id) }); showWorkflows() }),
        )
        container.append(controls)
      }
      function workflowEditor(object: CanvasObject) {
        snapshot.selectedIds = [object.id]
        showPanel('Keep this workflow')
        panel.append(element('p', 'Keep a useful action, not a conversation. Give it a name and approve exactly what it can do.'))
        workflowFields(panel, {
          ...drawingAnimationWorkflow, id: crypto.randomUUID(),
          steps: [{ type: 'animate_object', animation: object.animation || 'rotate' }],
          triggers: [{ type: 'stroke_complete', kind: 'stroke' }, { type: 'note_submit' }, { type: 'transcript_submit' }],
          examples: ['animate a drawing', 'rotate this sketch'],
        })
      }
      function showWorkflows() {
        showPanel('Your workflows')
        if (!snapshot.workflows.length) {
          panel.append(element('p', 'Nothing saved yet. Animate a drawing, then choose Save workflow beneath it. Saved routines suggest actions; they never run on their own.'))
        }
        for (const workflow of snapshot.workflows) {
          const section = element('section', undefined, 'workflow')
          workflowFields(section, workflow, true)
          panel.append(section)
        }
      }
      function runWorkflow(workflow: SavedWorkflow, targetId = snapshot.selectedIds[0]) {
        if (!targetId) { announce('Select one object before running a workflow.'); return }
        const event = eventFor('proposal_accept', targetId, undefined, workflow.approvalRequirements[0])
        const authorization = authorizeWorkflow(workflow, event, snapshot, workflow.approvalRequirements)
        if (!authorization.allowed) { announce(authorization.reason); return }
        for (const command of authorization.commands) apply(command, event, workflow.approvalRequirements)
        announce(`Ran “${workflow.name}” on the selected object.`)
      }
      function showSettings() {
        showPanel('Settings')
        panel.append(element('p', 'Offline is the default. Notes, original handwriting, audio and approved workflows are stored in this browser. No account is needed.'))
        panel.append(element('h3', 'Optional live assistance'))
        panel.append(element('p', 'Turning on Jev or Copilot sends the submitted text and only its selected / recent object context to the configured cloud provider. Raw audio and saved workflows are never sent. Provider retention rules apply.'))
        const jev = element('input'), copilot = element('input')
        jev.type = copilot.type = 'checkbox'
        jev.checked = liveMode === 'jev' || liveMode === 'live'
        copilot.checked = liveMode === 'copilot' || liveMode === 'live'
        const jevLabel = element('label'), copilotLabel = element('label')
        jevLabel.append(jev, document.createTextNode('Enable Jev cloud judgment'))
        copilotLabel.append(copilot, document.createTextNode('Enable Copilot live execution'))
        const update = () => {
          requestGate.cancel(); activeRequest?.abort(); activeRequest = undefined
          liveMode = jev.checked && copilot.checked ? 'live' : jev.checked ? 'jev' : copilot.checked ? 'copilot' : null
          for (const [id, reply] of replies) if (reply.loading) replies.set(id, { text: 'Request cancelled because provider settings changed.' })
          render()
          announce(liveMode ? 'Live assistance enabled for this session. The next submitted note or stroke may leave your device.' : 'Offline mode restored. No further cloud requests will be sent.')
        }
        jev.addEventListener('change', update); copilot.addEventListener('change', update)
        panel.append(jevLabel, copilotLabel, element('p', 'The local adapter server must be running and configured. Live failures stay visible; they never silently switch to offline.'))
        panel.append(element('h3', 'Image generation'))
        const image = element('input'); image.type = 'checkbox'; image.checked = imageConsent
        const label = element('label')
        label.append(image, document.createTextNode('Allow image prompts to a configured provider'))
        image.addEventListener('change', () => { imageConsent = image.checked })
        panel.append(label, element('p', 'No image provider is configured in this example. Illustrate reports that limitation instead of returning a canned image. Original marks are never replaced.'))
      }
      $('add-note').addEventListener('click', () => newNote())
      $('microphone').addEventListener('click', () => void captureAudio(data => newNote('audio', data)))
      $('select-tool').addEventListener('click', () => setTool('select'))
      $('draw-tool').addEventListener('click', () => setTool('draw'))
      $('pan-tool').addEventListener('click', () => setTool('pan'))
      $('zoom-in').addEventListener('click', () => zoom(1.2))
      $('zoom-out').addEventListener('click', () => zoom(1 / 1.2))
      $('home').addEventListener('click', center)
      $('workflows').addEventListener('click', showWorkflows)
      $('settings').addEventListener('click', showSettings)
      $('undo').addEventListener('click', () => {
        const previous = history.pop()
        if (!previous) return
        requestGate.cancel(); activeRequest?.abort()
        snapshot = previous; persist(); render()
        announce('Last canvas change undone.')
      })
      let gesture: { type: 'draw' | 'pan' | 'move'; pointer: number; startX: number; startY: number; originalX: number; originalY: number; id?: string; points: { x: number; y: number }[] } | undefined
      function localPoint(event: PointerEvent) {
        const bounds = viewport.getBoundingClientRect()
        return { x: (event.clientX - bounds.left - camera.x) / camera.zoom, y: (event.clientY - bounds.top - camera.y) / camera.zoom }
      }
      viewport.addEventListener('pointerdown', event => {
        if (event.button !== 0 || (event.target as HTMLElement).closest('button,input,textarea,audio,.reply')) return
        const objectNode = (event.target as HTMLElement).closest<HTMLElement>('.object')
        const object = snapshot.objects.find(item => item.id === objectNode?.dataset.id)
        const kind = tool === 'draw' ? 'draw' : tool === 'pan' || !object ? 'pan' : 'move'
        if (kind === 'move' && object) select(object.id)
        gesture = { type: kind, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, originalX: kind === 'move' ? object!.x : camera.x, originalY: kind === 'move' ? object!.y : camera.y, id: object?.id, points: [localPoint(event)] }
        viewport.setPointerCapture(event.pointerId)
        viewport.focus({ preventScroll: true })
      })
      viewport.addEventListener('pointermove', event => {
        if (!gesture || gesture.pointer !== event.pointerId) return
        if (gesture.type === 'draw') {
          if (gesture.points.length < 4096) gesture.points.push(localPoint(event))
          const bounds = viewport.getBoundingClientRect()
          $('draft').querySelector('path')!.setAttribute('d', gesture.points.map((point, index) => `${index ? 'L' : 'M'}${point.x * camera.zoom + camera.x},${point.y * camera.zoom + camera.y}`).join(' '))
          $('draft').setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`)
        } else if (gesture.type === 'pan') {
          camera.x = gesture.originalX + event.clientX - gesture.startX
          camera.y = gesture.originalY + event.clientY - gesture.startY
          updateCamera()
        } else {
          const node = world.querySelector<HTMLElement>(`[data-id="${gesture.id}"]`)
          if (node) { node.style.left = `${gesture.originalX + (event.clientX - gesture.startX) / camera.zoom}px`; node.style.top = `${gesture.originalY + (event.clientY - gesture.startY) / camera.zoom}px` }
        }
      })
      function endGesture(event: PointerEvent, cancelled = false) {
        if (!gesture || gesture.pointer !== event.pointerId) return
        const completed = gesture; gesture = undefined
        $('draft').querySelector('path')!.removeAttribute('d')
        if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
        if (cancelled) { render(); return }
        if (completed.type === 'draw' && completed.points.length > 2) {
          const id = crypto.randomUUID()
          const x = Math.min(...completed.points.map(point => point.x)), y = Math.min(...completed.points.map(point => point.y))
          change(() => {
            snapshot.objects.push({ id, kind: 'stroke', x, y, text: '', points: completed.points.map(point => ({ x: point.x - x, y: point.y - y })), animation: null })
            snapshot.selectedIds = [id]; snapshot.recentId = id
          })
          void submit(eventFor('stroke_complete', id))
        }
        if (completed.type === 'move') {
          const object = snapshot.objects.find(item => item.id === completed.id)!
          const dx = (event.clientX - completed.startX) / camera.zoom, dy = (event.clientY - completed.startY) / camera.zoom
          if (Math.abs(dx) + Math.abs(dy) > 1) change(() => { object.x = completed.originalX + dx; object.y = completed.originalY + dy })
        }
      }
      viewport.addEventListener('pointerup', event => endGesture(event))
      viewport.addEventListener('pointercancel', event => endGesture(event, true))
      viewport.addEventListener('wheel', event => {
        event.preventDefault()
        if (event.ctrlKey || event.metaKey) {
          const bounds = viewport.getBoundingClientRect()
          zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX - bounds.left, event.clientY - bounds.top)
        } else {
          camera.x -= event.deltaX; camera.y -= event.deltaY; updateCamera()
        }
      }, { passive: false })
      document.addEventListener('keydown', event => {
        if ((event.target as HTMLElement).matches('input,textarea,select')) return
        if (event.key === 'Escape') { panel.hidden = true; setTool('select'); return }
        if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2) }
        if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2) }
        if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey) newNote()
        if (event.key.startsWith('Arrow')) {
          event.preventDefault()
          const amount = event.shiftKey ? 20 : 5
          const dx = event.key === 'ArrowLeft' ? -amount : event.key === 'ArrowRight' ? amount : 0
          const dy = event.key === 'ArrowUp' ? -amount : event.key === 'ArrowDown' ? amount : 0
          const selected = snapshot.objects.filter(object => snapshot.selectedIds.includes(object.id))
          if (tool === 'pan' || event.altKey || !selected.length) { camera.x += dx * 5; camera.y += dy * 5; updateCamera() }
          else change(() => { selected.forEach(object => { object.x += dx; object.y += dy }) })
        }
      })
function render() {
  const focused = document.activeElement as HTMLElement | null
  const focusKey = focused?.dataset.focusKey
  const selection = focused instanceof HTMLTextAreaElement ? [focused.selectionStart, focused.selectionEnd] : undefined
  world.replaceChildren()
  $('object-list').replaceChildren()
  $('empty').hidden = snapshot.objects.length > 0
  $('undo').toggleAttribute('disabled', !history.length)
  for (const object of snapshot.objects) {
    const node = element('article', undefined, `object${snapshot.selectedIds.includes(object.id) ? ' selected' : ''}`)
    node.dataset.id = object.id
    node.dataset.x = String(object.x)
    node.style.left = `${object.x}px`; node.style.top = `${object.y}px`
    const body = element('div', undefined, `object-body${object.kind === 'stroke' ? ' stroke-body' : ''}${object.animation ? ` motion-${object.animation}` : ''}`)
    const title = element('div', undefined, 'object-kind')
    title.append(element('span', object.kind === 'stroke' ? 'FREEHAND' : object.kind === 'audio' ? 'AUDIO NOTE · LOCAL' : 'NOTE'), button(`Select ${object.kind}`, () => select(object.id)))
    body.append(title)
    if (object.kind === 'stroke') {
      const svg = document.createElementNS(svgNS, 'svg')
      svg.setAttribute('viewBox', '0 0 256 140')
      svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Your original freehand drawing')
      const path = document.createElementNS(svgNS, 'path')
      const points = object.points || []
      const xs = points.map(point => point.x), ys = points.map(point => point.y)
      const minX = Math.min(...xs), minY = Math.min(...ys)
      const scale = Math.min(230 / Math.max(1, Math.max(...xs) - minX), 115 / Math.max(1, Math.max(...ys) - minY), 1.5)
      path.setAttribute('d', points.map((point, index) => `${index ? 'L' : 'M'}${12 + (point.x - minX) * scale},${12 + (point.y - minY) * scale}`).join(' '))
      path.setAttribute('fill', 'none'); path.setAttribute('stroke', '#3c5948'); path.setAttribute('stroke-width', '2.3'); path.setAttribute('stroke-linecap', 'round'); path.setAttribute('stroke-linejoin', 'round')
      svg.append(path); body.append(svg)
    } else {
      if (object.kind === 'audio' && audioData[object.id]) {
        const audio = element('audio', undefined, 'audio-player')
        audio.controls = true; audio.src = audioData[object.id]!; audio.setAttribute('aria-label', 'Locally saved audio recording')
        body.append(audio)
      }
      const input = element('textarea', undefined, 'note-text')
      input.value = object.text; input.maxLength = 4000; input.placeholder = object.kind === 'audio' ? 'Type your transcript…' : 'What are you thinking?'
      input.setAttribute('aria-label', object.kind === 'audio' ? 'Audio transcript' : 'Note text')
      input.dataset.focusKey = object.id
      let beforeEdit: CanvasSnapshot | undefined
      input.addEventListener('focus', () => { beforeEdit = structuredClone(snapshot) })
      input.addEventListener('input', () => { object.text = input.value; persist() })
      input.addEventListener('change', () => {
        if (beforeEdit && beforeEdit.objects.find(item => item.id === object.id)?.text !== input.value) {
          history.push(beforeEdit)
          if (history.length > 60) history.shift()
          $('undo').removeAttribute('disabled')
        }
        beforeEdit = undefined
      })
      body.append(input, button(object.kind === 'audio' ? 'Submit transcript' : 'Submit note', () => {
        if (!object.text.trim()) { announce('Write a note or transcript before submitting.'); return }
        void submit(eventFor(object.kind === 'audio' ? 'transcript_submit' : 'note_submit', object.id, object.text))
      }, 'submit'))
    }
    node.append(body)
    const reply = replies.get(object.id)
    if (reply) {
      const card = element('section', undefined, `reply${reply.error ? ' error' : ''}`)
      card.setAttribute('aria-label', `Assistant response to ${object.kind}`)
      card.append(element('div', reply.loading ? 'LIVE · WORKING' : liveMode ? 'ASSISTANT · LIVE' : 'ASSISTANT · OFFLINE', 'agent-label'), element('p', reply.text))
      const actions = element('div', undefined, 'actions')
      const target = snapshot.objects.find(item => item.id === (reply.targetId || object.id))
      if (reply.loading) actions.append(button('Cancel request', () => cancelRequest(object.id)))
      else {
        if (reply.choices) actions.append(
          button('Animate', () => { replies.set(object.id, { ...reply, choices: false, animation: true, text: 'Choose a movement. Your original marks stay editable.' }); render() }),
          button('Illustrate', () => {
            const targetId = target?.id || object.id
            apply({ type: 'generate_image', objectId: targetId, prompt: object.text || 'Illustrate this drawing' }, eventFor('proposal_accept', targetId, undefined, 'illustrate'))
            replies.set(object.id, { ...reply, text: 'Image generation is unavailable: no provider is configured. Your original drawing is unchanged.' }); render()
          }),
          button('Clarify', () => { replies.set(object.id, { text: 'Select the object you mean, then add a note or transcript with what you want to change.' }); render() }),
        )
        if (reply.animation && target) actions.append(button('Rotate', () => motion(target, 'rotate')), button('Pulse', () => motion(target, 'pulse')))
        if (target?.animation) actions.append(button('Stop', () => motion(target, 'stop')), button('Reset', () => motion(target, 'reset')), button('Save workflow', () => workflowEditor(target)))
        if (reply.workflow) actions.append(button(`Use ${reply.workflow.name}`, () => runWorkflow(reply.workflow!, target?.id)))
      }
      card.append(actions); node.append(card)
    }
    world.append(node)
    const objectButton = button(`Select ${object.kind} ${snapshot.objects.indexOf(object) + 1}`, () => { select(object.id); center() })
    objectButton.setAttribute('aria-pressed', String(snapshot.selectedIds.includes(object.id)))
    $('object-list').append(objectButton)
  }
  updateCamera()
  if (focusKey) {
    const restored = world.querySelector<HTMLTextAreaElement>(`[data-focus-key="${focusKey}"]`)
    restored?.focus()
    if (selection) restored?.setSelectionRange(selection[0]!, selection[1]!)
  }
}
render()
