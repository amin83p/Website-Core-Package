# School Package Pass 6 Runtime Mount Cutover (2026-06-01)

## Outcome
- Removed hardcoded core app mount for School from `app.js`:
  - removed `app.use('/school', require('./MVC/routes/school/schoolMainRoute'));`
- `/school` ownership now flows through package runtime activation via `packages/school/package.manifest.json` route declaration.

## Why This Pass Matters
- This aligns School with package-first runtime behavior used by packaged domains.
- It prevents dual-path mounting conflicts between core hardcoded routes and package runtime routes.

## Guardrails Added
- `test/school-package-runtime-cutover-pass6.test.js`
  - fails if `app.js` reintroduces a hardcoded `/school` mount
  - verifies manifest owns an active `USE /school` route with `MVC/routes/schoolMainRoute.js`
