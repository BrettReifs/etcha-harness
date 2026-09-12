# Visual approval

The product owns baseline images and their review history. The harness owns no
approved product screenshots.

1. Run verification to produce candidate screenshots.
2. Open the previous baseline and the candidate at each approved viewport.
3. Review intentional changes, focus states, content, and responsive behavior.
4. A human approves the change in a pull request before baseline replacement.
5. Keep the review link with the product's evidence.

The verifier must never update its own baselines. Missing or changed baselines
block completion. Passing screenshot comparison does not prove good design.

Repository administrators must require human review of baseline and approval
record changes. Add product-specific CODEOWNERS rules and branch protection.
Those GitHub settings cannot be installed by copying files. A local approval
record cannot authenticate its author and does not replace protected review.

Do not pass an approval gate by disabling accessibility checks, hiding content,
turning off browser security, or accepting snapshots in automation.
