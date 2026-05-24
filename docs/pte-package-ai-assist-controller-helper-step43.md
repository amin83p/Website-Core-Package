# PTE AI Assist Controller Helper Boundary (Step 43)

## Summary

This step hardens the PTE AI Assist controller helper dependency path by moving
`pteCoreHelpersDependencies` to the same package-level core dependency adapter used by
other PTE package modules (`services/pte/pteCoreDependencies`).

## What Changed

- Updated `packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js`:
  - Removed direct imports from root core modules (`paginationHelper`, `generalTools`, `adminChekersService`, `idAdapter`).
  - Re-exported required helpers and services from `../services/pte/pteCoreDependencies`.
- Kept the public helper API in `packages/pte/MVC/controllers/pte/coreHelpers.js` unchanged.
- Added regression coverage in:
  - `test/pte-package-ai-assist-controller-helper-step43.test.js`

## Why

Controller helpers should not reach into deep core paths directly. The package-level adapter keeps boundary ownership consistent and centralizes any future core-utility swap without touching controller code.

## Acceptance Criteria

- PTE AI Assist controllers continue to import helper behavior through `./coreHelpers`.
- `pteCoreHelpersDependencies` no longer contains direct core utility/service paths.
- All helper APIs used by AI Assist controllers remain available (`paginate`, `buildDataServiceQuery`, `inferSearchableFields`, `isAjax`).
