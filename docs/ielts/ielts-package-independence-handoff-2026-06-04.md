# IELTS Package Independence Handoff

Date: 2026-06-04
Repo: `Website-Core-Package`
Branch at handoff creation: `main`
Base commit before this doc commit: `ef5a355`

## Purpose

This handoff records the next IELTS package cleanup so it can be continued without guessing. IELTS has already been extracted into `packages/ielts`, but root `MVC/*/ielts` files still exist as compatibility shims. The next implementation should remove that outside package dependency and make the IELTS package rely on `packages/ielts/MVC` for domain code.

The implementation should be a separate code commit after this documentation commit.

## Current State

- `packages/ielts/package.manifest.json` exists and declares:
  - `id: "ielts"`
  - `mountPath: "/ielts"`
  - route: `MVC/routes/ieltsMainRoute.js`
  - view root: `packages/ielts/MVC/views`
  - query executors pointing at `packages/ielts/MVC/repositories/ielts/index.js`
- `data/packageRegistry.json` has an enabled IELTS row:
  - `id: "ielts"`
  - `version: "0.1.0"`
  - `enabled: true`
  - `installStatus: "enabled"`
- `app.js` uses the package runtime router and package loader. There is no direct hardcoded `/ielts` route mount to preserve.
- Package-owned IELTS controllers, routes, models, services, repositories, and views exist under `packages/ielts/MVC`.
- Package-owned IELTS models use `resolveCoreRoot()` for app-level runtime data.
- Runtime data remains under `data/ielts`; there must be no `packages/ielts/data`.
- Root IELTS MVC folders still exist as shim/delegate files:
  - `MVC/controllers/ielts`
  - `MVC/models/ielts`
  - `MVC/repositories/ielts`
  - `MVC/routes/ielts`
  - `MVC/services/ielts`
  - `MVC/views/ielts`
- Many root IELTS behavior tests still import `../MVC/.../ielts`, which currently works only because the root shim files exist.
- Root IELTS script helpers still import root IELTS service paths:
  - `scripts/ielts/scoringBaselineGuardCheck.js`
  - `scripts/ielts/scoringPatchImpactReport.js`
- Package IELTS views currently include core partials with root-style relative paths such as `../partials/tablePages-start`. After root IELTS views are removed, package views must use core view-root includes such as `partials/tablePages-start`.
- `MVC/services/packageQueryExecutorService.js` still has an IELTS built-in fallback pointing at `../repositories/ielts`. The manifest path is already package-owned, but the fallback must be safe after root repositories are removed.

## Goal

Make IELTS structurally match the package-owned destination pattern:

- IELTS domain code lives under `packages/ielts/MVC`.
- Root `MVC/*/ielts` domain folders are removed.
- Tests and scripts use package-owned IELTS modules directly.
- Package views render without relying on root IELTS view mirrors.
- Runtime data remains app-level under `data/ielts`.
- Package manager, package loader, package builder, and query executor flows continue to work.

## Non-Goals

- Do not move `data/ielts` into `packages/ielts`.
- Do not remove root IELTS docs, root IELTS tests, or root IELTS scripts just because they are support files.
- Do not change IELTS scoring behavior unless a test proves the current package-owned implementation needs a compatibility fix.
- Do not modify `Website-Core-Only` during this implementation unless explicitly requested later.

## Implementation Steps

### 1. Fix Package EJS Partial Includes

Update package IELTS views under `packages/ielts/MVC/views/ielts` so core partial includes are resolved from the app view root.

Replace patterns like:

```ejs
<%- include('../partials/tablePages-start', {
<%- include('../partials/modal') %>
<%- include('../partials/dashboard/unifiedDashboard', {
```

with:

```ejs
<%- include('partials/tablePages-start', {
<%- include('partials/modal') %>
<%- include('partials/dashboard/unifiedDashboard', {
```

Use the BenchPath lesson here: package views should not depend on a package-local partial bridge or a root IELTS view mirror.

Update `test/ielts-package-view-parity-pass4.test.js` from "package views match root views exactly" to package independence assertions:

- `packages/ielts/MVC/views/ielts` contains the expected 30 IELTS views.
- No package IELTS view contains `../partials`.
- Representative package views can render through Express/app view roots without missing partial errors.
- Manifest still declares `views.path = "packages/ielts/MVC/views"` and `views.namespace = "ielts"`.

Recommended representative render checks:

- `ielts/apiProviderList`
- `ielts/microAssessments`
- `ielts/scoringHistory`
- `ielts/dashboard`

### 2. Update Tests And Scripts To Import Package IELTS Modules

Update root tests that currently import root IELTS shims:

```js
require('../MVC/services/ielts/...')
require('../MVC/models/ielts/...')
require('../MVC/repositories/ielts')
```

to package-owned imports:

```js
require('../packages/ielts/MVC/services/ielts/...')
require('../packages/ielts/MVC/models/ielts/...')
require('../packages/ielts/MVC/repositories/ielts')
```

Do the same for package-local mirrored tests under `packages/ielts/test` where imports still point to `../MVC/...` and are expected to be runnable from the package mirror.

Update root IELTS script helpers:

```js
scripts/ielts/scoringBaselineGuardCheck.js
scripts/ielts/scoringPatchImpactReport.js
```

to import package-owned services. Keep their CLI behavior unchanged.

Also update mirrored package scripts if they are intended to stay runnable from `packages/ielts/scripts/ielts`.

### 3. Make Query Executor Fallback Package-Aware

Update `MVC/services/packageQueryExecutorService.js` so IELTS no longer has a fallback dependency on root repositories.

Change the IELTS built-in repository module fallback from:

```js
ielts: '../repositories/ielts'
```

