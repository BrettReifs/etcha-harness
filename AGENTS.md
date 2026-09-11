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
