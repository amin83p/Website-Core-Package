# PTE Package Mongo Validate Script (Step 27)

Step 27 converts the package-local PTE Mongo explain-validation script from a delegate wrapper into a package-safe implementation.

## What Changed

- Replaced `packages/pte/scripts/maintenance/mongo-validate-explain.js` with a real package-local copy of the core script logic.
- Updated package-local path resolution to the repository root from the package script location.
- Kept all runtime behavior aligned with the root script: same CLI contract, query explain analysis, and reporting output.
- Updated `packages/pte/package.support-files.json`:
  - added `docs/pte-package-mongo-validate-step27.md` target mapping,
  - added `test/pte-package-mongo-validate-step27.test.js` target mapping,
  - marked script entrypoint mode as `package-safe`.

## Compatibility

- Root script `scripts/pte/mongo-validate-explain.js` remains unchanged.
- Package-local script now runs independently from core code paths while sharing core services and models through repository imports.
- Non-destructive behavior remains unchanged.
