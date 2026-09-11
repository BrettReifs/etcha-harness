# Review and approval

Group related findings. Keep the rule, affected surface, evidence, and next
action for each finding.

1. **Blocking failures:** Broken behavior, security or accessibility failures,
   missing required evidence, and unapproved visual changes.
2. **High-value corrections:** Important improvements that do not block safe work.
3. **Advisory observations:** Optional refinements.

Continue independent safe checks after a finding. Stop dependent checks if
their prerequisites failed. Report skipped checks and their reason.

## Visual approval

Store baseline images in the product repository. Keep candidate images separate.
Show before-and-after evidence for an intentional visual change. A human reviews
the images and approves the new baseline in a pull request. An agent must not
approve its own screenshots or impersonate the reviewer.

Use repository branch protection to require a human review of baseline changes.
Use product-owned CODEOWNERS rules for baselines and approval records where
available. A local file or digest cannot prove human identity.

Automated accessibility scans do not prove keyboard usability, focus visibility,
or design quality. Inspect browser evidence and complete the product's manual
checks. Record any untested browser, state, or assistive technology.
