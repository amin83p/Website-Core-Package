# PTE Package Model And Repository Shims (Step 20)

Step 20 adds package-local shims for the PTE data layer while keeping the live implementations in their current MVC locations.

## What Changed

- Added package-local model shims under `packages/pte/MVC/models/pte`.
- Added package-local repository shims under `packages/pte/MVC/repositories`.
- Mirrored all current files from `MVC/models/pte` and all flat `MVC/repositories/pte*.js` modules.
- Each package-local shim delegates to the current implementation in the root MVC tree.
- Added regression coverage so package model/repository shims stay aligned with the current PTE data layer.

## Compatibility Behavior

- Runtime PTE code still executes the current model and repository implementations.
- The hardcoded `/pte` mount remains active.
- The PTE manifest route remains `metadataOnly: true`.
- No schemas, data files, query behavior, or public URLs changed in this step.

## Why This Matters

The PTE service layer now has a future package-local data boundary available. When real service implementations move into `packages/pte`, their existing relative imports can be adjusted toward package-owned model and repository paths without mixing PTE data access back into the core root.

## Remaining Work

- Prepare package-local middleware and utility shims for PTE upload/context helpers.
- Prepare package-local view and public script ownership before moving controllers or routes for real.
- Keep repository implementations in place until JSON/Mongo parity and package data-root assumptions are explicitly checked.