to a package-owned path equivalent to:

```js
ielts: '../../packages/ielts/MVC/repositories/ielts'
```

Keep manifest-declared `modulePath` precedence unchanged.

Bring `BUILTIN_QUERY_EXECUTOR_DECLARATIONS.ielts` in line with the manifest where needed, including:

- `ielts.task2samples`
- `ielts.microassessments`
- `ielts.prompts`
- `ielts.apiproviders`
- `ielts.aitokenusages`
- `ielts.scoringhistory`

Add or update a focused test proving the IELTS fallback does not require `MVC/repositories/ielts` after root MVC retirement.

### 4. Delete Root IELTS MVC Folders

After steps 1-3 pass, remove the root IELTS MVC domain folders:

```text
MVC/controllers/ielts
MVC/models/ielts
MVC/repositories/ielts
MVC/routes/ielts
MVC/services/ielts
MVC/views/ielts
```

Do not delete:

```text
data/ielts
packages/ielts
docs/ielts
test/ielts*.test.js
scripts/ielts
```

Update `test/ielts-package-root-shim-retirement-pass14.test.js` so it asserts root IELTS MVC folders are absent, not delegated.

Required assertions:

- Root MVC IELTS folders listed above do not exist.
- `packages/ielts/MVC` folders do exist.
- `data/ielts` exists.
- `packages/ielts/data` does not exist.

### 5. Refresh Metadata And Closeout Docs

Update the IELTS package extraction doc to record the true closeout state:

```text
docs/ielts/ielts-package-extraction-plan-2026-06-04.md
```

Record:

- root IELTS MVC shims fully removed;
- package views switched to core view-root partial includes;
- tests/scripts now import package-owned IELTS modules;
- runtime data still app-level;
- manual smoke remains pending or completed, depending on what was run.

Keep `packages/ielts/package.support-files.json` root-active support rows unless support files are intentionally made package-owned/runnable in the same pass.

### 6. Commit The Implementation Separately

After verification, commit the code cleanup with:

```text
refactor(ielts): remove root mvc package dependency
```

This should be separate from this handoff doc commit.

## Verification Commands

Run these after implementing the cleanup.

Syntax checks:

```powershell
node --check MVC/services/packageQueryExecutorService.js
node --check packages/ielts/MVC/routes/ieltsMainRoute.js
node --check packages/ielts/MVC/routes/ieltsRoutes.js
node --check scripts/ielts/scoringBaselineGuardCheck.js
node --check scripts/ielts/scoringPatchImpactReport.js
```

Focused package tests:

```powershell
node test/ielts-package-route-layer-pass3.test.js
node test/ielts-package-view-parity-pass4.test.js
node test/ielts-package-controller-ownership-pass5.test.js
node test/ielts-package-model-ownership-pass6.test.js
node test/ielts-package-service-ownership-pass7.test.js
node test/ielts-package-query-executor-pass8.test.js
node test/ielts-package-runtime-cutover-pass12.test.js
node test/ielts-package-root-shim-retirement-pass14.test.js
node test/ielts-package-support-files-pass13.test.js
```

Behavior checks:

```powershell
node test/school-ielts.step6.test.js
```

Full IELTS sweep:

```powershell
$failures = @()
Get-ChildItem test -Filter "ielts*.test.js" | Sort-Object Name | ForEach-Object {
  Write-Host "Running $($_.Name)"
  node $_.FullName
  if ($LASTEXITCODE -ne 0) { $failures += $_.Name }
}
if ($failures.Count) {
  Write-Host "Failed IELTS tests:"
  $failures | ForEach-Object { Write-Host " - $_" }
  exit 1
}
Write-Host "All IELTS tests passed."
```

Static dependency scan:

```powershell
rg "MVC/(controllers|routes|services|models|repositories|views)/ielts|MVC\\(controllers|routes|services|models|repositories|views)\\ielts" app.js MVC packages test scripts -g "*.js" -g "*.json" -g "*.ejs"
```

Expected remaining hits after cleanup:

- historical doc strings may remain;
- package files may contain comments with old path names;
- no active `require(...)` should target root `MVC/*/ielts`.

Manual smoke:

- `/ielts`
- `/ielts/scoring`
- `/ielts/prompts`
- `/ielts/api-providers`
- `/dashboard/section-nav/IELTS`
- Package Manager shows IELTS as installed/enabled.
- Package Builder still offers IELTS live manifest mode.

## Acceptance Criteria

- Root `MVC/*/ielts` folders are gone.
- IELTS package pages render from `packages/ielts/MVC/views/ielts`.
- No package IELTS view includes `../partials`.
- Root behavior tests do not rely on root IELTS MVC shims.
- Query executor fallback works without `MVC/repositories/ielts`.
- `data/ielts` remains app-level.
- `packages/ielts/data` remains absent.
- Focused IELTS package tests and full IELTS behavior sweep pass.
- Implementation commit is clean and separate from this doc commit.

## Risk Notes

- The highest risk is view rendering. Fix partial includes before deleting root views.
- The next highest risk is stale root test imports. If root MVC folders are deleted before test imports are updated, the test suite will fail loudly.
- `packageQueryExecutorService.js` is a shared core service. Keep its change narrow: only make the IELTS fallback package-owned and preserve manifest-declared module paths as the primary source.
- Do not use root shim files as the new target. The goal is to remove them.
- Do not move large scoring session data into package source.

## Handoff Checklist

Before starting implementation at home:

- Confirm worktree is clean with `git status --short`.
- Confirm you are in `Website-Core-Package`, not `Website-Core-Only`.
- Pull latest commits.
- Start from this handoff doc and implement the steps in order.
- Commit only after the verification commands pass or after noting any skipped command in the commit summary.
