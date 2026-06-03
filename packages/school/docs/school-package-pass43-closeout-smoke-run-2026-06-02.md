# School Package Pass 43: Closeout Smoke + Installability Handoff (2026-06-02)

## Status
- School package auth/runtime smoke is complete for `school` route family with authenticated session cookie validation.
- Route/access evidence now exists for:
  - `/school`
  - `/school/students`
  - `/school/teachers`
  - `/school/staff`
  - `/dashboard/section-nav/SCHOOL`
- This closeout run is valid for package readiness handoff and for Core-only installability follow-through.

## Executed command sequence (local environment)
```powershell
$port = 3165
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$appLog = "logs\school-pass42-smoke-boot-$ts.log"
$appErr = "logs\school-pass42-smoke-boot-$ts.err"
$smokeLog = "logs\school-pass42-auth-smoke-final-$ts.log"

if (Test-Path $appLog) { Remove-Item $appLog -Force }
if (Test-Path $appErr) { Remove-Item $appErr -Force }
if (Test-Path $smokeLog) { Remove-Item $smokeLog -Force }

$env:PORT = $port
$proc = Start-Process -FilePath node -ArgumentList 'app.js' -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $appLog -RedirectStandardError $appErr -WindowStyle Hidden -PassThru
Start-Sleep -Milliseconds 1200

node scripts/school/smoke-pass40.js --no-server-start --port=$port --cookie-only --cookie="auth_token=<JWT_FROM_BROWSER>" 2>&1 | Tee-Object -FilePath $smokeLog

Stop-Process -Id $proc.Id -Force
```

## Smoke evidence
- unauth checks:
  - `/school`, `/school/students`, `/school/teachers`, `/school/staff`, `/dashboard/section-nav/SCHOOL` returned `302 /login`.
- auth checks using session cookie:
  - `/school` -> `302 /dashboard/section-nav/SCHOOL`
  - `/school/students` -> `200`
  - `/school/teachers` -> `200`
  - `/school/staff` -> `200`
  - `/dashboard/section-nav/SCHOOL` -> `200`
- menu probe:
  - `/dashboard/section-nav/SCHOOL` returned `teachersLink=true`, `staffLink=true`.
- loader health evidence (from app boot log):
  - `Processed route declarations for school. | packageId=school | requested=1 | prepared=1 | mounted=1 | failed=0`
  - `PACKAGE_LOADER][SUMMARY][INFO] Package loader finished. | enabled=2 | loaded=2 | failed=0`

## Outstanding / next action
- Do a one-time Core-only installability pass from `Website-Core-Only` using the standard package installer flow:
  1. build/sign school package artifact (`same signing/zip flow used by PTE`)
  2. upload via Package Manager
  3. verify `/school` and `/dashboard/section-nav/SCHOOL` are not 404 for an authorized session
- This local pass confirms the school package behavior is ready for that Core-only install run.
