# Package Storage Root Runbook (Railway)

## Why this is needed
Core app deploys replace the application filesystem. If installed package folders are stored under the repo path, package files can disappear after deploy even though package registry rows still exist.

Use `PACKAGE_STORAGE_ROOT` so installed package folders live on persistent storage.

## Configuration
Set this env var in Railway (and local `.env` when needed):

```bash
PACKAGE_STORAGE_ROOT=/app/uploads/packages
```

Notes:
- Use your mounted Railway volume path.
- If unset, the app falls back to `<project>/packages`.

## One-time migration
If packages were previously installed to `<project>/packages`, move/copy them once into the persistent root:

1. Ensure the target directory exists in volume path.
2. Copy each package folder (for example `pte`) into `PACKAGE_STORAGE_ROOT`.
3. Restart app.
4. Open `/systemSettings/packages` and confirm:
   - Package Storage Root shows your persistent path.
   - Installed package rows resolve manifests correctly.

## Startup self-healing behavior
If a package is marked enabled but its manifest file is missing at startup:
- App keeps running (core stays available).
- Package row is auto-disabled with a warning in registry.
- Warning appears in Package Manager startup warnings.

## Validation checklist
1. Install package via ZIP upload.
2. Confirm package appears enabled.
3. Deploy a new core commit.
4. Confirm package is still present and can be enabled/used without reinstall.
