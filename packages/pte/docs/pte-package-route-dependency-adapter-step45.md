# PTE Route Dependency Core Adapter (Step 45)

## Summary

This step further hardens the route dependency boundary by splitting `pteRouteDependencies` into:

- `packages/pte/MVC/services/pte/pteRouteCoreDependencies.js` (core import adapter)
- `packages/pte/MVC/services/pte/pteRouteDependencies.js` (package adapter boundary)

## What Changed

- Added `pteRouteCoreDependencies.js` as the canonical bridge to:
  - `MVC/middleware/authMiddleware`
  - `MVC/middleware/accessMiddleware`
  - `MVC/middleware/actionStateMiddleware`
  - `config/accessConstants`
- Updated `pteRouteDependencies.js` to re-export from the local adapter file instead of importing core modules directly.
- Added regression coverage in:
  - `test/pte-package-route-dependency-core-adapter-step45.test.js`

## Why

This keeps the route dependency export surface package-owned and makes future middleware migration
or package-level interception predictable without touching multiple route files.

## Acceptance Criteria

- `packages/pte/MVC/services/pte/pteRouteDependencies.js` contains only the local adapter delegate.
- `packages/pte/MVC/services/pte/pteRouteCoreDependencies.js` owns the direct core imports.
- Existing route entry points continue to consume `./pteRouteDependencies`.
- Step 45 regression test confirms the boundary split and export behavior.
