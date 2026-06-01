# School Package Pass 10 Route Ownership Batch 3 (2026-06-01)

## Outcome
- Replaced delegated wrapper routes with package-owned implementations:
  - `packages/school/MVC/routes/attendanceRoutes.js`
  - `packages/school/MVC/routes/sampleDataRoutes.js`

## Notes
- Route behavior remains aligned with core:
  - both require auth and preserve existing access/action-state guard semantics
  - shared core middlewares are resolved through `requireCoreModule(...)`:
    - `attendanceMatrixPolicyAdminMiddleware`
    - `adminApproval`
  - handlers continue using package controller bridge modules

