# PTE Package Controller Shims (Step 18)

Step 18 moves the PTE package boundary one layer deeper while keeping the live application unchanged.

## What Changed

- Added package-local controller shims under `packages/pte/MVC/controllers`.
- Updated `packages/pte/MVC/routes/pteMainRoute.js` so its top-level controller imports use package-local controller shims.
- Each package-local controller shim delegates to the current implementation under `MVC/controllers/pte`.

## Compatibility Behavior

- The hardcoded `/pte` mount still uses `MVC/routes/pte/pteMainRoute.js`.
- The PTE manifest route remains `metadataOnly: true`, so `/pte` is not dynamically mounted by the package loader yet.
- Public URLs and runtime PTE behavior remain unchanged.
- PTE controller implementations are not physically moved in this step.

## Why This Matters

The package route entrypoint can now resolve its own controller boundary from inside `packages/pte`. This keeps the future physical move smaller: route files can be moved or rewritten gradually while controller/service implementation ownership is prepared one layer at a time.

## Remaining Work

- Step 19 added package-local service shims for PTE service dependencies.
- Move package-local controller implementations only after service, model, repository, view, and asset dependencies are ready.
- Keep current compatibility shims until the package route tree can run independently from the hardcoded MVC PTE files.
