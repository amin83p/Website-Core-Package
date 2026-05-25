# PTE Root Shim Retirement (Step 75)

## Summary
This pass retires the remaining root MVC PTE compatibility shims and finalizes package-owned runtime/module usage for PTE in `Website-Core-Package`.

## Commit Baseline
- Package Manager baseline checkpoint (Phase 0): `cf5788a`
- Shim retirement refactor slice: `87eebf3`
- Shim retirement test/boundary slice: `1624544`

## What Changed
- Removed root PTE shim trees and files:
  - `MVC/controllers/pte`
  - `MVC/services/pte`
  - `MVC/models/pte`
  - `MVC/routes/pte`
  - `MVC/repositories/pte*.js`
  - `MVC/middleware/pteUploadContextMiddleware.js`
  - `MVC/utils/pteUploadPathUtils.js`
- Added legacy resolver aliases in `packageModuleResolverService` for:
  - `MVC/controllers/pte/*` -> package controller path
  - `MVC/routes/pte/*` -> package route path
- Updated root PTE runtime tests to import package-owned modules directly.
- Replaced obsolete shim-era `pte-package-*` tests with retirement coverage:
  - new shim-retirement audit contract (`step75`) in root and package mirror.
- Updated `packages/pte/package.support-files.json` test mapping to match current root test inventory.
- Updated package helper core dependency adapter so it no longer relies on retired root helper shim paths.

## Compatibility Notes
- Legacy declaration tokens that still reference `MVC/controllers/pte/*` or `MVC/routes/pte/*` remain resolvable through resolver aliasing.
- No public URL/API changes were introduced.

## Verification Matrix
- Root foundation batch: `test/package-*.test.js` (green)
- Root package-boundary batch: `test/pte-package-*.test.js` (green)
- Package-local mirrored batch: `packages/pte/test/pte-package-*.test.js` (green)
- Critical runtime regression batch (green):
  - attempts: lifecycle controller/analytics/ledger timing
  - scoring: reading/writing/listening/speaking runtime scorer suites
  - picker: strict `pte_student` course picker filter
  - AI assist: prompt registry/autofill/settings service
- Runtime route manifest smoke target check:
  - `/pte`, `/pte/join`, `/pte/packages`, `/pte/dashboard` all declared in `packages/pte/package.manifest.json`

## Retirement Baseline
- Historical retired shim baseline count documented in tests: `117`.
