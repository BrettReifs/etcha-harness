# Agentic canvas — first local milestone

An opt-in reference app, not a new Etcha runtime. The canvas owns its product
brief, package, dependencies, and data. Harness setup and adoption do not install
this app. No deployment or telemetry is included.

## Run offline

Use Node 22.23.2. From any directory:

```sh
npm ci --prefix /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
npm run dev --prefix /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. Replace the absolute checkout path on another machine.
The default is **deterministic offline demo**. Its replies are rule-based demo
text, not live model output. A completed stroke gets a tentative, labeled
heuristic description, not a vision or handwriting-transcription claim.

## Hero flow

1. Add a note, type, and submit. A reply appears beneath it.
2. Use Draw to complete a stroke. Read the contextual proposals.
3. Choose Animate. Stop/reset restores the object; Undo reverses the change.
4. Select a drawing and submit `animate that` through the transcript field.
   Ambiguous selection asks for clarification instead of choosing silently.
5. Approve the suggested drawing-animation workflow. Edit, export, or delete it
   in Workflows. Reload to reuse the saved definition.

The microphone is opt-in. Record and stop to keep an anchored audio note.
Recording is not speech recognition. Enter a transcript yourself; the fallback
is always available, including when microphone access is denied.

## Architecture and trust boundary

```text
explicit user event → retained stroke / typed transcript → bounded context
  → offline judgments OR opt-in Jev judgments
  → deterministic policy and permissions
  → optional Copilot SDK narrow tools
  → validated local, undoable canvas changes
```

`src/core.ts` owns schemas, stable IDs, primitive rule priority, target resolution,
capability checks, workflow selection, and stale-result protection.
`src/main.ts` owns rendering, local history, persistence, and recording.
`src/server/` owns live credentials and adapters. Browser code does not import
the Copilot SDK. User and agent text is untrusted plain text; models cannot supply
executable UI, JavaScript, or arbitrary tool names.

The contextual cards are allowlisted application components. This is **not**
an implementation of the full A2UI protocol. A future protocol adapter must map
validated messages into these components, not evaluate generated UI code.

Saved workflows are versioned, explicit definitions, not weight training or
silent preference collection. Routing scopes primitive rules to events and
capabilities. Workflow lookup ranks a bounded candidate list, inspects candidates,
and can abstain. Generated events cannot recursively invoke the coordinator.

## Canvas choice

A small DOM/SVG world is sufficient for this bounded vertical slice. It preserves
semantic note editors and buttons while providing world coordinates, drawing,
movement, pan, and zoom. It does not reproduce tldraw's complete editor:
multi-stroke semantic grouping, connectors, rich text, collaborative sync, and
large-document virtualization are outside this milestone.

tldraw is an inspiration, not a dependency. The evaluated package was **5.5.2**.
Its [license at the published package revision](https://github.com/tldraw/tldraw/blob/be4d5b30cbf896c92436d634e59843a920705cef/LICENSE.md)
permits internal development but requires applicable additional terms for
production use. Its official editor API supports `createShapes`, `select`,
`updateShape`, and snapshot persistence; it also brings a much larger editor and
licensing boundary than this slice needs. Do not assume public deployment is
free. The custom implementation avoids making those terms a setup prerequisite.

## Optional live adapters

Run the UI on port **5173**. In a second terminal:

```sh
cd /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
cp .env.example .env
# Edit .env locally. Never commit credentials.
npm run server
```

The server binds only `127.0.0.1:4318`. It accepts the explicit loopback frontend
origin, JSON requests with consent, and bounded validated context. It is not a
public API or a deployment configuration. Enable Jev, Copilot, or both in
Settings only after reviewing the disclosure. Failure remains visible; no
offline reply substitutes for a failed live request.

### Jev

Jev receives text/JSON perception and context, never raw media. The verified
official SDK wire is `POST https://api.typesafe.ai/v1/systemone`, with
`{state, model, questions}` and default model alias `jev-latest`. Questions are
named Choice criteria, ordered zero-based Score rubrics, and Noul yes/no
instructions. Responses use `{model, usage, answers}`. Choice and Score return
probabilities and confidence; Noul returns a probability from 0 to 1 and no
separate confidence field. Configure the server key, not browser code.

