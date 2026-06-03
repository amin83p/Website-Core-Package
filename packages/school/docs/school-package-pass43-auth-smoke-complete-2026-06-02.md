# School Package Pass 43: Auth Smoke Completion + Route/Menu Verification (2026-06-02)

## Status
- Pass 43 promotes school smoke status from `smoke-unauth-verified` to `smoke-auth-verified`.
- Full startup + unauth + auth + menu-link smoke run completed on a clean temp port.

## Executed command
```bash
node scripts/school/smoke-pass40.js --port=3100 --cookie="auth_token=<ROOT_ISSUED_JWT>" --cookie-only
```

## Evidence captured
- App startup via script-led launch, with route loader telemetry captured:
  - `package summary: enabled=2 loaded=2 failed=0`
  - `route summary: requested=1 prepared=1 mounted=1 failed=0` for school loader entries
- Unauthenticated matrix:
  - `/school`, `/school/students`, `/school/teachers`, `/school/staff`, `/dashboard/section-nav/SCHOOL` all returned `302 /login`
- Authenticated matrix (using provided `auth_token` cookie):
  - `/school` -> `302 /dashboard/section-nav/SCHOOL`
  - `/school/students` -> `200`
  - `/school/teachers` -> `200`
  - `/school/staff` -> `200`
  - `/dashboard/section-nav/SCHOOL` -> `200`
  - all authenticated checks marked PASS
- Menu probe:
  - `/dashboard/section-nav/SCHOOL` contained both `teachersLink=true` and `staffLink=true` markers
- Full run log: `logs/school-pass42-auth-smoke-3100-start.log`

## Notes
- `app.js` startup still emitted non-blocking warnings during this run:
  - `dataService.fetchData is not a function` (Entity Resolution)
  - `Accessing non-existent property ... inside circular dependency`
- No `validateToken is not a function` fatal was emitted during this run, and authentication behavior remained functional for session-cookie checks.

## Next
- If needed, mirror this run in Core-only environment using the same package artifact + registry activation path used by deployment.
