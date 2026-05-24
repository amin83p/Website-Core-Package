# PTE Upload Context Dependency Facade (Step 46)

## Summary

To keep middleware dependencies centralized before full package extraction, this step introduces a package-owned
upload-context dependency facade.

## What Changed

- Added `packages/pte/MVC/services/pte/pteUploadContextDependencies.js` exporting:
  - `pteAttemptLedgerService`
  - `pteUploadPathUtils`
- Updated `packages/pte/MVC/middleware/pteUploadContextMiddleware.js` to consume the adapter via:
  - `require('../services/pte/pteUploadContextDependencies')`
- Updated existing upload-boundary tests to validate facade usage:
  - `test/pte-package-ai-assist-upload-context-step33.test.js`
  - `test/pte-package-upload-middleware-step42.test.js`
- Added dedicated regression test:
  - `test/pte-package-upload-context-dependency-step46.test.js`

## Why

This keeps the middleware import surface package-owned and avoids scattered direct imports from multiple
underlying upload dependencies.

## Acceptance Criteria

- `pteUploadContextMiddleware` imports upload context dependencies through
  `pteUploadContextDependencies`.
- No direct import of `../services/pte/pteAttemptLedgerService` from the middleware.
- No direct import of `../utils/pteUploadPathUtils` from the middleware.
- Existing upload bucket behaviors remain unchanged (constants still sourced from `pteUploadPathUtils`).
