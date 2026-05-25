# PTE Package Model/Repository Ownership - Step 74

## Summary
This Pass 4 completion slice makes the PTE model and repository layer package-owned. Root model and repository files remain as compatibility shims so legacy imports continue to work while runtime ownership moves into `packages/pte`.

## Changes
- Moved active PTE model implementations into `packages/pte/MVC/models/pte`.
- Moved active non-AI PTE repository implementations into `packages/pte/MVC/repositories`.
- Kept existing package-owned AI repositories active.
- Converted root `MVC/models/pte/*` files to package compatibility shims.
- Converted root non-AI `MVC/repositories/pte*.js` files to package compatibility shims.
- Added small package bridge modules for core model/repository utilities used by package-owned implementations.
- Preserved JSON data paths so package-owned models continue reading and writing the existing root `data/*.json` files.

## Notes
- This does not move large PTE data/service orchestration files yet; those can now depend on package-owned repositories through the root compatibility shims.
- Mongo collection names and JSON file names are unchanged.
- Existing root imports remain valid during the transition.

## Verification
- `node test/pte-package-model-repository-shims-step20.test.js`
- `node packages/pte/test/pte-package-model-repository-shims-step20.test.js`
- `node test/pte-package-model-core-dependency-boundary-step54.test.js`
- `node test/pte-package-repository-core-dependency-boundary-step53.test.js`
- `node test/pte-package-ai-service-root-shims-step71.test.js`
