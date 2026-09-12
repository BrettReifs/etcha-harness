---
name: etcha-design
description: Set a bounded UI brief, preserve product contracts, and verify design changes with Impeccable.
---

# Etcha design practice

Use this workflow before a UI edit. Use official Impeccable commands for design
work. Do not replace them with a second design system.

1. Read the product's `PRODUCT.md`, `DESIGN.md`, tokens, and relevant components.
2. Follow [context discovery](context.md). Ask only for material gaps.
3. Agree on the [bounded brief](brief.md). Set limits before generation.
4. Reuse approved components, patterns, tokens, and libraries.
5. Make the smallest change that meets the brief. Do not expand into a redesign.
6. Run the product's Etcha verification command. Keep evidence for every check.
7. Follow [review and approval](review.md). A clean scan does not approve a design.

Keep these five context layers separate:

| Layer | Owns |
| --- | --- |
| Universal | Semantic HTML, accessibility, keyboard parity, responsive behavior, hierarchy, feedback, verification |
| Personal | Plain English, reduction laws, reuse first, low-noise reporting |
| Tool | Native Impeccable commands, detectors, hooks, and browser workflow |
| Product | Users, evidence, constraints, visual language, tokens, components |
| Task | Surface, change boundary, temporary visual direction, acceptance criteria |

Product contracts govern visual choices. Do not impose a generic font, palette,
layout, or copy style over a product's approved identity. Record a narrow,
reviewed detector exception when an intentional product choice needs one.
Accessibility and security requirements still apply.

Use short sentences, concrete terms, active voice, and consistent names.
Quality comes before token savings. Do not omit checks to shorten a response.
Keep stable rules here, product facts in the product, and task details in the task.
