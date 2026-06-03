# School Package Pass 15 Controller Ownership Batch 1 (2026-06-01)

## Outcome
- Replaced delegated controller wrappers with package-owned controller implementations:
  - `packages/school/MVC/controllers/school/sessionController.js`
  - `packages/school/MVC/controllers/school/termController.js`
  - `packages/school/MVC/controllers/school/subjectController.js`
  - `packages/school/MVC/controllers/school/holidayController.js`

## Notes
- Runtime behavior remains aligned with core controller logic.
- Generic/shared framework dependencies are bridged via `requireCoreModule(...)` where needed:
  - generic data service
  - generic utility helpers
  - admin checker service
- School domain dependencies continue through package-local service/model wrappers.

