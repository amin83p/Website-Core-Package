# BenchPath Package Extraction Plan

Date: 2026-06-04
Base commit: 0feaee3
Repository: Website-Core-Package

## Summary

BenchPath is currently a core-owned domain. The app mounts `/benchpath` directly in `app.js`, and BenchPath routes, controllers, models, repositories, services, views, scripts, tests, symbols, sections, and runtime data live in root-level folders. This plan moves BenchPath toward the same package structure used by PTE, School, and IELTS while keeping runtime data at app-level `data/benchpath`.

The migration is intentionally pass-based. Each pass should be small, test-backed, and committed before the next pass starts.

## Current Inventory

- Controllers: 9 files under `MVC/controllers/benchpath`.
- Routes: 17 files under `MVC/routes/benchpath`.
- Models: 7 files under `MVC/models/benchpath`.
- Repository: 1 module under `MVC/repositories/benchpath`.
- Services: 21 files under `MVC/services/benchpath`.
- Views: 26 files under `MVC/views/benchpath`.
- Scripts: 2 root migration/seed scripts plus 7 files under `scripts/benchpath`.
- Tests: 2 BenchPath-related root tests.
- Runtime data: app-level files under `data/benchpath/reference` and `data/benchpath/runtime`.
- Manifest declarations: 15 BenchPath sections and 15 BenchPath symbols are discoverable from root data.

## Fixed Rules

- Work starts in `Website-Core-Package` only.
- Core-only is not changed unless explicitly requested in a later operation.
- BenchPath follows the PTE/School/IELTS package structure.
- Runtime BenchPath data remains app-level under `data/benchpath`.
- `packages/benchpath/data` must not be created.
- Generated BenchPath reports and runtime task/reference payloads are selectable builder payloads, not package source files.
- Symbol artifacts referenced by BenchPath package declarations must resolve to `uploads/GLOBAL/symbols`, not organization-specific symbol tables.
- Root scripts/docs/tests may remain root-active while package-local mirrors are added.

## Target Package Interfaces

- `packages/benchpath/package.manifest.json` declares package id, mount path, route, views, assets, upload folders, sections, symbols, query executors, and data entities.
- `packages/benchpath/package.support-files.json` uses PTE-style support rows with `source`, `target`, `category`, `status`, and `targetStatus`.
- `packages/benchpath/MVC/services/benchpath/benchpathCoreModuleResolver.js` exposes `requireCoreModule()` and `resolveCoreRoot()`.
- Package-owned BenchPath code uses package-local imports for BenchPath files and resolver-based imports for shared core files.
- Package Builder live manifest mode supports BenchPath in addition to School, PTE, and IELTS.

## Passes

### Pass 0: Canonical Plan Doc

- Create this document.
- Record base commit, current inventory, runtime-data rule, symbol rule, test plan, and pass order.
- Verification: `git status --short`, doc review.

### Pass 1: Guardrails

- Add `test/benchpath-package-ownership-registry.json`.
- Add a BenchPath package guardrail test that asserts root-owned BenchPath inventory, app-level runtime data, no `packages/benchpath/data`, no package registry row before cutover, and current section/symbol counts.
- Verification: `node test/benchpath-package-ownership-registry-pass1.test.js`.

### Pass 2: Package Scaffold

- Create package folders for `MVC`, `docs`, `test`, `scripts`, and `public`.
- Add initial manifest, support map, README, package-local resolver, and package-safe activation script.
- Verification: syntax check the activation script and resolver; run scaffold tests.

### Pass 3: Routes And Views

- Mirror all root BenchPath routes into `packages/benchpath/MVC/routes`.
- Mirror all root BenchPath views into `packages/benchpath/MVC/views/benchpath`.
- Keep the root route active for this pass.
- Add tests proving package route files can load and view mirrors stay in parity.

### Pass 4: Controllers, Models, Services, And Repository

