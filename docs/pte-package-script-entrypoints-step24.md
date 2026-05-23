# PTE Package Script Entrypoints (Step 24)

Step 24 adds package-local script entrypoints for the PTE support scripts mapped in Step 23.

## What Changed

- Added package-local script files under `packages/pte/scripts/seed`.
- Added package-local script files under `packages/pte/scripts/migration`.
- Added package-local script files under `packages/pte/scripts/maintenance`.
- Each package-local entrypoint delegates to the current root-active script.
- Updated `packages/pte/package.support-files.json` with Step 24 notes.
- Added regression coverage that verifies every mapped PTE script has a package-local entrypoint.

## Compatibility Behavior

- Existing root script paths remain active and unchanged.
- Package-local script files do not duplicate script logic yet.
- Running a package-local entrypoint executes the current root script, so existing root-relative behavior remains intact.
- No seed, migration, Mongo, or JSON data operation was executed as part of this step.

## Why This Matters

PTE now has package-owned command locations for seeders, migrations, maintenance tools, and package activation. The wrappers give us stable package paths before we adjust the real script internals for package-local imports and package-local fixtures.

## Remaining Work

- Step 25 converted the package-local PTE enable script into a package-safe implementation.
- Convert the remaining delegated scripts into package-safe implementations with explicit core dependencies.
- Add dry-run coverage for package-local scripts where possible before moving script logic.
- Keep destructive maintenance scripts delegated until their safety prompts and environment assumptions are reviewed.
