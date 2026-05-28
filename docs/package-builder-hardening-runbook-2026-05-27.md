# Package Builder Hardening Runbook (2026-05-27)

## What This Pass Added
- Strict origin-scope enforcement now uses all org signals (business fields + upload URL tokens).
- Preflight now reports scope validation details and blocks build on cross-org file violations.
- Package install payload import is now fail-fast (no silent partial success on row import errors).
- Package build now publishes downloadable artifacts under:
  - `uploads/GLOBAL/packages/<packageId>/<buildId>/`
- Builder UI now supports file-field selection per selected table and shows published artifact links.

## Builder Flow (Operational)
1. Open `System Settings -> Package Builder`.
2. Select `Package`, `Target Version`, and `Origin Org`.
3. Select package-owned tables.
4. In **File Fields By Table**, select the fields that should be scanned for upload refs.
5. Run **Preflight**:
   - If `scopeValidation.blocking === true`, fix violations first.
6. Run **Build Signed Package**:
   - Check output `publishedArtifacts.files` for ZIP/SIG/detail links.
7. Download artifacts directly from Builder output links or browse in File Manager:
   - `GLOBAL/packages/<packageId>/<buildId>/`.

## Install Flow Validation
1. Open `System Settings -> Package Manager`.
2. Install from ZIP + SIG.
3. If payload import fails, install returns `BUILDER_PAYLOAD_IMPORT_FAILED` with `details`:
   - `entityType`, `rowId`, `operation`, `message`.
4. Resolve the data conflict and retry install (idempotent retry path remains supported).

## Regression Command Set
- `node test/system-settings-package-builder-service.test.js`
- `node test/system-settings-package-builder-controller-view.test.js`
- `node test/system-settings-package-builder-route.contract.test.js`
- `node test/system-settings-package-manager-service.test.js`
- `node test/system-settings-package-manager-controller-view.test.js`
- `node test/system-settings-package-manager-route.contract.test.js`

## Mirror Checklist (Next Repo)
1. Copy service/controller/view/test changes for package builder/manager.
2. Run the same regression command set.
3. Verify Builder preflight/build and Package Manager install manually.
4. Commit only after parity checks pass in both repos.
