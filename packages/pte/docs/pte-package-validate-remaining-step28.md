# PTE Package Validate-Remaining Script (Step 28)

Step 28 converts the package-local `validate-remaining` maintenance script from a delegate wrapper into a package-safe entrypoint.

## What Changed

- Replaced `packages/pte/scripts/maintenance/validate-remaining.js` with a real package-local script copied from the core root script.
- Updated package-local root resolution to locate core repository paths from package context.
- Kept the script behavior and reporting format unchanged (`runs`, route permission checks, data sanity checks, optimization candidates).
- Added `entrypointMode: "package-safe"` to the mapped script row in `packages/pte/package.support-files.json`.

## Compatibility

- Root script `scripts/pte/validate-remaining.js` remains unchanged.
- This package-local script is now runnable from package context while sharing the same core data queries and Mongo logic.
