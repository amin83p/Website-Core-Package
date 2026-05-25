# PTE Package Completion Roadmap (as of 2026-05-24)

This roadmap lists remaining passes to take `Website-Core-Package` from PTE logical package-prep to fully package-installed, package-owned runtime.

## What is already done

- Core package runtime foundation (manifest, registry, loader, navigation, query executors, files/assets services).
- Step 9: PTE logical package prep with manifest + activation script + package-owned `publicJoin` flow.
- Route loading/runtime order hardening (`packageLoaderService` + 404 placement).
- PTE package boundary hardening passes through:
  - controller, service, model, repository, middleware, route, and helper dependencies
  - route ownership and upload-context contracts
  - view asset/partials usage
  - runtime upload utility/middleware shims
  - focused regression suites for each layer.
- `packages/pte` now has dedicated manifest, scripts, route/controller/service/view/repository/model surfaces in place (current phase keeps files mirrored in core folders too).

## Remaining passes (to finish PTE package)

### Pass 1 - Finalize runtime route handoff (completed)
- ✅ PTE manifest `/pte` route declaration is now runtime-mounted (`metadataOnly: false`).
- Keep a safe transition plan for one or two deployments (duplicate /pte mount guard added to route entrypoint).
- Add/extend tests to guarantee package-loaded route works and `/pte` is not duplicated during transition.
- Update `packages/pte/package.manifest.json` route entries and install/activation assumptions accordingly.

### Pass 2 - Remove hardcoded `/pte` app mount
- ✅ Remove the hardcoded `app.use('/pte', ...)` from `app.js`.
- Keep package runtime mount as the source of truth for `/pte` while validating startup order remains correct.

### Pass 3 - Reduce remaining hardcoded core ties to PTE (completed)
- Move remaining PTE references out of core coupling points:
  - route mounts for domain-specific sections (already prepared; complete the migration for PTE)
  - menu/branding/menu entries
  - sections/symbols/accesses role registry seeds still driven directly from core constants
  - upload folder registrations still declared in core helpers
  - query executor bootstrap direct PTE hook points.
- Keep behavior unchanged by asserting regression tests around `/pte` pages, uploads, symbols/accesses visibility.
- Completed slice: PTE upload middleware categories now register through a package-owned upload category registration module instead of `coreFilesService` importing PTE upload path utilities directly.
- Completed slice: PTE Mongo index definitions now live in `packages/pte` and are merged into the core Mongo index startup pipeline through package manifest discovery.
- Completed slice: PTE system role seeds now come from `packages/pte/package.manifest.json` instead of core role/person fallback constants.
- Completed slice: PTE route/controller dependency boundaries now consume package-owned PTE access constants, and PTE activity-quota middleware keys are discovered from package quota declarations.

### Pass 4 - Package-local physical layout finalization
- Move remaining PTE-owned non-core assets/scripts/files from root/MVC locations into `packages/pte`:
  - shared script roots, data/bootstrap scripts, docs, and tests
  - any middleware/utils/repository/model/service/controller/view file groups still effectively root-owned.
- Keep `/uploads` and URL contracts unchanged.
- Update package manifests / import paths for moved files.
- Completed slice: PTE docs and tests now have package-local mirrors under `packages/pte/docs` and `packages/pte/test`, while root paths remain active compatibility locations.
- Completed slice: root top-level PTE controllers now delegate to package-owned controller implementations, leaving only dependency/core adapter files as intentional bridge points.
- Completed slice: root PTE AI Assist data/provider services and AI repositories now delegate to package-owned implementations.
- Completed slice: PTE question type and scoring rubric registries now live in `packages/pte`, with root service files reduced to compatibility shims.

### Pass 5 - Package install lifecycle completeness
- Extend install/uninstall behavior to support clean disable/remove for PTE-specific declarations (roles/sections/symbols/accesses/uploads if introduced dynamically).
- Add idempotent verification that re-running install is safe and no duplicates are introduced.

### Pass 6 - Final integration and verification
- Run the full package suite:
  - `package-*` tests
  - `pte-package-*` boundary tests
  - package-load/order/route smoke for `/pte` public and authenticated pages
  - regression on PTE AI Assist and upload context contracts.
- Refresh docs/handover notes with the final package state and any operational runbook change.

## Suggested sequence
- 1 -> 2 -> 3 -> 4 -> 5 -> 6.

## Stop conditions before final completion
- `/pte` works from package loader route mount only.
- No direct hardcoded PTE mount remains in `app.js`.
- Remaining PTE runtime ownership is in `packages/pte` (with explicit compatibility shims only where needed).
- Package enable/disable and re-install are deterministic and tested.
