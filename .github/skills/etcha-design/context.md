# Discover context

## Product adapter

- Detect and read an existing `PRODUCT.md` before calling `/impeccable init`.
- Preserve verified facts. Cite their source when a fact affects the task.
- Ask only about gaps that can change the result.
- Use `/impeccable init` to fill approved durable gaps, not to replace a contract.
- Keep temporary visual direction in the task brief.
- Mark unknown users, evidence, metrics, and claims as unknown. Never invent them.

## Design adapter

- Detect `DESIGN.md`, token files, approved components, and existing checks.
- Read the current contract first. Do not overwrite an established visual language.
- Use `/impeccable document` only if the contract is absent or its owner approves
  a refresh. Review the resulting diff.
- Map each relevant design rule to its source file and verification evidence.
- Record exceptions in the product contract with the rule, file scope, reason,
  review owner, and next review condition. Use the corresponding narrow native
  Impeccable ignore setting. Do not disable the detector as a substitute.
- If a check is unavailable, report the gap. Do not describe it as passing.

The adopting repository owns this mapping. Etcha does not store its product facts.
