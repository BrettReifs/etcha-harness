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
