# School Package Full Ownership Plan (Passes 26-32)

## Summary
- Objective: align School package architecture with the PTE package model.
- End state: School domain code is package-owned under `packages/school`, while core remains the shared runtime/framework provider.
- Scope: migrate remaining School `models/services/repositories` ownership, then prune redundant core School domain files in `Website-Core-Package`.
- Data path decision: keep runtime School data in app-level `data/school/*` for now.

## Current State Snapshot (2026-06-01)
- Routes/controllers/views are package-owned and implemented.
- Remaining core-bridged wrappers inside `packages/school`:
  - Models: `39`
  - Services: `40`
  - Repositories: `2`
- Core School domain folders still exist because these wrappers currently depend on them.

## Pass Breakdown

### Pass 26: Ownership Guardrails + Registry Baseline
- Add an explicit ownership registry used by parity tests.
- Move hardcoded owned-controller list out of test code and into registry file.
- Add pass metadata/doc updates so future passes update the same registry per migrated file.
- No runtime behavior change.

### Pass 27: Model Ownership Batch A
- Convert first model batch from wrapper delegates to package-owned implementations.
- Update registry for the newly owned model files.
- Keep shared generic framework calls through core contracts/utilities only.

### Pass 28: Model Ownership Batch B + Repository Ownership
- Convert remaining model wrappers.
- Convert repository wrappers to package-owned implementations.
- Update registry and parity assertions.

### Pass 29: Service Ownership Batch A
- Convert first service batch from wrappers to package-owned implementations.
- Rewire imports to package models/repositories where needed.
- Keep only shared non-domain core dependencies through `requireCoreModule(...)`.

### Pass 30: Service Ownership Batch B
- Convert remaining School services (including report/withdrawal/exam/class workflow services).
- Update ownership registry and parity tests.

### Pass 31: Core-School Domain Prune (Package Repo)
- Remove redundant core School domain files from `MVC/{models,services,repositories,controllers,routes,views}/school` in `Website-Core-Package`.
- Keep package runtime mount flow unchanged.
- Preserve non-domain core framework files.

### Pass 32: Certification + Installability Verification
- Run full targeted School package ownership/coupling/cutover suites.
- Verify package install/enable runtime path remains stable.
- Finalize package support metadata and pass docs.

## Test Strategy
- Per pass:
  - `node test/school-package-runtime-wrapper-parity-pass3.test.js`
  - `node test/school-package-controller-ownership-pass15.test.js`
  - `node test/school-package-ownership-pass7.test.js`
  - `node test/school-package-route-layer-pass2.test.js`
  - `node test/school-package-runtime-cutover-pass6.test.js`
  - `node test/school-package-certification-hardcoded-coupling.test.js`
  - `node test/package-route-service.test.js`
- Add focused tests per pass as needed for new ownership boundaries.

## Defaults and Constraints
- Migration style: phased cutover, small clean commits.
- Mirror to `Website-Core-Only` only when shared framework behavior changes.
- Keep unrelated pending runtime artifacts untouched unless explicitly requested.
