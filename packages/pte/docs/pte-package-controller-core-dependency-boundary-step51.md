# PTE Controller Core Dependency Boundary (Step 51)

## Summary

Step 51 continues the package-boundary hardening sequence by adding a guard that ensures package controller shims are only direct bridge points to core and do not gain deep core imports inline.

## What Changed

- Added `test/pte-package-controller-core-dependency-boundary-step51.test.js` which:
  - scans `packages/pte/MVC/controllers/*.js`,
  - allows controller files that are pure one-line shims to core controllers, and
  - fails if a non-shim controller file contains deep core imports like:
    - `../../../../MVC/`
    - `../../../../../config/`

## Why

Controllers are another high-coupling surface during package extraction. This guard keeps package ownership clear while preserving current shim-based compatibility.

## Acceptance Criteria

- PTE package controller files remain compatibility shims or use package-local dependency adapters.
- No new deep core imports are added outside allowed adapter/safe shim patterns.
- Existing controller behavior is unchanged while moving closer to package portability.
