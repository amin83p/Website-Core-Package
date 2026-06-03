# School Package Pass 34: Runtime Smoke & Stability Verification (2026-06-02)

## Goal
Confirm the school package is healthy after route mount/auth recovery and prepare the package for completion sign-off.

## Scope
- Validate runtime startup behavior for the `school` package.
- Validate school route accessibility under normal auth flow.
- Check for known auth middleware regressions in startup and login paths.

## Runtime checks
1. Start the app and confirm package installer summary for school:
   - `loaded=1`
   - `failed=0`
2. Confirm route registration summary for school shows:
   - `requested=1`
   - `prepared=1`
   - `mounted=1`
   - `failed=0`
3. Confirm no blocking auth middleware errors on login:
   - no `authService.validateToken is not a function`
   - no repeated circular dependency `validateToken` warnings.

## Functional smoke URLs
1. `/school`
2. `/school/students`
3. `/school/timetable` (or nearest primary school landing route in your deployment)

## Success criteria
- School pages load without 404 under normal navigation.
- Login flow reaches protected school pages with expected response status.
- No regressions in package loader logs for school route mounting.

## Completion notes
- If all checks pass, mark school package as stable for handoff and proceed to finalization.
