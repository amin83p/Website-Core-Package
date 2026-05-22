# Handover Report — 2026-05-22 — PTE Package Step 9

## Copy This Into Codex Tomorrow

Continue work in:

```text
C:\Users\KATANA\Desktop\myWebsite\Website-Core-Package
```

Do not continue this package-ready work in:

```text
C:\Users\KATANA\Desktop\myWebsite\Website-Node-Express-Core
```

## Current Goal

The project is being converted into a package-ready core framework. The core should provide common services such as users, persons, organizations, roles, accesses, sections, symbols, login/session state, action state, activity quota, and core file/upload handling. Domain modules such as PTE, School, IELTS, BenchPath, and others should gradually become packages that can be installed on top of the core.

Step 9 focused on making PTE logically package-ready without moving the physical files yet.

## Step 9 Completed

PTE is still physically located in the existing MVC folders, and all existing `/pte` URLs are preserved.

Completed changes:

- Expanded `packages/pte/package.manifest.json` from a sample manifest into real PTE compatibility declarations.
- Added metadata-only PTE route declarations to the manifest.
- Added real PTE roles, sections, symbols, access profile, upload folders, public menu entries, and dashboard entries to the manifest.
- Kept `queryExecutors` empty because no existing PTE generic data query hook was discovered for this step.
- Added safe package activation script:
  - `scripts/packages/enable-pte-package.js`
  - default mode is dry-run
  - `--apply` upserts PTE into the package registry as enabled
- Moved `/pte/join` ownership out of the core person controller:
  - `MVC/controllers/pte/publicJoinController.js`
  - `MVC/services/pte/ptePublicJoinService.js`
- Extracted reusable public person/user registration logic into:
  - `MVC/services/person/publicRegistrationService.js`
- Updated:
  - `MVC/routes/pte/pteMainRoute.js`
  - `/pte/join` now uses the PTE public join controller
- Kept generic `/persons/join` in:
  - `MVC/controllers/personController.js`
  - now backed by `publicRegistrationService`
- Added focused regression tests:
  - `test/pte-package-step9.test.js`
- Added Step 9 documentation:
  - `docs/pte-preparation-step9.md`

## Important Behavior Preserved

- `/pte`
- `/pte/test-info`
- `/pte/join`
- `/pte/packages`
- `/pte/dashboard`
- existing PTE subroutes

Public join behavior preserved:

- Guest users can create a PTE public account.
- Guest PTE join still creates a person, user, and public applicant.
- Logged-in users can join public PTE using the same account.
- Existing users receive or keep the `pte_student_public` role.
- Users who already have the role get the related already-joined message/flow.

File/upload behavior preserved:

- Existing upload middleware signatures remain unchanged.
- Existing physical upload paths remain unchanged.
- Existing `/uploads/...` URLs remain unchanged.

## Files Changed For Step 9

Core/person shared registration:

```text
MVC/services/person/publicRegistrationService.js
MVC/controllers/personController.js
```

PTE join ownership:

```text
MVC/controllers/pte/publicJoinController.js
MVC/services/pte/ptePublicJoinService.js
MVC/routes/pte/pteMainRoute.js
```

Package declaration and activation:

```text
packages/pte/package.manifest.json
scripts/packages/enable-pte-package.js
```

Docs and tests:

```text
docs/pte-preparation-step9.md
test/pte-package-step9.test.js
```

## Current Git Status Warning

Before committing, check:

```bash
git status --short
```

At the end of Step 9, these runtime files may be dirty due to local app/session activity:

```text
data/actionStates.json
data/logs.json
data/sessions.json
```

These are not part of the Step 9 implementation. Do not commit them unless you intentionally want runtime state/log/session changes in the commit.

The implementation commit should include the Step 9 source/docs/test files listed above.

## Suggested Commit Message

```text
Prepare PTE for package activation

- expand the PTE package manifest with real compatibility declarations
- add a dry-run-first PTE package activation script
- move PTE public join handling into PTE-owned controller/service files
- extract shared public person/user registration helpers into a core person service
- keep existing /pte URLs and generic /persons/join behavior unchanged
- add Step 9 handover docs and focused package-readiness tests
```

