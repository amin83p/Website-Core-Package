# PTE Package Core Runtime Shims (Step 62)

## Summary

To reduce duplication and reinforce package installation behavior, PTE package upload boundary helpers now defer directly to core-framework implementations.

## What Changed

- `packages/pte/MVC/middleware/pteUploadContextMiddleware.js`
  - now re-exports the core middleware from:
    - `../../../../MVC/middleware/pteUploadContextMiddleware`

- `packages/pte/MVC/utils/pteUploadPathUtils.js`
  - now re-exports the core utility from:
    - `../../../../MVC/utils/pteUploadPathUtils`

## Why

Packages should not own copies of framework-shared middleware/utilities. Delegating to core runtime keeps behavior centralized and makes future framework-side changes flow into the package automatically.

## Test Updates

Updated boundary tests to reflect this delegation model:

- `test/pte-package-ai-assist-upload-context-step33.test.js`
- `test/pte-package-upload-context-dependency-step46.test.js`
- `test/pte-package-upload-middleware-step42.test.js`
- `test/pte-package-core-helper-adapter-step48.test.js`
- `test/pte-package-upload-utils-step32.test.js`
- `test/pte-package-middleware-utility-shims-step21.test.js`
- `test/pte-package-middleware-boundary-step47.test.js`

## Acceptance Criteria

- Package upload middleware and utility files no longer contain duplicated upload context/path logic.
- Runtime behavior remains aligned with core middleware/utility behavior.
- Upload-related boundary tests pass after the shim updates.
