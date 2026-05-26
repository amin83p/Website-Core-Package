# Core Bootstrap Baseline Runbook

## Purpose
Use this first-run tool to seed core security metadata into a fresh backend.

Source pack:
- `data/bootstrap/core/manifest.json`
- entity files under `data/bootstrap/core/`

## Included baseline entities
- `sections`
- `operations`
- `roles`
- `scopes`
- `symbols`
- `accesses`
- `accessPolicies`
- `systemSettings` defaults (`create-if-missing`)

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
- Each preflight/apply writes an audit row to `coreBootstrapRuns`.

## Mirror parity checklist
Run in both repositories:

```powershell
node test/core-bootstrap-parity-checklist.test.js
node test/system-settings-core-bootstrap-route.contract.test.js
node test/system-settings-core-bootstrap-controller-view.test.js
```
