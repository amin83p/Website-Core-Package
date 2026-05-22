# Package Route Loading Preparation (Step 10)

This step adds a compatibility-first package route loading path while preserving current hardcoded domain mounts.

## What was added

- New service: `MVC/services/packageRouteService.js`
  - reads `manifest.routes` declarations,
  - validates route metadata (`method`, `path`, active/metadata flags),
  - prepares route declarations for runtime usage,
  - mounts eligible `USE` routes when:
    - declaration is active,
    - `metadataOnly !== true`,
    - `router` module is provided,
    - express `app` context is available.

- Loader hook wiring:
  - `MVC/services/packageRegistryInstallerService.js` now exposes `registerRoutes` in `createLoaderHooks()`.
  - `MVC/services/packageLoaderService.js` already executes `registerRoutes` first in the package hook pipeline.

## Compatibility behavior

- Existing hardcoded mounts in `app.js` remain unchanged (`/pte`, `/school`, `/ielts`, `/benchpath`, `/credit`).
- Metadata-only routes are discovered and tracked as prepared, but **not mounted**.
- Non-`USE` route declarations are prepared as metadata for future direct-method mounting support.
- Duplicate `USE` route mounts are skipped safely in-process.
- Invalid route declarations are reported as failures in summary results without crashing package startup.

## Tests

- `test/package-route-service.test.js`
  - metadata-only discovery path,
  - active `USE` mount path,
  - duplicate mount guard,
  - invalid declaration failure reporting.
- `test/package-registry-installer-service.test.js`
  - loader hook route registration coverage for metadata-only PTE routes.

## Result

Step 10 acceptance is met for a safe route-loading preparation path:
- route metadata is now processed through package loader hooks,
- existing `/pte` runtime behavior is preserved,
- no physical PTE file move was introduced in this step.
