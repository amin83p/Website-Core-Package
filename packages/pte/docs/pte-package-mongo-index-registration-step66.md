# PTE Package Mongo Index Registration (Step 66)

## Summary

This pass moves PTE Mongo index definitions out of the core index definition object and into the PTE package.

## What Changed

- Added `MVC/infrastructure/mongo/packageMongoIndexRegistry.js`.
- Added `packages/pte/MVC/infrastructure/mongo/pteMongoIndexDefinitions.js`.
- Added `mongoIndexes` to the package manifest contract.
- Declared the PTE Mongo index module in `packages/pte/package.manifest.json`.
- Updated `MVC/infrastructure/mongo/mongoIndexManager.js` so default startup index definitions merge package-declared index modules discovered from package manifests.

## Why

Core should own the Mongo index initialization pipeline, but package-specific collection index definitions should live with their package. This keeps the startup behavior unchanged while reducing the amount of PTE-specific data hardcoded in core.

## Acceptance Criteria

- Core `INDEX_DEFINITIONS` no longer contains PTE collection keys.
- PTE index definitions are owned under `packages/pte`.
- Default `ensureMongoIndexes()` still includes PTE indexes by discovering the PTE manifest declaration.
- Package manifest validation accepts `mongoIndexes` declarations.
