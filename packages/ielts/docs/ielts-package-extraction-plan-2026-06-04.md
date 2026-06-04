# IELTS Package Extraction Plan

Date: 2026-06-04
Base commit: d266e1a
Repository: Website-Core-Package

## Summary

IELTS is currently a core-owned domain. The app mounts `/ielts` directly in `app.js`, and IELTS routes, controllers, models, services, views, data, scripts, and tests live in root-level folders. This plan moves IELTS toward the same package structure used by PTE and School while keeping runtime data at app-level `data/ielts`.

The migration is intentionally pass-based. Each pass should be small, test-backed, and committed before the next pass starts.

## Current Inventory

- Controllers: 4 files under `MVC/controllers/ielts`.
- Routes: 2 files under `MVC/routes/ielts`.
- Models: 7 files under `MVC/models/ielts`.
- Services: 28 files under `MVC/services/ielts`, including AI providers and scoring rules.
- Views: 30 files under `MVC/views/ielts`.
- Scripts: 8 files under `scripts/ielts`.
- Tests: 25 IELTS-related root tests.
- Runtime data: 134 files under `data/ielts`, about 215 MB total.
- Manifest declarations: 16 IELTS sections and 14 IELTS symbols are discoverable from root data.

## Fixed Rules

- Work starts in `Website-Core-Package` only.
- Core-only is not changed unless explicitly requested in a later operation.
- IELTS follows the PTE/School package structure.
- Runtime IELTS data remains app-level under `data/ielts`.
- The large `data/ielts/scoring/sessions` payload is not copied into `packages/ielts`.
- Symbol artifacts referenced by IELTS package declarations must resolve to `uploads/GLOBAL/symbols`, not organization-specific symbol tables.
- Root scripts/docs/tests may remain root-active while package-local mirrors are added.

## Target Package Interfaces

- `packages/ielts/package.manifest.json` declares package id, mount path, route, views, assets, sections, symbols, query executors, upload folders, and data entities.
- `packages/ielts/package.support-files.json` uses PTE-style support rows with `source`, `target`, `category`, `status`, and `targetStatus`.
- `packages/ielts/MVC/services/ielts/ieltsCoreModuleResolver.js` exposes `requireCoreModule()` and `resolveCoreRoot()`.
- Package-owned IELTS code uses package-local imports for IELTS files and resolver-based imports for shared core files.
- Package Builder live manifest mode supports IELTS in addition to School and PTE.

## Passes

### Pass 0: Canonical Plan Doc

- Create this document.
- Record base commit, current inventory, runtime-data rule, symbol rule, test plan, and pass order.
- Verification: `git status --short`, doc review.

### Pass 1: Inventory And Guardrails

- Add `test/ielts-package-ownership-registry.json`.
- Add an IELTS package guardrail test that asserts root-owned IELTS inventory, app-level runtime data, and no `packages/ielts/data`.
- Verification: `node test/ielts-package-ownership-registry-pass1.test.js`.

### Pass 2: Package Scaffold

- Create package folders for `MVC`, `docs`, `test`, `scripts`, and `public`.
- Add initial manifest, support map, README, package-local resolver, and package-safe activation script.
- Verification: syntax check the activation script and resolver; run scaffold tests.

### Pass 3: Route Surface

- Mirror `MVC/routes/ielts` into `packages/ielts/MVC/routes`.
- Keep root route active for this pass.
- Add tests proving package route files exist and can load with package-local dependencies.

### Pass 4: Views And View Resolution

- Mirror all root IELTS views into `packages/ielts/MVC/views/ielts`.
- Confirm manifest declares `packages/ielts/MVC/views` with namespace `ielts`.
- Add parity tests for view mirrors.

### Pass 5: Controllers

- Copy IELTS controllers into `packages/ielts/MVC/controllers/ielts`.
- Update package-owned controller imports to use package-local IELTS modules and core resolver for shared dependencies.
- Add syntax checks for copied controllers.

### Pass 6: Model Data-Root Safety

