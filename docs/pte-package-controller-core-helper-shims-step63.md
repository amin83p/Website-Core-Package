# PTE Controller Core Helper Shims (Step 63)

## Summary

To further align package ownership with an installable-core model, PTE package controller helper surfaces now delegate directly to core controller helpers where available.

## What Changed

- Added core helper runtime files:
  - `MVC/controllers/pte/coreHelpers.js`
  - `MVC/controllers/pte/pteCoreHelpersDependencies.js`
  - `MVC/controllers/pte/pteCoreHelpersCoreDependencies.js`
- Updated package controller helper shims:
  - `packages/pte/MVC/controllers/pte/coreHelpers.js`
    - now delegates to `../../../../MVC/controllers/pte/coreHelpers`
  - `packages/pte/MVC/controllers/pte/pteCoreHelpersCoreDependencies.js`
    - now delegates to `../../../../../MVC/controllers/pte/pteCoreHelpersCoreDependencies`
- Updated adapter test expectation in `test/pte-package-core-helper-adapter-step48.test.js` for the new delegation target.

## Why

This makes the package consume a stable core-owned helper implementation and keeps package helper wrappers thin and consistent with the boundary model used for middleware, repository, upload paths, and views.

## Acceptance Criteria

- Package controller helper shims contain delegation only and no local helper implementation logic.
- Core helper entry points exist in `MVC/controllers/pte`.
- Existing package helper behavior is unchanged (export surface remains the same).
- Adapter test for Step 48 validates the new delegation target.
