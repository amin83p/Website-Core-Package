# School Package Pass 41: Smoke Runbook + Runtime Progress Logging (2026-06-02)

## Goal
Avoid silent hangs during smoke verification by using a single script that prints progress while app startup and route checks run.

## Changes
- Added `scripts/school/smoke-pass40.js` with:
  - Startup launch option (`--no-server-start` to check an already running app),
  - periodic heartbeat logging while waiting for readiness,
  - route checks for:
    - `/school`
    - `/school/students`
    - `/school/teachers`
    - `/school/staff`
    - `/dashboard/section-nav/SCHOOL`
  - optional authenticated checks when `SCHOOL_SMOKE_USERNAME` + `SCHOOL_SMOKE_PASSWORD` are set,
  - final extraction of loader route summary (`requested/prepared/mounted/failed`) and package summary (`loaded/failed`) from startup logs.
- Added npm script: `school:smoke:pass40`.
- The script now prints launch failures (including `spawn EPERM`) and will continue in attach mode when auto-start is blocked by environment.
- Added explicit auth-session fallback support:
  - `SCHOOL_SMOKE_COOKIE` environment variable
  - `--cookie=<cookie-string>` CLI flag
  - `--cookie-file=<path>` CLI flag
  - `--cookie-only` CLI flag to force auth-cookie checks and avoid credential requirement
  - In auth probe mode, the script validates that the supplied cookie can reach `/dashboard/section-nav/SCHOOL` before proceeding.

## Execution verification (2026-06-02)

- Clean startup smoke command used:
  - `cmd /c "set PORT=3100 && node app.js"` (background)
  - `node scripts/school/smoke-pass40.js --no-server-start`
- Resulting smoke status: `PASS` for unauth route matrix.
- Unauth route checks observed:
  - `/school`, `/school/students`, `/school/teachers`, `/school/staff`, `/dashboard/section-nav/SCHOOL` all returned `302 /login` as expected for non-authenticated session.
- Confirmed route-register evidence in app log:
  - `requested=1 | prepared=1 | mounted=1 | failed=0` for school route processing.
  - `enabled=2 | loaded=2 | failed=0` package loader summary.
- This run confirms the script no longer appears to stall silently; startup progress is visible (`waiting for /login readiness...`) and exits with a definitive status.

## Remaining verification gap
- Authenticated route menu/dashboard behavior still needs a real session run (`SCHOOL_SMOKE_USERNAME`/`SCHOOL_SMOKE_PASSWORD`) or an authenticated session cookie (`SCHOOL_SMOKE_COOKIE`, `--cookie`, or `--cookie-file`) to confirm `/school/teachers` and `/school/staff` render according to access surface.

## Current suggested workflow (Windows)
1. Start app once in a dedicated shell:
   - `cmd /c "set PORT=3100 && node app.js"`
2. Run the smoke script against that process with visible progress:
   - `node scripts/school/smoke-pass40.js --no-server-start --port=3100`
   - Add `--skip-auth-checks` for unauth-only smoke.
   - Add `--cookie="connect.sid=...; other=..."` for authenticated checks if credentials are unavailable.
   - Or `set SCHOOL_SMOKE_COOKIE=...` and run the same command.
3. Optional menu/dashboard auth probe:
   - If using browser session cookie values, run:
     - `node scripts/school/smoke-pass40.js --no-server-start --port=3100 --cookie-only`
4. Review output lines for:
   - `menu probe /dashboard/section-nav/SCHOOL ... teachersLink=<true/false> staffLink=<true/false>`

## How to run
- With auto-start:
  - `npm run school:smoke:pass40`
- Against already running app:
  - `node scripts/school/smoke-pass40.js --no-server-start`

## Expected quick signal
- Startup logs should show progress every few seconds instead of appearing stuck.
- Route checks should report each path with status and latency.
- If credentials/cookies are missing, script exits cleanly after logging that auth checks are skipped.

## Next step
- Capture one authenticated smoke run (`--no-server-start` plus credentials or session-cookie input) and then promote the support metadata status from `smoke-unauth-verified` to an auth-verified state.

## Next step
- Run this script with a full smoke profile and use the emitted results to finalize any remaining menu/dashboard access gaps under real auth sessions.