- Copy IELTS models into `packages/ielts/MVC/models/ielts`.
- Replace package-local `../../../data/ielts` assumptions with `resolveCoreRoot()` paths.
- Keep data writes pointed at app-level `data/ielts`.
- Add tests for package model ownership and data-root safety.

### Pass 7: Services And AI Providers

- Copy IELTS services, scoring rules, and AI provider services into `packages/ielts/MVC/services/ielts`.
- Bridge shared core utilities through `ieltsCoreModuleResolver`.
- Add syntax checks for large/high-risk package service files.

### Pass 8: Repository And Query Executors

- Copy the IELTS repository module into `packages/ielts/MVC/repositories/ielts`.
- Declare IELTS query executors through the package manifest.
- Include task samples, micro assessments, prompts, API providers, AI token usage, and scoring history.

### Pass 9: Manifest Declarations

- Seed manifest sections from IELTS rows in `data/sections.json`.
- Seed manifest symbols from IELTS rows in `data/symbols.json`.
- Add data entities from the migration catalog, including scoring history as a selectable payload table.

### Pass 10: Symbol Artifact Safety

- Verify IELTS symbol assets with file refs resolve under `/uploads/GLOBAL/symbols`.
- Add tests proving builder/export/import preserves GLOBAL symbol storage and does not copy IELTS symbols to organization-specific symbol tables.

### Pass 11: Package Builder Support

- Add `ielts` to Package Builder live manifest support in service and UI.
- Add tests proving live IELTS manifest generation discovers IELTS declarations and preserves template rows if backend discovery is empty.

### Pass 12: Runtime Cutover

- Remove hardcoded `/ielts` route mount from `app.js` after package route mount is tested.
- Add/update `data/packageRegistry.json` so IELTS is enabled in Core Package.
- Add runtime cutover tests matching the School package route-mount pattern.

### Pass 13: Support Files And Mirrors

- Mirror IELTS scripts, docs, and tests into package-local support folders.
- Keep support rows root-active and package-mirrored.
- Add support-file coverage tests.

### Pass 14: Root Shim Retirement

- Replace root IELTS MVC files with delegates only where compatibility requires root paths.
- Remove redundant root IELTS domain files only after package ownership tests prove safe.
- Keep shared core utilities in root.

### Pass 15: Build And Install Artifacts

- Add IELTS build/install ZIP script parity with PTE.
- Verify signed ZIP contains `ielts/package.manifest.json`, package code, support metadata, and selected builder payload only.

### Pass 16: Smoke And Closeout

- Run package loader tests, package builder tests, IELTS behavior tests, and authenticated `/ielts` smoke.
- Update this document with completion evidence and remaining risks.

## Test Plan

- `node --check` for changed app, route, controller, service, model, package-builder, activation, and build scripts.
- `node test/ielts-package-ownership-registry-pass1.test.js`
- `node test/ielts-package-route-layer-pass3.test.js`
- `node test/ielts-package-view-parity-pass4.test.js`
- `node test/ielts-package-model-ownership-pass6.test.js`
- `node test/ielts-package-service-ownership-pass7.test.js`
- `node test/ielts-package-query-executor-pass8.test.js`
- `node test/ielts-package-manifest-declarations-pass9.test.js`
- `node test/ielts-package-symbol-artifacts-pass10.test.js`
- `node test/system-settings-package-builder-service.test.js`
- `node test/system-settings-package-builder-controller-view.test.js`
- `node test/package-loader-service.test.js`
- `node test/package-route-service.test.js`
- All root IELTS behavior tests matching `test/ielts.*.test.js`.

## Manual Smoke

- Package Manager discovers IELTS package.
- Package Builder allows IELTS live manifest mode.
- IELTS build creates signed ZIP and SIG artifacts.
- IELTS install succeeds into a clean host.
- `/ielts`, `/ielts/scoring`, `/ielts/prompts`, `/ielts/api-providers`, and `/dashboard/section-nav/IELTS` load for an authenticated user.

