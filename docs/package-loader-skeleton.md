# Package Loader Skeleton (Step 4)

This step adds a non-breaking package loader skeleton while keeping all current hardcoded route mounts active.

## What this step introduces

- Loader service: `MVC/services/packageLoaderService.js`
- Startup invocation from `app.js`
- Hooked load pipeline (internal hooks only, no domain route migration yet):
  - route registration hook
  - view registration hook
  - static asset registration hook
  - registry-data registration hook
  - upload-folder registration hook
  - query-executor registration hook

## Current behavior

- Loader reads enabled package rows from package registry storage.
- Loader resolves and validates package manifests using Step 2 validator.
- Loader logs load success/fail per package.
- Invalid package manifests are skipped without crashing app startup (compatibility-first default).
- Existing hardcoded mounts for `/pte`, `/school`, `/ielts`, `/benchpath`, `/credit` remain unchanged.

## Startup integration

- `app.js` now invokes loader during startup after backend initialization and settings init.
- Failures in package loading are logged and do not block server start in this phase.

## Tests

- `test/package-loader-service.test.js`
  - no enabled packages
  - enabled valid package with hook execution
  - invalid manifest skip behavior
  - metadata-provided manifest path
