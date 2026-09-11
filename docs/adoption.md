# Adopt Etcha

Use an explicitly reviewed Etcha revision. Do not adopt a moving branch without
reviewing its diff. Run these commands from the harness checkout:

```sh
node scripts/adopt.mjs --target /absolute/path/to/product --dry-run
node scripts/adopt.mjs --target /absolute/path/to/product
npm ci --prefix /absolute/path/to/product/.etcha/harness
node /absolute/path/to/product/.etcha/harness/scripts/setup-engine.mjs --root /absolute/path/to/product
```

Install the browser from the copied tool package:

```sh
cd /absolute/path/to/product/.etcha/harness
npx --no-install playwright install --with-deps chromium
```

These are explicit dependency and browser downloads. Adoption itself does not
run commands, install packages, or download files.

## Files and conflicts

Adoption copies the native skill and hook, the small Etcha skill, shared
Impeccable settings, and a separate tool package under `.etcha/harness`.
It includes the upstream license and engine setup command.

It never edits `PRODUCT.md`, `DESIGN.md`, `AGENTS.md`, the product's package file,
or unrelated skills and hooks. Existing destination files are conflicts, even
if their bytes match. All conflicts are checked before writes.

The `.etcha/manifest.json` ownership record stores file hashes and modes.
Keep it with the integration. A second run with no changes makes no writes.
Executable launcher permissions are preserved and repaired when needed.

If the product already owns `.impeccable/config.json` or an Impeccable integration,
stop and review a migration. The adopter does not silently merge or overwrite
existing settings. Back up and reconcile them deliberately before adoption.
If a product edits an Etcha-owned file later, an update stops for review.

Commit the installed skills, hook, config, ownership record, and tool package.
Add these runtime paths to the product's existing `.gitignore` yourself:

```gitignore
.etcha/harness/node_modules/
.etcha/results/
.github/skills/impeccable/scripts/bin/
.impeccable/config.local.json
.impeccable/*.cache.json
```

Add any product-configured screenshot artifact paths too. Do not ignore approved
baseline images. Check `git status` before committing. Runtime caches are not
owned or removed by the adopter.

## Connect the product

1. Read the Etcha skill and existing product/design contracts.
2. Create a product-owned verification config using the [adapter contract](design-review.md).
3. Map the real production build, native detector, local server, states, and
   approved viewports. Fixture commands are not product checks.
4. Run `node /absolute/path/to/product/.etcha/harness/scripts/verify.mjs --config /absolute/path/to/product/etcha.verify.json`.
5. Configure human baseline review in the product's repository settings.
6. Merge the hook to the default branch and trust the local Copilot folder.

For product cloud sessions, merge the pinned setup steps into the product's
existing setup workflow. Point dependency installation at `.etcha/harness`.
Run its engine setup with the product root. Install its pinned Playwright
browser. Do not replace existing product setup steps. Etcha does not copy a
workflow or change repository settings during adoption.

## Update

In the harness repository:

1. Review upstream release notes, package advisories, and hook trust changes.
2. Pin approved package versions with the package manager and commit its lock.
3. Run `npx --no-install impeccable update --providers=github --scope=project --yes`.
   The upstream update endpoint selects the current signed skill release, not a
   skill version implied by the npm CLI version.
4. Review generated changes. Keep only the GitHub skill and native hook needed
   here. Do not commit runtime binaries, other provider folders, or extra agents.
5. Record the reviewed skill version with
   `node scripts/lock-impeccable.mjs --reviewed-skill VERSION`.
   This records review evidence; it is not a substitute for reviewing the diff.
6. Run engine setup, native checks, and tests. Review and commit the result.

In the product, run adoption's dry run from the new reviewed harness revision,
then adopt again. Only unchanged owned files may be updated or removed.
Reinstall locked dependencies, stage the matching engine, and rerun verification.
Review and renew hook trust if the definition changed.

The first installation used official signature verification. A temporary native
network failure cleared on retry; no unsigned bundle override was used.
Normal cloud setup uses committed skill bytes and locked npm engine packages,
not the moving skill download endpoint.

## Remove

```sh
node scripts/adopt.mjs --target /absolute/path/to/product --remove --dry-run
node scripts/adopt.mjs --target /absolute/path/to/product --remove
```

Removal deletes only unchanged owned files. It reports and retains edited files
and their ownership entries. It leaves unowned files, caches, baseline images,
and directories alone. Remove now-unused package caches, workflow steps,
verification config, and ignore entries only after product-owner review.

## Limits

Run adoption with exclusive access to the target worktree. Preflight prevents
known conflicts, not concurrent hostile file changes or power-loss rollback.
Review the ownership manifest like code. It is not a security boundary against
someone who can already edit the repository.
