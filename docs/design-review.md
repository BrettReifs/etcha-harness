# Verify a product

Run one command from any directory:

```sh
node /absolute/path/to/product/.etcha/harness/scripts/verify.mjs --config /absolute/path/to/product/etcha.verify.json
```

The command emits JSON grouped as `blocking`, `high-value`, and `advisory`.
Each finding includes a rule, surface, evidence, and next action. Blocking
findings or missing coverage produce exit code 1. Independent checks continue.
Review all high-value findings before completing a task.
The `commands` section retains bounded build/detector output and marks
truncation. Common credential patterns are redacted, but redaction is not a
guarantee. Never configure commands to print secrets.

## Configuration

The config belongs to the product. `version` must be `1`. Its directory is the
default working root; optional `root` is resolved relative to that directory.
Commands are argv arrays, not shell strings. They run with a timeout. These
commands execute product code, so review the config before running it.

Adapt this example to the product's actual commands and UI:

```json
{
  "version": 1,
  "build": { "command": ["npm", "run", "build"], "timeoutMs": 120000 },
  "detect": {
    "command": ["node", ".etcha/harness/node_modules/impeccable/cli/bin/cli.js", "detect", "--json", "src"],
    "timeoutMs": 60000
  },
  "browser": {
    "baseURL": "http://127.0.0.1:4173",
    "start": { "command": ["npm", "run", "preview", "--", "--port", "4173", "--strictPort"], "timeoutMs": 20000 },
    "timeoutMs": 120000,
    "checkTimeoutMs": 5000,
    "artifactsDir": ".etcha/results",
    "baselineDir": "tests/visual/baselines",
    "approvalManifest": "tests/visual/approval.json",
    "zoom": { "mode": "reflow-model", "approved": true },
    "viewports": [
      { "name": "desktop", "width": 1280, "height": 800, "approved": true },
      { "name": "tablet", "width": 768, "height": 1024, "approved": true },
      { "name": "mobile", "width": 390, "height": 844, "approved": true }
    ],
    "states": [
      {
        "name": "home",
        "path": "/",
        "smoke": [{ "role": "heading", "name": "Product heading" }],
        "keyboard": [{ "role": "button", "name": "Primary action" }],
        "reducedMotion": [
          { "selector": ".status", "property": "transition-duration", "equals": "0s" }
        ]
      }
    ]
  }
}
```

The widths and labels above are examples, not universal defaults or approved
product choices. Set all three viewport classes explicitly. Enumerate the
complete Tab order for each state; use exact accessible role/name pairs.
Add states for errors, empty data, expanded panels, and other required surfaces.

Optional state `actions` support `click`, `fill`, `press`, and `waitFor`.
Click, fill, and wait actions target an exact `role` and `name`; fill also needs
`value`. Press needs `key`. Keep fixtures and actions deterministic and free of
credentials.

Omit `browser.start` to use a server already running. Servers started by Etcha
are stopped on completion, failure, or cancellation. Their configured port must
be free before startup. Configure the server to fail rather than choose another
port, and avoid concurrent processes claiming that port during startup.
Each surface and action replay starts in a fresh browser context; persistent
storage is not inherited from the previous check. The browser accepts only a loopback
base URL. Remote resources and WebSockets are blocked; serve needed assets
locally. The default adapter is intentionally not an authenticated production
site crawler.

## Evidence and limits

- Production build and native detector commands are explicit. A missing command
  is not a pass. Do not substitute the neutral fixture checks for real product checks.
- axe-core checks accessible names, landmarks, and other machine-testable rules.
  Inconclusive findings need review. It does not replace assistive-technology testing.
- Real Tab navigation checks the declared order and unexpected extra stops.
  The built-in check expects a normal document Tab sequence. Use product-specific
  checks or a replacement adapter for modal focus traps and composite-widget
  arrow-key behavior.
- Focus checks collect computed-style evidence and focused screenshots. They do
  not prove perceptual contrast or freedom from clipping; a human inspects them.
- Overflow is checked at each approved viewport.
- Reduced-motion checks compare explicit CSS expectations under the preference.
- Screenshots use exact bytes and separate candidate paths. Pin the browser,
  operating system, fonts, data, and states to avoid incidental differences.
