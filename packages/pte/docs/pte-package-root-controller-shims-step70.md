# PTE Package Root Controller Shims - Step 70

## Summary
This Pass 4 slice makes the package-owned PTE controllers the active controller implementations. The legacy root controller files under `MVC/controllers/pte` now remain only as compatibility shims for older imports and focused tests that still require the root paths.

## Changes
- Converted top-level root PTE controller files to pure `module.exports = require(...)` shims that point at `packages/pte/MVC/controllers`.
- Kept controller dependency/core adapter files in `MVC/controllers/pte` unchanged because package controllers still intentionally consume them as core bridge modules.
- Added a regression test to verify every root PTE controller shim exports the matching package-owned controller.

## Notes
- This does not move or remove core-owned partials, middleware, upload storage, or shared services.
- The dependency adapter files remain temporary bridge points until the remaining package-local dependency cleanup is complete.
- Existing `/pte` route behavior is unchanged because routes already load package-owned controllers.

## Verification
- `node test/pte-package-controller-root-shims-step70.test.js`
- `node test/pte-package-controller-shims-step18.test.js`
- `node test/pte-package-controller-core-dependencies-step64.test.js`
