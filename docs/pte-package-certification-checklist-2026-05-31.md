# PTE Package Certification Checklist (2026-05-31)

## Purpose
Define an auditable gate before using PTE as the reference template for School package extraction.

## Certification Criteria
1. No PTE-specific alias logic in core package runtime services. `PASS`
2. No route-time deep-import bridging hacks in core package runtime services. `PASS`
3. PTE manifest route/controller declarations use canonical package-local module paths. `PASS`
4. No deep core relative imports in package runtime files except one explicit core-contract boundary file. `PASS`
5. No duplicated root `MVC/views/pte` tree. `PASS`
6. No embedded PTE-only branching/constants left in core runtime surfaces that should be package-agnostic. `PASS`

## Guardrails
- Automated guard: `test/pte-package-certification-hardcoded-coupling.test.js`.
- Existing boundary suites remain in place and should continue passing.

## Verification Snapshot
- `node test/pte-package-certification-hardcoded-coupling.test.js`
- `node test/package-module-resolver-service.test.js`
- `node test/package-route-service.test.js`
- `node test/package-route-runtime-order.test.js`
- `node test/package-view-asset-service.test.js`
- `node test/package-loader-service.test.js`
- `node test/system-settings-package-manager-service.test.js`
- `node test/system-settings-package-manager-controller-view.test.js`
- `node test/system-settings-package-manager-route.contract.test.js`

## Expected Runtime Outcome
- PTE remains fully functional after startup and deploy restarts.
- Package install/load/enable/disable/remove flows remain deterministic.
- Package code references core services through one explicit contract boundary instead of scattered deep relative imports.
