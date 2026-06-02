# School Package Pass 38: Package Script Shims (2026-06-02)

## Goal
Move the package to a safer PTE-like operational posture by providing package-local script entrypoints for school maintenance/migration scripts.

## Implemented in this pass
- Added package-local script shims under:
  - `packages/school/scripts/maintenance/`
  - `packages/school/scripts/migration/`
- Each shim delegates to the corresponding root script to keep current behavior intact while making package-local invocation possible.

## Files added
- `packages/school/scripts/maintenance/enable-school-package.js`
- `packages/school/scripts/maintenance/insert-school-exam-symbols.mongosh.js`
- `packages/school/scripts/maintenance/insert-school-exam-sections.mongosh.js`
- `packages/school/scripts/maintenance/phase6UiChecklist.js`
- `packages/school/scripts/maintenance/insert-school-gradebook.mongosh.js`
- `packages/school/scripts/migration/migrate-school-role-tokens.js`
- `packages/school/scripts/migration/backfillClassEnrollmentPeriods.js`
- `packages/school/scripts/migration/migrateClassRegistrationMode.js`

## Why this pass
- School now has script surface parity groundwork (mirrors / delegates similar to PTE package style).
- No runtime functionality changes beyond script entrypoint convenience.

## Next pass suggestion
- Begin manifest surface expansion (`roles`, `sections`, `menuEntries`, `dashboardEntries`, and `uploadFolders`) only where product behavior requires it.
