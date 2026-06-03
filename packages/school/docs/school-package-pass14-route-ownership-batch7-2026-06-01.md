# School Package Pass 14 Route Ownership Batch 7 (2026-06-01)

## Outcome
- Replaced delegated wrapper routes with package-owned implementations:
  - `packages/school/MVC/routes/classRoutes.js`
  - `packages/school/MVC/routes/programRoutes.js`
  - `packages/school/MVC/routes/reportRoutes.js`
  - `packages/school/MVC/routes/examRoutes.js`

## Notes
- Route behavior remains aligned with core.
- Shared framework dependencies stay bridged via `requireCoreModule(...)` where needed:
  - access/security evaluation service
  - upload middleware
  - `requireAccessAny` support for exam hub access

