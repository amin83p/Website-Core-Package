# PTE Package Route Entrypoint Shim (Step 16)

Step 16 gives the PTE package its own route entrypoint without moving the full PTE route tree yet.

## What Changed

- Added `packages/pte/MVC/routes/pteMainRoute.js`.
- Updated the PTE manifest `USE /pte` route declaration to use package-root relative router path `MVC/routes/pteMainRoute.js`.
- The package entrypoint delegates to the existing core MVC route tree at `MVC/routes/pte/pteMainRoute.js`.

## Compatibility Behavior

- The hardcoded app mount still uses `MVC/routes/pte/pteMainRoute.js`.
- The PTE manifest route remains `metadataOnly: true`.
- Package route loading can now resolve the package-owned PTE route entrypoint, but it does not mount `/pte` dynamically.
- Public `/pte` URLs and PTE route behavior are unchanged.

## Remaining Work

- Move individual PTE route modules under `packages/pte/MVC/routes` in a later step.
- Add package-owned controller/service shims or move controllers/services together when route internals are relocated.
- Keep the hardcoded `/pte` mount until dynamic package mounting is tested as the active runtime path.

## Step 17 Follow-Up

Step 17 adds package-local route module shims for the PTE subroutes and updates the package entrypoint to require those package-local shims. Each subroute shim still delegates to the current `MVC/routes/pte/*` module until the physical route move happens.
