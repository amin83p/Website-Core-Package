# PTE Core Helper and Upload Utility Adapter Split (Step 48)

## Summary

This step keeps package-owned helper paths package-local by introducing explicit adapter files for two non-route boundary surfaces:

- `packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js`
- `packages/pte/MVC/utils/pteUploadPathUtils.js`

Both now consume local adapter modules instead of importing package-level core bundles directly.

## What Changed

- Added `packages/pte/MVC/controllers/pte/pteCoreHelpersCoreDependencies.js`
  - Re-exports: `paginate`, `buildDataServiceQuery`, `inferSearchableFields`, `isAjax`,
    `adminChekersService`, and `toPublicId` from `pteCoreDependencies`.
- Updated `packages/pte/MVC/controllers/pte/pteCoreHelpersDependencies.js`
  - Now delegates to `./pteCoreHelpersCoreDependencies` instead of direct `../services/pte/pteCoreDependencies` import.
- Added `packages/pte/MVC/utils/pteUploadPathCoreDependencies.js`
  - Exposes `coreFilesService` from `../services/pte/pteCoreDependencies`.
- Updated `packages/pte/MVC/utils/pteUploadPathUtils.js`
  - Now imports `coreFilesService` through `./pteUploadPathCoreDependencies`.
- Added `test/pte-package-core-helper-adapter-step48.test.js`
  - Guards helper utility dependency shape for both helper and upload-path surfaces.

## Why

This is a low-risk boundary cleanup step that keeps high-level package modules stable even if deeper core
imports are adjusted later.

## Acceptance Criteria

- `pteCoreHelpersDependencies` uses the dedicated helper core adapter.
- `pteUploadPathUtils` uses the upload-path core adapter and no longer imports `pteCoreDependencies` directly.
- Regression tests pass for the new adapter split behavior.
