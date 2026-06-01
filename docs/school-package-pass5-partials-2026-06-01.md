# School Package Pass 5 Partial Includes + Shared Partial Mirror (2026-06-01)

## Outcome
- Mirrored shared view partials from core into:
  - `packages/school/MVC/views/partials/**`
- Normalized School package view includes to stable package-safe paths:
  - from relative traversal (`../partials/...`, `../../partials/...`)
  - to `partials/...`

## Why This Pass Matters
- Pass 4 mirrored School views only; those views still referenced partial paths that depended on root tree shape.
- This pass makes School package views self-sufficient for package-authoritative rendering and aligns with certified PTE include style.

## Guardrails Added
- `test/school-package-view-partials-pass5.test.js`
  - verifies required shared partials are present in package view root
  - fails if School package views use relative include traversal or direct root/package filesystem include paths
