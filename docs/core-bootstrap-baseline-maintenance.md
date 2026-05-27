# Core Bootstrap Baseline Maintenance Procedure

This procedure is mandatory whenever core registry data changes (sections, operations, roles, scopes, symbols, accesses, access policies, or core seed scripts that affect them).

## Required Trigger Events
- Any change to core seed scripts in `scripts/seed-*` or `scripts/core/*`
- Any direct change to core data files under `data/*.json` for core entities
- Any change that modifies core section hierarchy or core-owned roles/symbols/access rows

## Required Steps (Always)
1. Run baseline drift check:
   - `npm run core:baseline:check`
2. If drift is reported, sync baseline:
   - `npm run core:baseline:sync`
3. Run parity + route/controller tests:
   - `node test/core-bootstrap-parity-checklist.test.js`
   - `node test/system-settings-core-bootstrap-route.contract.test.js`
   - `node test/system-settings-core-bootstrap-controller-view.test.js`
   - `node test/system-settings-core-reset-route.contract.test.js`
4. Commit live core data and baseline updates together in the same commit.

## Guardrail Rules
- Do not manually edit `data/bootstrap/core/*` to chase one-off diffs unless the sync script/policy is being updated.
- Keep baseline scope core-only; do not add package-owned rows into the core baseline.
- Keep `SYSTEM_SECTIONS -> SCOPES` linkage present exactly once in both live and baseline section trees.
