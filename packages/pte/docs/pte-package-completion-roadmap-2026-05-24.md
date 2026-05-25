# PTE Package Completion Roadmap (Updated 2026-05-25)

The PTE package migration in `Website-Core-Package` is now at a package-ready baseline.

## Final Status

- Pass 1: completed
- Pass 2: completed
- Pass 3: completed
- Pass 4: completed
- Pass 5: completed
- Pass 6: completed

## Pass 6 Closeout

### 6A) Package foundation verification

All `test/package-*.test.js` suites are green.

### 6B) Root package-boundary verification

All `test/pte-package-*.test.js` suites are green.

### 6C) Mirrored package-local matrix verification

All `packages/pte/test/pte-package-*.test.js` suites are green.

### 6D) Critical runtime regression verification

Selected non-`pte-package-*` PTE runtime suites are green, covering:

- attempts/lifecycle
- scoring services/contracts
- AI assist autofill/contracts
- student picker strict-role filtering

### 6E) Runtime smoke checks

Package route smoke checks are confirmed via package route+manifest inspection:

- `/pte`
- `/pte/join`
- `/pte/packages`
- `/pte/dashboard`

## Lifecycle Commands (Runbook)

```powershell
# Dry-run report
node scripts/packages/enable-pte-package.js --json

# Enable / upsert
node scripts/packages/enable-pte-package.js --apply --json

# Disable package row + owned declarations
node scripts/packages/enable-pte-package.js --apply --disable --json

# Remove package row + owned declarations
node scripts/packages/enable-pte-package.js --apply --remove --json
```

## Baseline

- Repository: `C:\Users\Amin\myWebsite\Website-Core-Package`
- Baseline HEAD used for verification: `1035cdb`
- Node runtime: `v24.11.0`
