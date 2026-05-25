# PTE Package Hard-Delete Attempts Script (Step 29)

Step 29 converts the package-local PTE hard-delete script from a delegate wrapper into a package-safe implementation.

## What Changed

- Replaced `packages/pte/scripts/maintenance/hard-delete-all-pte-attempts.js` with a package-local copy of the core deletion logic.
- Removed dependency on root script delegation and adjusted import paths to run from package context.
- Updated core config/repository imports to resolve through package-local relative paths.
- Updated `packages/pte/package.support-files.json` to:
  - add the step 29 doc and test entries,
  - mark this entrypoint as `entrypointMode: "package-safe"`.

## Compatibility

- Root script `scripts/pte/hard-delete-all-pte-attempts.js` remains unchanged and available.
- The package-local script runs in destructive mode only when `--apply` is passed; default mode remains dry-run with a report.
- Report output path is kept compatible with package/script execution and stores under `data/pte/hard-delete-all-pte-attempts.report.json` from repository root.

## Remaining Work

- Continue with the remaining non-validated MVC package-safe migration tasks (package-owned controller/service/view boundary ownership).
- Keep destructive operations behind explicit `--apply` and existing safety guard expectations.
