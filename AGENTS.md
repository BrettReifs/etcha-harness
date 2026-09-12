# Etcha

Etcha's first scope is a reusable design harness. The broader personal agent
system and C4 map are deferred.

Read `.github/skills/etcha-design/SKILL.md` before UI work. Product decisions
belong in the adopting repository, not in this harness.

Use the official Impeccable installer. Preserve its generated native payload.
Review changed hooks and dependencies before trusting an update.

Run `npm ci`, `npm test`, and `npm run check` for harness changes. Browser tests
require the pinned Playwright Chromium installation. Never approve new visual
baselines automatically. Do not add credentials, cloud services, or telemetry.
Do not enable optional hosted image generation during harness setup.

During cloud-agent recovery from an upstream image-download error, keep image
review separate from execution. Run tests and capture screenshots, but do not
open images or return image attachments to the model in that recovery session.
Read text reports instead. Preserve candidate evidence for human review and mark
visual review incomplete; this does not waive approval. Checkpoint secret-scanned
work before the handoff. See `docs/design-review.md` for the recovery procedure
and the separate-session image capability probe.
