# School package continuation handoff (2026-06-02)

## Current state
- I fixed one concrete school import issue in package repo:
  - `packages/school/MVC/services/school/schoolRoleTagProvider.js`
  - changed `require('../../utils/idAdapter')` to `requireCoreModule('MVC/utils/idAdapter')`
- This fix is committed as `71ddf90` in `Website-Core-Package`.
- User still reports 404 for school routes on startup.

## Latest terminal output observed
- `[PACKAGE_LOADER][LOAD_FAIL][WARN] Skipped package school... reason=Runtime route mount reported failed route declarations.`
- `[PACKAGE_ROUTES][REGISTER][INFO] ... requested=1 prepared=1 mounted=0 failed=1`
- `[PACKAGE_INSTALLER][SUMMARY] enabled=1 | loaded=0 | failed=1`

## Important note on Core-Only repo
- In this environment, `Website-Core-Only` does not contain the `school` package under `packages/school/...` (no matching file path exists).
- Therefore there was no direct school package mirror file to apply the above change to in Core-Only.
- No additional core-layer files were identified that required modification during this pass.

## Next steps for next agent/session
1. Run app and capture first failing route-stack line by temporarily adding verbose logging in `MVC/services/packageRouteService.js` around route `require()` for declarations. E.g. log packageId + route declaration + error stack before incrementing `failed`.
2. Alternatively, temporarily `node`-execute equivalent of route registration with real logs on local machine (where EPERM on this runner prevents this environment from tracing package requires).
3. Once the failing declaration module is identified, patch that exact file and re-run.
4. Re-run:
   - start app
   - hit one school page route
   - confirm `[PACKAGE_LOADER][SUMMARY] loaded=1 failed=0` and pages render (not 404)

## References to revisit in docs
- `docs/school-package-pass26-32-full-ownership-plan-2026-06-01.md`
- `packages/school/package.manifest.json`
- `packages/school/MVC/routes/schoolMainRoute.js`
