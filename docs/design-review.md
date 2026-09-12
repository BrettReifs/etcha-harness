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
4. Keep cloud recovery text-only: do not open screenshots with an image-reading
   tool or return image attachments from browser tools or subagents. Continue
   automated tests and capture images to files. Read the text results instead.
   This isolates the suspected failing handoff; it does not repair the runtime.
5. Hand candidate images to a human reviewer outside the failing cloud session.
   Keep the completed run unchanged until review ends. Clean old runs only after
   their evidence is no longer needed, with no active readers or writers.
6. Report **visual review incomplete** until the required review is complete.
   Automated checks may still pass, but do not claim visual acceptance, create
   an approval record, or approve baselines on that basis.

Unique paths and individual reads are recovery precautions, not a proven fix
for an upstream file-download failure. Both were in use when the second incident
occurred. Do not retry image reads repeatedly in the recovery session.

### Downloadable hero evidence

The `Hero evidence` workflow runs the existing example build, unit tests, and
browser tests on relevant pull requests, or by manual dispatch once the workflow
is available on the default branch. It uses the pinned Playwright Chromium.
It does not send images to Copilot or approve baselines.

Open the workflow run in GitHub Actions and download
`hero-evidence-RUN_ID-RUN_ATTEMPT` from **Artifacts**. The archive contains the
per-run `results.json`, candidate PNGs, and failure traces when produced. The
job summary records the tested commit and check outcomes. Check the JSON report
and job outcome: an archive can contain partial evidence from a failed test.
If checks failed before producing evidence, there may be no archive.

Evidence is retained for 14 days. Download it before expiry, or rerun the workflow
to capture new evidence tied to a new run. Use only synthetic example data;
screenshots and traces can contain page content. Human reviewers should inspect
the downloaded images and review motion locally on the target devices. A green
workflow is not visual approval. Repository policy may require a maintainer to
approve the workflow before it runs; do not bypass that approval.

### Separate-session image capability probe

Only run this diagnostic in a fresh, disposable cloud session with no unfinished
implementation work. Use one small, known-good, non-sensitive image from a
completed capture. Confirm that the file exists and decodes locally, then ask
the agent to inspect it once and return a text description. Success requires
the next model response to finish, not merely a successful image-read tool call.

The probe itself may terminate the session. If it fails, stop image-based cloud
review and retain the run URL and request ID. If it passes, it establishes only
that this handoff worked once; it is not a guarantee against recurrence. Local
browser tests and file-existence checks cannot test Copilot's upstream download.
Do not embed this probe in application CI or a recovery run.

### Upstream support handoff

These two runs failed with
`CAPIError: 400 Error while downloading file. Upstream status code: 404.`:

| Run | Failure time (UTC) | Request ID | Preceding operation |
| --- | --- | --- | --- |
| [34669844938](https://github.com/BrettReifs/etcha-harness/actions/runs/34669844938) | 2026-09-12 03:24:07 | `3009:D79A8:23DBD6:371174:6AA4C5D6` | Four candidate image reads reported success before the next model request failed. |
| [34670544421](https://github.com/BrettReifs/etcha-harness/actions/runs/34670544421) | 2026-09-12 03:39:39 | `6046:3C7804:5D0AC6:71FF57:6AA4C97A` | One candidate image read from a unique run directory reported success before the next model request failed. |

Send GitHub Support these run links, timestamps, request IDs, and the affected
evidence path from the logs. Include any separate probe result. Ask them to trace
the image/file handoff and explain the upstream 404. Review attachments for
sensitive data before sharing them. This handoff is not a submitted support case.

The repeated sequence points to the image/file handoff, but the logs do not
prove why the upstream file was unavailable. The Linux package name in the stack
trace does not establish a Linux fault. Do not weaken firewall rules, browser
sandboxing, or approval checks, or change dependencies based only on this error.

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