Sources: [official documentation index](https://docs.typesafe.ai/),
[API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice),
[Score](https://docs.typesafe.ai/primitives/score), [Noul](https://docs.typesafe.ai/primitives/noul),
and [confidence](https://docs.typesafe.ai/confidence).
Direct docs/index fetching failed DNS in this environment. Endpoint, request,
response, and bearer authentication were checked against the
[official Python SDK](https://github.com/typesafe-ai/typesafe-sdk-python)
generated OpenAPI schemas, transport, and round-trip fixtures (checked-in version
0.7.2). This app uses HTTP, not a dependency on that Python package.

Independent questions share state; do not rely on one answer feeding another
question in the same call. Keep dependent steps sequential. Confidence is not an
authorization grant or a correctness guarantee. Thresholds are configurable,
unvalidated defaults; evaluate them on representative canvas events before use.
Fixture tests establish parsing and safe abstention, not live calibration.

### GitHub Copilot SDK

The pinned Node package is **`@github/copilot-sdk` 1.0.16**, with published
runtime version **1.0.90**. Integration follows the
[release Node reference](https://github.com/github/copilot-sdk/tree/v1.0.16/nodejs)
and [authentication reference](https://github.com/github/copilot-sdk/blob/v1.0.16/docs/auth/authenticate.md).
Configure the optional server-side token using the env example. Authentication
and provider access are the user's choice; no service purchase is required for
the offline app. Jev is a separate judgment service, not a Copilot chat model.

Sessions use empty mode, an explicit custom-tool allowlist, no MCP servers,
skills, agents, or model memory, and rejection of runtime permission requests.
The only operations are validated application tools. Their handlers perform
schema, target, and authorization checks independently of prompts and scores.
Built-in shell, filesystem, and network tools are excluded. Streaming deltas are
untrusted provisional text, not proof an operation ran. Cancellation aborts
active work and discards stale results; sessions and clients are cleaned up.

**Live verification is incomplete:** no credentialed Jev or Copilot request was
run. Mocked wire/SDK tests and compilation do not establish provider availability,
account entitlement, calibration, or end-to-end live behavior.

## Tests and evidence

```sh
npm run check --prefix /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
npm run build --prefix /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
npm test --prefix /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
cd /home/runner/work/etcha-harness/etcha-harness/examples/agentic-canvas
npx --no-install playwright install chromium
npm run test:browser
npm run detect
```

Use the **example-local** Playwright runner, pinned at 1.63.0. Keep Chromium's
sandbox enabled. Browser tests preserve candidates and text results in separate
ignored run directories. They do not approve or overwrite visual baselines.
Human visual approval, real-device recording, and assistive-technology review
remain separate requirements.

The root `npm test` and `npm run check` still validate the harness independently.

## Data and limitations

Canvas data and approved workflows stay in this browser's local storage.
Recordings stay local. Local persistence is not encrypted storage or a backup;
do not use this prototype for sensitive material on a shared browser profile.
Use workflow export for definitions you need to keep. Deleting an object is not
a claim of secure disk erasure.

Live mode is an explicit user choice. It can send note/transcript text,
descriptive stroke geometry, selected/recent object context, and candidate
workflow definitions to the configured providers. It does not send recording
bytes or raw images to Jev. Provider retention and billing follow the user's
provider agreements; this example cannot promise those services keep data local.
Live failures must remain visible and must not turn into fake demo success.

Animation is local rotation or pulse, not generated video or a learned morph.
The original stroke remains available. Detailed image output has no default
provider. It must remain unavailable until a trusted adapter is configured and
the user confirms the request. A canned image must never be called AI output.
Live perception likewise needs a supported adapter; the offline geometric
description is not live vision.

Next milestones are multi-stroke grouping, richer perception/transcription
adapters, calibrated threshold evaluation on representative examples, and
human-reviewed visual baselines. Multi-user sync, deployment, cross-repository
dependencies, and model-weight training are deliberately excluded.
