# PTE Upload Utilities Core Bridge (Step 32)

## What Changed

- Adapted `packages/pte/MVC/utils/pteUploadPathUtils.js` to consume package-owned core dependencies instead of importing upload-folder internals directly.
- Added `coreFilesService` to `packages/pte/MVC/services/pte/pteCoreDependencies.js`.
- Kept external behavior unchanged:
  - question bank folder resolution
  - student folder root and student-item folder paths
  - attempt upload folder resolution
  - bucket normalization and token handling
- Added focused regression checks in:
  - `test/pte-package-upload-utils-step32.test.js`

## Why This Matters

This keeps package code using the core file facade path instead of directly depending on upload-folder settings internals. It also makes future upload-path refactors safer because only the facade adaptation needs update.

## Next Step

- Continue with remaining package-owned AI assist UI/service boundary hardening where needed.

