# PTE Package Ensure Index Script (Step 26)

Step 26 converts the package-local PTE list-index maintenance script from a delegate wrapper into a package-safe implementation.

## What Changed

- Replaced `packages/pte/scripts/maintenance/ensure-pte-list-indexes.js` with a real implementation.
- The package-local script now:
  - Parses `--uri` and `--db` arguments.
  - Reads Mongo connection values from the same environment variables used by root scripts.
  - Calls core `ensureMongoIndexes` directly through `MVC/infrastructure/mongo/mongoIndexManager`.
  - Prints a focused summary for `pteApplicants`, `pteTeachers`, and `pteCourses`.
- Updated `packages/pte/package.support-files.json` to mark this entrypoint as `package-safe`.
- Added focused regression coverage in `test/pte-package-ensure-indexes-step26.test.js`.

## Compatibility Behavior

- Root script `scripts/pte/ensure-pte-list-indexes.js` remains available and unchanged.
- Package-local and root scripts both target the same underlying core index manager.
- No route/controller behavior changed in this step.

## Remaining Work

- Convert additional non-destructive validation/seed scripts into package-safe implementations.
- Keep destructive maintenance scripts delegated until safety prompts and environment assumptions are explicitly reviewed.
