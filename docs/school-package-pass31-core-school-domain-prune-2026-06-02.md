# School Package Pass 31 Core-School Domain Prune (2026-06-02)

## Outcome
- Removed redundant school domain artifacts from the core package runtime surface now that `packages/school/...` owns the domain implementations.
- Kept package-domain ownership as the active source for school models, services, repositories, controllers, routes, and views.
- Left only the shared-school integration points needed by core bootstrap and package wiring.

## Core removals applied
- Removed legacy school service files from `MVC/services/school`:
  - `reportIntegrityService.js`
  - `withdrawal/index.js`
  - `withdrawal/classWithdrawalService.js`
  - `withdrawal/programWithdrawalService.js`
  - `withdrawal/termWithdrawalService.js`
  - `withdrawal/withdrawalPolicyService.js`
  - `withdrawal/withdrawalSettlementService.js`
  - `withdrawal/withdrawalWorkflowService.js`
- Removed legacy school views from `MVC/views/school` (all school UI templates were moved to package-owned templates).
- Removed now-empty legacy school folders from core:
  - `MVC/models/school`
  - `MVC/repositories/school`
  - `MVC/controllers/school`
  - `MVC/routes/school`
  - `MVC/services/school`

## Notes
- This pass expects the app mount + resolver path to source package code directly for school runtime behavior.
- No service wrapper files for school runtime are left in core.
