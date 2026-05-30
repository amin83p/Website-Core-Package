# Local Package Sync (Local Development Only)

Use this workflow only for local development environments.

## Local-only environment variables

Set these in your local `.env` when you need local package sync:

```bash
PACKAGE_LOCAL_DEV_MODE=true
PACKAGE_RUNTIME_MOUNT_PATH_LOCAL=/packages
PACKAGE_LOCAL_TARGET_ROOT=./packages
# Optional override:
# PACKAGE_LOCAL_REGISTRY_FILE=./data/localPackageRegistry.json
```

## Production safety

- Do not set these variables in Railway production.
- In production, package loading is registry-based and local sync mode is ignored/blocked.
