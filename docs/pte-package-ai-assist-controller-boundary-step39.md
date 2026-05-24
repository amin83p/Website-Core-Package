# PTE AI Assist Controller Boundary (Step 39)

## Summary

During the previous step, controller-level AI Assist files were moved to package-owned implementations.
This step fixes a boundary import regression in those controllers where the helper dependency was
resolved via `./coreHelpers` instead of the package-local helper entrypoint at `./pte/coreHelpers`.

This mismatch causes module resolution failures when the AI Assist routes load.

## Files Changed

- `packages/pte/MVC/controllers/aiProviderController.js`
- `packages/pte/MVC/controllers/aiTokenUsageController.js`
- `test/pte-package-ai-assist-controller-boundary-step39.test.js`

## Why

Package-owned controllers should always consume package-owned helper modules so the code can remain
independent of absolute or deep core paths and match the shim architecture used by the rest of
the PTE package boundary work.

## Changes

- Changed helper import path in both AI Assist controllers:
  - `require('./coreHelpers')` → `require('./pte/coreHelpers')`
- Added boundary regression test to lock this import shape.

## Acceptance Criteria

- AI Assist route controllers load without missing-local-helper resolution errors.
- AI Assist controllers keep their boundary-local helper imports and do not fall back to a non-package
  helper path.
