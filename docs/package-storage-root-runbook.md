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
- In Railway production, do **not** set local sync vars:
  - `PACKAGE_LOCAL_DEV_MODE`
  - `PACKAGE_RUNTIME_MOUNT_PATH_LOCAL`
  - `PACKAGE_LOCAL_TARGET_ROOT`
  - `PACKAGE_LOCAL_REGISTRY_FILE`

Optional startup recovery knobs (production-safe):

```bash
PACKAGE_STARTUP_RECOVERY_ENABLED=true
PACKAGE_STARTUP_RECOVERY_WINDOW_MS=300000
PACKAGE_STARTUP_RECOVERY_INTERVAL_MS=15000
```

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
- Package is recorded in startup warnings for this boot.
- Startup recovery retries run in background for a bounded window.
- Package registry rows remain enabled unless an explicit admin action changes them.

## Validation checklist
1. Install package via ZIP upload.
2. Confirm package appears enabled.
3. Deploy a new core commit.
4. Confirm package routes respond without manual re-enable.
5. Confirm Package Manager warning columns clear after successful activation.
