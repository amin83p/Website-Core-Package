# Core-Only Regeneration from Core Package

This process is the supported way to recreate `Website-Core-Only` from `Website-Core-Package`.

## Scope
- Source of truth is `Website-Core-Package`.
- Core-Only receives a small, intentional overlay for package-manager behavior and deployment-local settings.
- Package code is not copied into Core-Only; package discovery/installation remains manifest-driven.

## Pinned Baseline
When re-creating Core-Only, record the exact source revision in the commit line:
`git rev-parse --short HEAD` from `Website-Core-Package`.

## How to Run

From `Website-Core-Package`:

```powershell
powershell ./scripts/core-only-bootstrap/rebuild-core-only.ps1 \
  -SourcePath "C:\Users\Amin\myWebsite\Website-Core-Package" \
  -TargetPath "C:\Users\Amin\myWebsite\Website-Core-Only" \
  -SourceCommit "<pinned-commit-hash>"
```

Use `-Force` to replace an existing target directory content.

## Overlay Bundle
The script applies tracked overlay files after copying the source snapshot:
- `scripts/core-only-bootstrap/overlays/.env`
- `scripts/core-only-bootstrap/overlays/data/packageRegistry.json`
- `scripts/core-only-bootstrap/overlays/data/systemSettings.json`
- `scripts/core-only-bootstrap/overlays/MVC/controllers/systemSettingsController.js`
- `scripts/core-only-bootstrap/overlays/MVC/views/systemSettings/packageManagerSettings.ejs`

Keep these overlays aligned whenever core package behavior changes and the Core-Only baseline needs to keep the same deltas.

## Post-Rebuild Validation
- `node --check MVC/services/systemSettingsPackageManagerService.js`
- `node --check MVC/utils/packageStoragePathUtils.js`
- Manual script review for `scripts/core-only-bootstrap/rebuild-core-only.ps1` (PowerShell syntax)
- `node test/package-storage-path-utils.test.js`
- `node test/system-settings-package-manager-service.test.js`
- `node test/system-settings-package-manager-controller-view.test.js`

## Acceptance Check
- Start Core-Only and open Package Manager.
- Confirm `packages/pte` appears and `school` appears in disabled baseline state.
- Install flow should show the multi-step upgrade/ack path when upgrade candidates require acknowledgements.
- Confirm `/logs` remains ignored by git and remains writable runtime output only.
