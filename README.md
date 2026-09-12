# Etcha harness

Reusable design practice for local and cloud Copilot agents. Etcha adds context
boundaries, a bounded UI brief, verification, and safe adoption to official
[Impeccable](https://github.com/pbakaus/impeccable).

This is not a component library, product template, or copy of Ideas. The broader
Etcha personal agent system and C4 map are deferred.

## Set up

Use Node.js **22.23.2** and the committed dependency lock:

```sh
npm ci
npm run setup:engine
npx --no-install playwright install --with-deps chromium
npm run check
npm test
```

`check` validates the native payload hashes, pinned engine, native doctor,
detector, and an actual seeded edit through the committed Copilot hook.
Tests cover adoption, command orchestration, and browser evidence.

Pinned versions: Impeccable CLI **4.1.0**, engine **0.1.5**, skill **4.3.1**,
Playwright **1.63.0**, and axe-core adapter **4.13.0**.
That Playwright release selects Chromium **153.0.8010.12**, revision **1243**.
The skill and hook came from the official project installer. Their native
structure is unchanged. See `impeccable.lock.json` for file hashes and provenance.
Downloaded engines and local caches are not committed.

## Use

Read the [Etcha skill](.github/skills/etcha-design/SKILL.md) before a UI edit.
It links the context adapters, reduction-law brief, and review rules.

- [Adopt, update, or remove Etcha](docs/adoption.md)
- [Keep context layers separate](docs/context-layers.md)
- [Configure verification and read results](docs/design-review.md)
- [Approve visual changes](docs/visual-approval.md)

Run the product's configured checks with one command:

```sh
npm run verify -- --config /absolute/path/to/product/etcha.verify.json
```

Missing checks and unapproved visual changes are blockers. A clean detector or
accessibility scan is evidence, not human design approval.

## Reference prototype: hero morph

The isolated [hero-morph example](examples/hero-morph/index.html) tests one
equipment-driven 3D transformation: equip a colorful badge on a white,
cel-shaded hero, then remove it to restore the base shape. This is the first
reference milestone, not a complete game or a default Etcha design.

From this checkout, install and launch the example separately:

```sh
npm ci --prefix /home/runner/work/etcha-harness/etcha-harness/examples/hero-morph
npm run dev --prefix /home/runner/work/etcha-harness/etcha-harness/examples/hero-morph -- --host 127.0.0.1
```

Replace the absolute checkout path if using another machine. The example owns
its renderer, dependencies, character assets, and local contracts. Adoption does
not copy or install any of them. See [context boundaries](docs/context-layers.md)
and [3D evidence limits](docs/design-review.md#3d-reference-evidence).

The title-screen flow, saved inventory, combination discovery, and a broader
asset library remain later milestones. Review asset rights before reuse outside
this repository; no new redistribution license is granted by this example.

## Cloud setup and trust

The committed `copilot-setup-steps` workflow installs the same pinned tools and
runs self-tests. It must be on the **default branch** before a fresh cloud session
uses it. The Copilot hook also needs to be on that branch. Local Copilot CLI users
must trust the project folder.

Hooks execute repository-controlled commands after supported edits. Review the
manifest and native payload before trusting them. Etcha does not need credentials,
cloud services, or telemetry. Keep the firewall enabled and permit required
package, browser, and official release downloads.

A fresh cloud session and human baseline review cannot be proved by local
self-tests. Verify both after merge. Integrate Ideas in a separate task.

The workflow uses Ubuntu 22.04 with sandboxed Chromium. In this development
session, Ubuntu 24.04 host policy rejected the downloaded Chromium sandbox;
browser tests used the existing sandboxed system Chrome instead. No sandbox
control was disabled. Product checks default to the pinned Playwright browser;
they fail explicitly if its sandbox cannot start.
On that host, use `ETCHA_TEST_BROWSER_CHANNEL=chrome npm test` for the test suite.

## Upstream and licenses

Impeccable is by Paul Bakaus and is distributed under Apache-2.0. Its license is
included in `licenses/impeccable-LICENSE` and travels with adoption. Vendored
files retain their upstream notices. Etcha's own code is not licensed for public
redistribution yet; select a project license before publishing a release.