## Verification Already Run

Syntax checks passed for:

```bash
node --check app.js
node --check MVC/routes/pte/pteMainRoute.js
node --check MVC/controllers/pte/publicJoinController.js
node --check MVC/services/pte/ptePublicJoinService.js
node --check MVC/services/person/publicRegistrationService.js
node --check scripts/packages/enable-pte-package.js
```

Focused Step 9 test passed:

```bash
node test/pte-package-step9.test.js
```

Package/core regression tests passed:

```bash
node test/package-manifest-service.test.js
node test/package-loader-service.test.js
node test/package-navigation-service.test.js
node test/package-registry-installer-service.test.js
node test/package-registry-service.test.js
node test/core-files-service.test.js
node test/core-files-domain-boundary.test.js
node test/package-query-executor-service.test.js
```

Notes:

- Some tests print development secret warnings if local environment secrets are not configured. These warnings were not test failures.
- Some tests/local server activity may modify runtime JSON files. Check git status before committing.

## Immediate Next Step

First, create a clean checkpoint commit for Step 9.

Recommended sequence:

```bash
git status --short
git diff --stat
```

Make sure runtime files are not included unless intentionally needed:

```text
data/actionStates.json
data/logs.json
data/sessions.json
```

Then commit the Step 9 implementation.

## Activation Check After Commit

Run the PTE package activation script in dry-run mode:

```bash
node scripts/packages/enable-pte-package.js
```

Expected:

- It reports PTE package registry activation.
- It says dry-run.
- It reports package `pte@1.0.0`.
- It does not write `data/packageRegistry.json`.

Then, if the dry-run looks correct:

```bash
node scripts/packages/enable-pte-package.js --apply
```

Expected:

- `pte` is upserted into package registry.
- `enabled: true`
- `installStatus: enabled`
- version comes from `packages/pte/package.manifest.json`
- metadata includes declaration counts and manifest path.

## Manual Browser Verification

After applying package activation, start the app and verify:

```text
/pte
/pte/test-info
/pte/join
/pte/packages
/pte/dashboard
```

Verify user flows:

- Guest opens `/pte/join`.
- Guest creates a PTE public account.
- Existing logged-in user opens `/pte/join`.
- Existing logged-in user joins public PTE and receives `pte_student_public`.
- Existing logged-in user who already has `pte_student_public` sees the already-joined state.
- `/persons/join` still works as the generic public account creation route.

## Recommended Step 10

Do not physically move PTE files into `packages/pte` yet.

Recommended Step 10: package route loading preparation.

Goal:

- Add core support for package route metadata and route mounting while preserving the current hardcoded `/pte` mount as a fallback.
- Keep PTE files in current MVC locations during this step.
- Prove the loader can discover route declarations safely before replacing the hardcoded mount.

Potential Step 10 work:

- Review current `packageLoaderService` and manifest route declarations.
- Add a route hook shape to package loader/installer services if needed.
- Decide how package route modules should export routers.
- Add a package route mounting service that can mount enabled package routes.
- Keep `/pte` hardcoded until the package route loader is proven.
- Add tests that a manifest route can be discovered and prepared without breaking app startup.
- Add tests that disabled package mount paths are not exposed through package navigation.

Acceptance for Step 10:

- Existing `/pte` behavior remains unchanged.
- Package loader has a real route-loading path or a documented route-mount preparation path.
- No physical PTE move yet.
- Tests prove route metadata is valid and ready for the next migration pass.

## Later Steps After Step 10

Step 11 could move package-facing configuration out of core constants where practical.

Step 12 could begin physical relocation planning for PTE files into `packages/pte`.

Step 13 could implement package install/uninstall lifecycle behavior for package-owned roles, sections, symbols, settings, upload folders, and data.

Step 14 could repeat the same package preparation pattern for School, IELTS, BenchPath, or another domain.
