# PTE Package Route Tree Shims (Step 17)

Step 17 moves the route boundary forward without moving the real PTE route implementations yet.

## What Changed

- Added package-local route shim files under `packages/pte/MVC/routes`.
- Updated `packages/pte/MVC/routes/pteMainRoute.js` so it owns the top-level PTE route composition and requires package-local subroute shims.
- Each package-local subroute shim delegates to the current route module under `MVC/routes/pte`.

## Compatibility Behavior

- The hardcoded app mount still uses `MVC/routes/pte/pteMainRoute.js`.
- The PTE manifest route remains `metadataOnly: true`.
- Package route loading can resolve the package route entrypoint and package-local route tree, but it does not dynamically mount `/pte`.
- Public URLs and current PTE behavior remain unchanged.

## Remaining Work

- Move subroute implementations into `packages/pte/MVC/routes` after controller/service import boundaries are ready.
- Step 18 added package-owned controller shims. Add service shims next before moving route internals that import services directly.
- Keep the current route shims until the package route tree can run independently.
