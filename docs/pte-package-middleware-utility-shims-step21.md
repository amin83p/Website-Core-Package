# PTE Package Middleware And Utility Shims (Step 21)

Step 21 adds package-local shims for the PTE upload middleware and utility boundary while preserving current storage behavior.

## What Changed

- Added `packages/pte/MVC/middleware/pteUploadContextMiddleware.js`.
- Added `packages/pte/MVC/utils/pteUploadPathUtils.js`.
- Both shims delegate to the current root MVC implementations.
- Added regression coverage for the package-local middleware and utility boundary.

## Compatibility Behavior

- Upload folder keys, generated upload categories, and `/uploads/...` URLs remain unchanged.
- Runtime PTE routes still use the current hardcoded MVC route tree.
- The PTE manifest route remains `metadataOnly: true`.
- `coreFilesService`, upload folder settings, and storage gateway behavior remain core-owned.

## Why This Matters

PTE route and controller implementations depend on these helpers for upload context and folder resolution. With package-local shims in place, future moved route/controller code can resolve PTE-owned upload helpers from inside the package while the actual storage logic continues to live in the current framework boundary.

## Remaining Work

- Prepare package-local view/public asset ownership for PTE-specific files.
- Map PTE scripts, docs, and package-local tests before moving real implementations.
- Keep storage internals in core and continue consuming them through `coreFilesService` and upload folder settings.

