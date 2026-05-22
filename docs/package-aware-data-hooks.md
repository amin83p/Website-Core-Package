# Package-Aware Data Hooks (Step 8)

This step decouples package query executors from the core bootstrap path.

## What changed

- Core bootstrap (`MVC/models/queryExecutorBootstrap.js`) now registers **core entities only**.
- Package query executors are now registered through package loader hooks via:
  - `MVC/services/packageQueryExecutorService.js`
  - `MVC/services/packageRegistryInstallerService.js` (`registerQueryExecutors` hook)
- Runtime backend retry re-applies package query executors after core executors are reset:
  - `MVC/controllers/systemSettingsController.js` (`retryDataBackendConnection`)

## Manifest contract

Package manifests can now declare query executors with:

```json
{
  "queryExecutors": [
    {
      "entity": "school.students",
      "source": "school",
      "repository": "students"
    }
  ]
}
```

Supported declaration fields:

- `entity` (required): normalized entity key used by `getEntityQueryExecutor`.
- `repository` (required): repository export name that provides `list(options)`.
- `source` (optional): built-in source key (`school`, `ielts`, `benchpath`) used to resolve repository module.
- `modulePath` (optional): explicit module path (absolute or repo-relative).

## Compatibility-first behavior

- Non-JSON backends skip package query executor registration.
- If `queryExecutors` is omitted, built-in fallback declarations are provided for:
  - `school`
  - `ielts`
- Disabled packages are not registered.

## Tests

- `test/package-query-executor-service.test.js`
- `test/package-manifest-service.test.js` (updated for `queryExecutors` declaration validation)
