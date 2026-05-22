# Package Registry Storage (Step 3)

This step introduces persistent package registry storage (JSON + Mongo) without enabling package loading yet.

## Purpose

Store package install state so the core can track:

- package id
- version
- enabled/disabled
- install status
- installed/update timestamps
- last error/warning

## Data shape

Each package registry row is normalized by `packageId` (also used as `id`):

- `id`
- `packageId`
- `version`
- `enabled`
- `installStatus`
- `installedAt`
- `updatedAt`
- `lastError`
- `lastWarning`
- `metadata`
- `audit`

## Files added

- JSON model: `MVC/models/packageRegistryModel.js`
- Backend-aware repository: `MVC/repositories/packageRegistryRepository.js`
- Service API: `MVC/services/packageRegistryService.js`
- JSON seed file: `data/packageRegistry.json`
- Mongo indexes: `MVC/infrastructure/mongo/mongoIndexManager.js` (`packageRegistries`)
- Tests: `test/package-registry-service.test.js`

## Notes

- This is storage and service groundwork only.
- No package loader/route mounting is introduced in this step.
- Behavior is idempotent: upserting the same `packageId` updates the existing row instead of creating duplicates.
