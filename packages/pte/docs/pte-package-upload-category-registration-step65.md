# PTE Package Upload Category Registration (Step 65)

## Summary

This pass removes the core file service's direct dependency on PTE upload path utilities.

## What Changed

- Added `MVC/services/uploadCategoryResolverService.js` as a core registry for package upload category resolvers.
- Updated `MVC/services/coreFilesService.js` so package-specific upload categories are resolved through the registry.
- Added `packages/pte/MVC/services/pte/pteUploadCategoryRegistration.js`.
- Updated `packages/pte/MVC/routes/pteMainRoute.js` to register PTE upload categories when the package route entrypoint is loaded.
- Extended PTE core dependency adapters so the package can consume the core registry through the established boundary.

## Why

The core framework should provide file and upload services, but it should not import package-specific upload helpers. PTE can still use the core file pipeline and legacy upload category names while owning the PTE-specific folder rules inside the package.

## Acceptance Criteria

- `coreFilesService` no longer imports `pteUploadPathUtils`.
- Legacy upload middleware categories continue to work:
  - `pte-question-bank`
  - `pte-students`
  - `pte-attempts`
- PTE route loading registers the package upload resolvers before upload middleware handles requests.
- Core and PTE package boundary tests cover the new registry behavior.
