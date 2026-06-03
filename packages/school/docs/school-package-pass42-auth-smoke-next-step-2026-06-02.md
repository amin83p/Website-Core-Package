# School Package Pass 42: Auth-Surface Smoke Completion Plan

## Status
- Pass 41 smoke verification is complete for unauthenticated routing and route-loader metrics.
- Runtime route access checks for `/school`, `/school/students`, `/school/teachers`, `/school/staff`, and `/dashboard/section-nav/SCHOOL` show expected unauthenticated 302→`/login`.
- Package loader health evidence remains healthy in prior run (`requested=1 | prepared=1 | mounted=1 | failed=0`, package summary `enabled=2 | loaded=2 | failed=0`).

## What was added in this pass
- Enhanced `scripts/school/smoke-pass40.js` to support authenticated smoke runs without hard-coded credentials:
  - `SCHOOL_SMOKE_COOKIE`
  - `--cookie=<cookie-string>`
  - `--cookie-file=<path>`
  - `--cookie-only`
- Added menu/dashboard auth probe logging:
  - Detects whether `/dashboard/section-nav/SCHOOL` response contains links to `/school/teachers` and `/school/staff`.

## What was closed
- Completed one authenticated smoke execution using session cookie input:
  - `node scripts/school/smoke-pass40.js --port=3100 --cookie="auth_token=<jwt>" --cookie-only`
- Captured and archived the full PASS output in:
  - `logs/school-pass42-auth-smoke-3100-start.log`
- Confirmed:
  - unauth matrix passed as expected (`302 /login`),
  - auth matrix passed for `/school`, `/school/students`, `/school/teachers`, `/school/staff`, and `/dashboard/section-nav/SCHOOL`,
  - menu/dashboard probe reported `teachersLink=true`, `staffLink=true`.

## Recommended command (Windows) for future re-runs
```bash
node scripts/school/smoke-pass40.js --port=3100 --cookie="auth_token=<session_token>" --cookie-only
```

Optional:
- `set SCHOOL_SMOKE_COOKIE="<session_cookie_string>"` then run without `--cookie-only` if using username/password is not available.
