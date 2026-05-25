# PTE Route Core Dependency Boundary (Step 52)

## Summary

Step 52 adds a focused regression guard for the package route layer, following the same boundary pattern used by controllers and services.

## What Changed

- Added `test/pte-package-route-core-dependency-boundary-step52.test.js` which:
  - scans `packages/pte/MVC/routes/*.js`,
  - enforces route files that contain deep core imports to remain pure one-line shims,
  - exempts `pteRouteDependencies.js` as the explicit route dependency adapter.

## Why

Route files are critical coupling points. This keeps package route ownership explicit and prevents accidental direct deep imports during iterative extraction.

## Acceptance Criteria

- Route shim files stay compatibility delegates to core route implementations.
- No non-adapter route implementation gains direct deep core imports.
- Existing route behavior remains unchanged.
