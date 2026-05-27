# Core Bootstrap Baseline Runbook

## Purpose
Use this first-run tool to seed core security metadata into a fresh backend.

Maintenance policy:
- Follow [Core Bootstrap Baseline Maintenance Procedure](./core-bootstrap-baseline-maintenance.md) for every core-data change.

Source pack:
- `data/bootstrap/core/manifest.json`
- entity files under `data/bootstrap/core/`
- binary assets under `data/bootstrap/core/assets/`

## Included baseline entities
- `sections`
- `operations`
- `roles`
- `scopes`
- `symbols`
- `accesses`
- `accessPolicies`
- `systemSettings` defaults (`create-if-missing`)

## Included baseline assets (v1 curated core set)
- `/uploads/GLOBAL/logo/Logo1.png`
- `/uploads/GLOBAL/logo/icon.svg`
- `/uploads/GLOBAL/symbols/bmc_qr_1772825486683.png`

Asset declarations are defined in `manifest.json -> assets[]` with:
- `source` (relative to `data/bootstrap/core/assets/`)
- `targetUploadRef` (`/uploads/...`)
- optional `required`, `tags`

## Routes
- `GET /systemSettings/bootstrap/core`
- `POST /systemSettings/bootstrap/core/preflight`
- `POST /systemSettings/bootstrap/core/apply`

## Security model
- auth required
- `SYSTEM_SETTINGS + UPDATE` required
- action-state token required for preflight/apply
- admin verification required for apply

## Behavior
- Non-destructive by default.
- Existing records are not overwritten.
- Missing records are created.
- Conflicts are reported, not auto-fixed.
- Asset copy is non-destructive: existing target files are skipped.
- Missing source asset files are reported in output (`missing_source`) and do not abort the whole run.
- Each preflight/apply writes an audit row to `coreBootstrapRuns`.

## Mirror parity checklist
Run in both repositories:

```powershell
npm run core:baseline:check
# If drift is reported:
npm run core:baseline:sync
node test/core-bootstrap-parity-checklist.test.js
node test/system-settings-core-bootstrap-route.contract.test.js
node test/system-settings-core-bootstrap-controller-view.test.js
node test/system-settings-core-reset-route.contract.test.js
```
