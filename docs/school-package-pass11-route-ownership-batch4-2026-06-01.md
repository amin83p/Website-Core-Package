# School Package Pass 11 Route Ownership Batch 4 (2026-06-01)

## Outcome
- Replaced delegated wrapper routes with package-owned implementations:
  - `packages/school/MVC/routes/staffRoutes.js`
  - `packages/school/MVC/routes/teacherRoutes.js`
  - `packages/school/MVC/routes/subjectRoutes.js`
  - `packages/school/MVC/routes/departmentRoutes.js`

## Notes
- Route behavior remains aligned with core:
  - all require auth
  - all preserve existing access/action-state guard semantics
  - all continue using package controller bridge handlers

