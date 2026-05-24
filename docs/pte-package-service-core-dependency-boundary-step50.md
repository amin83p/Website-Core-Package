# PTE Service Core Dependency Boundary (Step 50)

## Summary

Step 50 adds a focused regression guard so package service modules in `packages/pte/MVC/services/pte` only
touch deep core paths from expected adapter/shim files.

## What Changed

- Added `test/pte-package-service-core-dependency-boundary-step50.test.js` which:
  - scans `packages/pte/MVC/services/pte/*.js`,
  - allows deep core imports only in:
    - `pteCoreDependencies.js`,
    - `pteCoreDependenciesCoreAdapter.js`,
    - `pteRouteCoreDependencies.js`,
  - allows legacy one-line service shim files that delegate to `../../../../../MVC/services/pte/*`,
  - fails for unauthorized deep-import usage in concrete package service implementations.

## Why

This continues the boundary-hardening chain after Step 49 and catches regressions before they become part of a larger package move.

## Acceptance Criteria

- Service-level files that implement PTE logic no longer import deep core files directly.
- Only designated adapter/shim files retain direct deep imports by design.
- Existing package behavior remains unchanged.