- A product can explicitly approve the `reflow-model` zoom check. It uses half
  the desktop CSS viewport dimensions and device scale 2, checks overflow and required
  content, and saves screenshot evidence. This is a 200% layout model, not genuine
  browser-UI zoom. A human must still check actual browser zoom. Without an
  approved model or a replacement adapter, zoom coverage remains blocking.

  ### 3D reference evidence

  The hero-morph reference example supplements browser UI checks with tests of
  equipment state, mesh deformation, attachment positions, interrupted motion,
  and the renderer's reduced-motion behavior. These are example-owned checks,
  not new guarantees from the default browser adapter.

  CSS expectations cannot establish that canvas animation stopped. axe-core
  cannot inspect a mesh or its facial features. A settled screenshot cannot prove
  smooth motion, and exact image bytes can vary across graphics drivers even
  with the same browser. Use deterministic animation checkpoints for diagnosis,
  then review motion and readability on target devices. Keep candidate images
  separate from human-approved baselines. Do not label an untested device,
  performance budget, or assistive-technology path as passing.

## Recover safely before visual review

For an interrupted session, inspect the saved commit and working tree first.
Separate completed checks from checks that were skipped or lost. A recovery
commit is not proof that verification passed.

1. Finish screenshot generation and wait for the test process to exit. Do not
   inspect files while a test runner or another agent can overwrite or clean them.
2. Keep each capture run in a separate directory. The hero-morph Playwright
   config creates `test-results/run-UUID/` under the example, with candidate
   screenshots and a native `results.json` report. New runs do not clean older
   run directories. Do not override the output directory with a shared path.
   Leave `ETCHA_HERO_EVIDENCE_RUN` unset when starting a run; the config assigns
   it for that run's child processes. Reusing an ID can overwrite its evidence.
3. Before opening images, scan changed files for secrets and commit the work.
   Record the commit, commands, outcomes, evidence paths, and remaining checks
   in the task progress report. Keep generated evidence out of source commits.
   These ignored files last only as long as the workspace; use approved artifact
   storage when evidence must survive a fresh session, or recapture in a new run.
4. Read candidate images individually on recovery. Keep the completed run
   unchanged until review ends. Clean old runs only after their evidence is no
   longer needed, with no active readers or writers.
5. If image inspection fails, report **visual review incomplete**. Automated
   checks may still pass, but do not claim visual acceptance, create an approval
   record, or approve baselines. Resume from the checkpoint in a new session.

Unique paths and individual reads are recovery precautions, not a proven fix
for an upstream file-download failure. If it repeats, give GitHub Support the
new run URL, timestamp, exact error, request ID, and the affected evidence path.
The original incident is
[run 34669844938](https://github.com/BrettReifs/etcha-harness/actions/runs/34669844938):
`CAPIError: 400 Error while downloading file. Upstream status code: 404.`,
request ID `3009:D79A8:23DBD6:371174:6AA4C5D6`.
It occurred after screenshot reads; the logs do not prove why the upstream
file was unavailable. Do not change firewall rules or dependencies based only
on this error.

## Human baseline record

Candidate images are under a unique run directory, then
`STATE/VIEWPORT/candidate.png`. Baselines use `STATE/VIEWPORT.png`.
The product-owned approval manifest contains:

- `version`: `1`
- `approvedBy`: the human reviewer
- `approvedAt`: an ISO date/time
- `configSha256`: SHA-256 of the exact config file bytes
- `baselines`: a map from `STATE/VIEWPORT.png` to each image's SHA-256

A changed config invalidates the record. A changed baseline digest blocks
verification. The verifier has no baseline-update or approval command.
The test suite simulates external approval only in disposable test fixtures.
Real approval requires [human review and repository protection](visual-approval.md).

## Replace the browser adapter

Set `browser.adapter.command` to a reviewed argv array. Etcha appends
`--config ABSOLUTE_JSON_PATH`. The adapter must emit one JSON object:

- `schemaVersion`: `1`
- `findings`: an array of `{severity, rule, surface, evidence, action}`
- `coverage`: boolean values for `axe`, `smoke`, `keyboard`, `focusVisible`,
  `responsive`, `reducedMotion`, `zoom`, and `visual`

Use severity `blocking`, `high-value`, or `advisory`. Exit nonzero on blocking
failures. Missing or false coverage blocks acceptance. A replacement must keep
the same human-approval and security requirements. Do not declare coverage that
was not executed.
