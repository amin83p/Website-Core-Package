# PTE Route Dependency Adapter Boundary (Step 44)

## Summary

This step continues boundary hardening by moving the route dependency aggregation behind a dedicated
package-local service adapter.

## What Changed

- Added package route dependency adapter:
  - `packages/pte/MVC/services/pte/pteRouteDependencies.js`
- Updated `packages/pte/MVC/routes/pteRouteDependencies.js` to re-export from the local adapter instead of
  importing `authMiddleware`, `accessMiddleware`, `actionStateMiddleware`, and access constants directly.
- Added regression coverage:
  - `test/pte-package-route-dependency-boundary-step44.test.js`

## Why

This keeps route-level middleware/constants access stable through a local boundary facade, matching the
pattern already used for PTE AI Assist service/controller helper dependencies.

## Acceptance Criteria

- `packages/pte/MVC/routes/pteRouteDependencies.js` contains only package-local dependency wiring.
- Route middleware imports in core route entry points (`pteMainRoute`, `aiAssistRoutes`) remain unchanged and continue using the local `pteRouteDependencies`.
- Added test verifies no direct deep-core route dependency imports are introduced at `routes/pteRouteDependencies.js`.
