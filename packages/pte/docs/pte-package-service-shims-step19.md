# PTE Package Service Shims (Step 19)

Step 19 adds the package-local PTE service boundary without moving the real service implementations yet.

## What Changed

- Added package-local service shims under `packages/pte/MVC/services/pte`.
- Mirrored the current recursive `MVC/services/pte` tree, including nested AI provider adapters.
- Each package-local service shim delegates to the current implementation under `MVC/services/pte`.
- Added focused regression coverage so the package service tree stays aligned with the current PTE service tree.

## Compatibility Behavior

- The hardcoded `/pte` mount still uses `MVC/routes/pte/pteMainRoute.js`.
- The PTE manifest route remains `metadataOnly: true`.
- Runtime PTE behavior remains unchanged because current controllers still execute current service implementations.
- PTE service implementations are not physically moved in this step.

## Why This Matters

Controller implementations can later move into the package with a clear service boundary available inside `packages/pte`. This lets the physical move proceed gradually while preserving current service behavior and keeping core-owned dependencies outside the PTE package.

## Remaining Work

- Step 20 prepared PTE model and repository shims before moving real service implementations.
- Decide how shared AI providers should be represented long term: core/shared service boundary, explicit cross-package dependency, or package-owned adapter.
- Move service implementations only after their model, repository, storage, settings, and AI provider dependencies are mapped.
