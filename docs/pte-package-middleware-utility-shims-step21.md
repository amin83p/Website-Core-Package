# PTE Package Middleware And Utility Ownership (Step 21 + 30)

Step 21 added package-local upload middleware and utility files.
Step 30 moved those upload files from plain delegate shims to package-owned implementations.

## What Changed

- `packages/pte/MVC/middleware/pteUploadContextMiddleware.js` now contains the local middleware implementation and
  uses package-local utilities.
- `packages/pte/MVC/utils/pteUploadPathUtils.js` now contains the local utility implementation and still
  resolves upload folders through core upload folder settings.
- Regression coverage in `test/pte-package-middleware-utility-shims-step21.test.js` now validates
  package ownership and behavior parity with core versions.

## Compatibility Behavior

- Upload folder keys, generated upload categories, and `/uploads/...` URLs remain unchanged.
- Runtime PTE routes still use the existing hardcoded MVC route tree, so external behavior is unaffected.
- The PTE manifest route remains `metadataOnly: true`.
- Storage internals remain in core services, preserving existing upload folder and permission behavior.

## Why This Matters

With package-owned upload middleware/utilities in place, package-boundary route/controller code can be moved
without introducing extra delegate layers for these storage-facing concerns.

## Remaining Work

- Continue converting other shared helper and adapter files (beyond upload helpers) to package-owned implementations.
- Keep route/controller ownership migration coordinated with route entrypoint and manifest activation sequencing.

