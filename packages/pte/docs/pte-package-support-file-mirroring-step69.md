# PTE Package Support File Mirroring - Step 69

## Summary
Pass 4 starts the package-local physical layout finalization for PTE support files by adding package-local mirrors for PTE documentation and tests.

The root `docs/` and `test/` files remain the active development and test-runner locations during this transition. Their package-local copies make the intended PTE package contents visible under `packages/pte` before the final package extraction pass removes or rewires compatibility paths.

## Changes
- PTE documentation rows in `packages/pte/package.support-files.json` now declare `targetStatus: "package-mirrored"`.
- PTE test rows in `packages/pte/package.support-files.json` now declare `targetStatus: "package-mirrored"`.
- Package-local documentation copies live under `packages/pte/docs`.
- Package-local test copies live under `packages/pte/test`.
- Script entrypoints remain unchanged in this slice because several scripts still use root-active runtime assumptions.

## Notes
- Do not run the copied tests from `packages/pte/test` yet; their imports still assume the repository root test location.
- Root scripts remain the source of truth unless a support-map row is already marked as `entrypointMode: "package-safe"`.
- Core-owned partials, middleware, upload storage, and shared services are intentionally referenced from core rather than copied into the package.

## Verification
- `node test/pte-package-support-files-step23.test.js`
- `node test/pte-package-script-entrypoints-step24.test.js`
- `node test/pte-package-support-file-mirroring-step69.test.js`