- Copy BenchPath controllers into `packages/benchpath/MVC/controllers/benchpath`.
- Copy BenchPath models into `packages/benchpath/MVC/models/benchpath`.
- Copy BenchPath services into `packages/benchpath/MVC/services/benchpath`.
- Copy the BenchPath repository into `packages/benchpath/MVC/repositories/benchpath`.
- Update package-owned imports to use package-local BenchPath modules where owned and the core resolver for shared dependencies.
- Replace package-local `../../../data/benchpath` assumptions with `resolveCoreRoot()` paths so runtime data stays app-level.
- Add syntax and ownership tests for the copied package surface.

### Pass 5: Manifest Declarations

- Seed manifest sections from BenchPath rows in `data/sections.json`.
- Seed manifest symbols from BenchPath rows in `data/symbols.json`.
- Declare data entities for `benchpathSources`, `benchpathSourceFragments`, CLB reference collections, and `benchpathTasks`.
- Declare upload folder `generated.benchpathReports` without bundling generated reports as package source.

### Pass 6: Builder, Symbols, And Support Files

- Add `benchpath` to Package Builder live manifest support in service and UI.
- Add tests proving live BenchPath manifest generation discovers BenchPath declarations and preserves template rows if backend discovery is empty.
- Verify BenchPath image symbol assets resolve under `/uploads/GLOBAL/symbols`.
- Add tests proving builder/export/import preserves GLOBAL symbol storage and does not copy BenchPath symbols to organization-specific symbol tables.
- Mirror docs, tests, seed scripts, migration scripts, and `scripts/benchpath` into package-local support folders and support metadata.

### Pass 7: Runtime Cutover

- Add/update `data/packageRegistry.json` so BenchPath is enabled in Core Package.
- Remove hardcoded `/benchpath` route mount from `app.js` after package route mount is tested.
- Add runtime cutover tests matching the existing package route-mount pattern.

### Pass 8: Build, Install, And Closeout

- Add BenchPath build/install ZIP script parity with PTE/School/IELTS through the shared build script.
- Verify signed ZIP contains `benchpath/package.manifest.json`, package code, support metadata, and selected builder payload only.
- Run package loader tests, package builder tests, BenchPath behavior tests, and an authenticated `/benchpath` smoke where practical.
- Update this document with completed evidence and commit the final clean pass.

## Test Plan

- Syntax: `node --check` on changed app, route, controller, service, model, repository, package-builder, activation, and build scripts.
- Existing BenchPath behavior: `node test/benchpath.payload-contract.step0.test.js` and `node test/benchpath.cross-entity-integrity.step7b.test.js`.
- Package structure: new BenchPath package scaffold, route, view, controller/model/service/repository ownership, manifest declaration, symbol artifact, support-file, runtime-cutover, and build/install tests.
- Package system: package loader, package route order, package builder service/view tests, package registry service tests, and signed ZIP script tests.
- Manual smoke: `/benchpath`, `/benchpath/tasks`, reference routes, tools/migration reports, Package Builder live manifest, Package Manager visibility, package install, and post-install route access.

## Assumptions

- BenchPath should follow the existing PTE/School/IELTS package pattern, not a new package architecture.
- App-level `data/benchpath` remains the runtime data location.
- BenchPath package source should not include generated reports or runtime data payloads.
- Package-local support files can begin as mirrors while root support files remain active.
- Each pass is committed separately after focused tests pass.

## Completion Evidence

- Runtime reconcile prerequisite committed separately: `0feaee3`.
- Pass 0/1 plan and guardrails committed: `b9d14ec`.
- Pass 2 package scaffold committed: `60bc1cc`.
- Pass 3 route/view mirrors committed: `2f32024`.
- Pass 4 package-owned domain surface committed: `710990a`.
- Pass 5 manifest catalog declarations committed: `d7e1f51`.
- Pass 6 Package Builder/support mirrors committed: `1da45ec`.
- Pass 7 runtime cutover committed: `a0e136d`.
- Pass 8 adds BenchPath signed ZIP coverage and this closeout evidence.
