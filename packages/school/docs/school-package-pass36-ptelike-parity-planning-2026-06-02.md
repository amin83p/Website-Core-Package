# School Package Pass 36: PTE-like Parity Planning (2026-06-02)

## Goal
Determine what remains before School can be considered comparable to the current PTE package readiness pattern.

## What is already aligned
- Runtime route mount is active (`/school` via `MVC/routes/schoolMainRoute.js`).
- School domain runtime ownership has been moved across controllers, services, repositories, and models into package files.
- Core-school duplicate runtime folders were pruned from root MVC surface.
- Support evidence and handoff docs are in place through Pass 35.

## PTE-style gaps observed
1. **Manifest surface depth**
   - `packages/school/package.manifest.json` currently has mostly empty enterprise surface sections (`roles`, `sections`, `symbols`, `accesses`, `uploadFolders`, `menuEntries`, etc.).
   - PTE manifest has broad role/menu/navigation/tooling declarations, enabling richer package autonomy.
2. **Package-level scripts/tests inventory**
   - `packages/school/package.support-files.json` has no script entries or package-local test entries.
   - PTE package has mapped maintenance/migration/seed scripts and extensive package-local mirrored tests.
3. **Package-local operational assets**
- no dedicated package script/test directories in school mirror versus PTE's script/test structure.

## Recommended next-step tasks (Pass 37)
1. Add/confirm package manifest product contract needed for School (roles/sections/symbols/access/menu/dashboard/upload if required by your product scope).
2. Add package support mappings for any school scripts/tests you expect to execute from package context.
3. Add a small route-configuration parity test set for school (if not already present under package-local harness).
4. Keep ownership runtime checks intact; only broaden package-level surface after manifest/script scope is finalized.

## Success signal for “PTE-like trajectory”
- School package remains runtime-stable after each expansion and still reports mount success with no auth middleware regressions.
- School support metadata reflects the same class of artifact types as PTE (even if not yet all of the same business features).
