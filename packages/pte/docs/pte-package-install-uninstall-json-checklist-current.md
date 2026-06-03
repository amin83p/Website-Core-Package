# PTE Package Install/Uninstall Checklist (JSON Mode, Current State)

Date baseline: 2026-05-26  
Repository: `Website-Core-Package`  
Backend scope: `json` only  
Package scope: `packages/pte/package.manifest.json` current state

## Preconditions
- Runtime backend is JSON mode.
- System Settings Package Manager routes are reachable.
- Admin verification flow is available for protected actions.
- PTE manifest has:
  - `migrations: []`
  - `seeders: []`
  - populated declarations and upload folders.

## Scenario 1: Baseline Snapshot Before Install
Action:
- Open `GET /systemSettings/packages`.
- Confirm local manifest row for `pte`.
- Record whether `pte` is already installed.

Expected:
- Valid local manifest row exists for `pte`.
- Installed row either:
  - absent (fresh install path), or
  - present with current `version`, `enabled`, `manifestPath`.

Evidence:
- screenshot/json export of page payload.

## Scenario 2: Install PTE
Action:
- `POST /systemSettings/packages/install` with either:
  - `installMethod=local`, `localManifestPath=packages/pte/package.manifest.json`, `actionStateId=<token>`
  - or `installMethod=path`, `manifestPath=packages/pte/package.manifest.json`, `actionStateId=<token>`

Expected response:
- `status: "success"`
- `report.action: "install"` (or `"upgrade"` if already installed)
- `report.packageId: "pte"`
- `report.registry.enabled: true`
- `report.registry.installStatus: "enabled"`
- `report.declarationSummary` exists
- `report.dataSummary` exists with current PTE expectation:
  - `migrations.applied=0`, `migrations.skipped=0`, `migrations.failed=0`
  - `seeders.applied=0`, `seeders.skipped=0`, `seeders.failed=0`
- `report.appliedSteps: []`
- `report.skippedSteps: []`
- `report.failedStep: null`
- `report.rollbackApplied: false`
- `report.transactionId` non-empty

Post-check:
- Installed packages table shows `pte` enabled.
- Manifest path resolves to stored path form for `packages/pte/package.manifest.json`.

## Scenario 3: Upload-Folder Declaration Verification
Action:
- Open upload-folder settings UI and filter package `PTE` (or inspect resolved settings payload).

Expected:
- PTE keys exist, including:
  - `pte.questionBank`
  - `pte.students`
  - `pte.practiceAttempt`
  - `pte.mockExamAttempt`
  - `pte.packageAssets`
- Templates match manifest defaults.
- No physical file copy is expected from package install alone.

## Scenario 4: Uninstall Impact Preview (Clean State)
Action:
- `POST /systemSettings/packages/pte/uninstall-preview` with `actionStateId=<token>`.

Expected response:
- `status: "success"`
- `report.packageId: "pte"`
- Clean baseline expectation:
  - `report.blocked: false`
  - `report.modifiedRecords: []`
  - `report.blockedReasons: []`
- `report.previewTransactionId` non-empty
- `report.summaryByEntity` present (can be empty)
- `report.dataImpact` present (common current state):
  - `ownershipCount: 0`
  - `modifiedCount: 0`

## Scenario 5: Default Remove (Safe Keep-Data Mode)
Action:
- `POST /systemSettings/packages/pte/remove` (no `force=true`).

Expected response:
- `status: "success"`
- `report.action: "remove"`
- First run:
  - `report.registry.removed: true`
- `report.restartRecommended: true`
- `report.dataSummary` present (safe-mode skip semantics)
- `report.rollbackApplied: false`
- `report.failedStep: null`
- `report.blockedReasons` may exist as warnings, but default remove should not hard-fail.

Post-check:
- PTE no longer listed in installed package registry.
- PTE upload-folder assignments are cleared/removed by remove action.
- No migration/seeder business-data delete should occur in current manifest state.

## Scenario 6: Idempotent Remove
Action:
- Run remove again: `POST /systemSettings/packages/pte/remove`.

Expected:
- `status: "success"`
- `report.registry.removed: false`
- No crash; possible no-op warnings.

## Scenario 7: Reinstall After Remove
Action:
- Run install again (Scenario 2 payload).

Expected:
- Success response.
- Declarations recreated/reapplied per ownership/adopt rules.
- `dataSummary` remains all-zero applied counts for current manifest.

## Scenario 8: Force-Remove Gate Validation
Action A (negative):
- `POST /systemSettings/packages/pte/remove?force=true` with missing/invalid `previewTransactionId` and/or wrong `forceToken`.

Expected A:
- Structured error requiring valid force confirmation/token binding.

Action B (positive):
- Run preview and capture `previewTransactionId`.
- Call force remove with:
  - `previewTransactionId=<captured>`
  - `forceToken=REMOVE pte`

Expected B:
- Success response.
- Current manifest still has no destructive data steps to execute (no migration/seeder rollback scripts).
- Transaction history records force path.

## Scenario 9: Customization-Risk Preview Behavior
Setup:
- After install, modify one package-owned declaration record in JSON data (for example a section message/label).

Action:
- Run uninstall preview again.

Expected:
- `report.blocked: true`
- `report.modifiedRecords.length > 0`
- `report.blockedReasons` includes modified-since-install warning.
- UI risk modal offers:
  - `Remove (Keep Data)`
  - `Force Remove`

## Scenario 10: Transaction + Ledger Visibility
Action:
- `GET /systemSettings/packages/pte/transactions`
- `GET /systemSettings/packages/transactions/:transactionId`

Expected:
- Rows include install, preview, remove, and force remove (if executed).
- Phase/status progression is present (`preflight`, `apply`, `commit`, `rollback` where applicable).
- Report payload contains declaration summary and data lifecycle summary fields.

## Acceptance Criteria
- Protected routes are callable with valid auth + access + action-state + admin approval.
- Report shape consistently includes:
  - `dataSummary`, `appliedSteps`, `skippedSteps`, `failedStep`, `rollbackApplied`, `dataImpact`
- Current PTE manifest performs no migration/seeder step execution while declaration lifecycle works.
- Default remove remains non-destructive for business data.
- Force remove remains gated and auditable.

## Evidence Table (Fill During Test Run)
| Scenario | Request/Action | Result | Evidence Path |
|---|---|---|---|
| 1 | Baseline snapshot | PASS/FAIL |  |
| 2 | Install | PASS/FAIL |  |
| 3 | Upload folders verify | PASS/FAIL |  |
| 4 | Uninstall preview clean | PASS/FAIL |  |
| 5 | Default remove safe mode | PASS/FAIL |  |
| 6 | Remove idempotency | PASS/FAIL |  |
| 7 | Reinstall | PASS/FAIL |  |
| 8A | Force remove negative gate | PASS/FAIL |  |
| 8B | Force remove positive | PASS/FAIL |  |
| 9 | Drift preview blocking | PASS/FAIL |  |
| 10 | Transactions visibility | PASS/FAIL |  |

