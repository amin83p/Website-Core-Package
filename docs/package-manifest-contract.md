# Package Manifest Contract (Step 2)

This contract defines how installable domain packages declare their metadata and requirements to the core app.

This step is **validation-only**. No package loader/runtime mounting is introduced here.

## Required fields

- `id`  
  - lowercase package token, pattern: `^[a-z][a-z0-9-]{1,63}$`
- `name`
- `version`  
  - semver-style string, e.g. `1.0.0`
- `mountPath`  
  - slash-prefixed route base, e.g. `/pte`

## Optional fields

- `enabledByDefault`
- `routes` (array)
- `queryExecutors` (array)
- `views` (object)
- `assets` (object)
- `operations` (array)
- `roles` (array)
- `sections` (array)
- `symbols` (array)
- `accesses` (array)
- `uploadFolders` (array)
- `quotaDefinitions` (array)
- `settings` (array)
- `menuEntries` (array)
- `dashboardEntries` (array)
- `seeders` (array)
- `migrations` (array)
- `dependencies` (array of package ids)

## Validation guards

- Missing required fields are rejected.
- Duplicate package ids are rejected (both against known ids and inside a manifest list).
- Unsafe/invalid package ids are rejected.
- Invalid mount paths are rejected.
- Invalid version format is rejected.
- Unknown top-level keys are rejected by default.
- `dependencies` must contain valid package ids and cannot self-reference.

## Implementation

Validator service:

- `MVC/services/packageManifestService.js`

Primary APIs:

- `validatePackageManifest(manifest, options)`
- `validatePackageManifestCollection(manifests, options)`
- `getPackageManifestContract()`

Fixture used in tests:

- `test/fixtures/package-manifest.valid.json`
