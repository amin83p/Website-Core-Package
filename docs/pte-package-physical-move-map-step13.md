# PTE Physical Move Readiness Map (Step 13)

Step 13 prepares the PTE package for a later physical move into `packages/pte`. This step does not move files, change routes, change schemas, or change runtime behavior.

## Current State

- PTE is enabled in `data/packageRegistry.json`.
- `packages/pte/package.manifest.json` is the package declaration source.
- PTE route declarations remain `metadataOnly: true`.
- Runtime `/pte` traffic still comes from the hardcoded mount in `app.js`.
- PTE implementation files still live in the current MVC and shared root folders.

## PTE-Owned File Inventory

### Already grouped by domain

- `MVC/controllers/pte`
- `MVC/routes/pte`
- `MVC/services/pte`
- `MVC/models/pte`
- `MVC/views/pte`

These folders should move together in a later physical relocation step. Their internal relative imports can be adjusted in one controlled pass after the target layout and compatibility adapters are ready.

### PTE files still mixed into shared roots

- `MVC/repositories/pte*.js`
- `MVC/middleware/pteUploadContextMiddleware.js`
- `MVC/utils/pteUploadPathUtils.js`
- `public/scripts/ptePracticeCoachRules.js`
- `data/pte*.json`
- `scripts/seed-pte-*.js`
- `scripts/migrate-pte-student-role-token.js`
- `scripts/pte`
- `scripts/packages/enable-pte-package.js`
- `docs/pte`
- `test/pte*.test.js`
- `test/pte-package-step9.test.js`
- `test/pte-package-activation-step12.test.js`

These should be planned explicitly because they are currently outside the main PTE MVC folders.

## Future Target Layout

The later physical move should use this target shape:

```text
packages/pte/
  package.manifest.json
  MVC/
    controllers/
    routes/
    services/
    models/
    repositories/
    middleware/
    utils/
    views/
  public/
    scripts/
  scripts/
    seed/
    migration/
    maintenance/
  docs/
  test/
```

The target keeps familiar MVC categories inside the package while making PTE ownership visible from the top-level package folder.

## Core Dependencies PTE May Continue To Consume

PTE should continue consuming these core framework services rather than copying them into the package:

- Auth and session middleware.
- Access middleware and access policy evaluation.
- Action state tracking and admin verification.
- Persons, users, organizations, memberships, roles, sections, symbols, and accesses.
- `coreFilesService`, upload middleware, upload folder settings, and storage gateway utilities.
- Activity Quota services and ledgers.
- Generic JSON/Mongo data abstractions, repositories, query engine, and id utilities.
- Settings, branding/menu/dashboard composition, pagination, table helpers, and shared security utilities.

These remain core-owned boundaries. The later move should update import paths or use package aliases without duplicating core code.

## Special Dependency Notes

- PTE AI provider adapters currently re-export IELTS provider implementations. Do not blindly copy IELTS files into PTE. Treat shared AI providers as a future core/shared service boundary or as an explicit cross-package dependency.
- `MVC/repositories/pte*.js` are flat root files today. Move them to the future PTE repository folder only after all service imports are mapped.
- PTE views contain many hardcoded `/pte` URLs. These URLs are public interface and should remain unchanged after the move.
- PTE upload paths and `/uploads/...` URLs must remain unchanged. Package code should keep using core storage helpers.
- PTE data files can remain in root `data/` until the data layer supports package data roots without breaking JSON/Mongo parity.

## Future Move Sequence

1. Add package-aware view and asset loading support while preserving existing core view lookup.
2. Add a compatibility import strategy for package-owned route modules.
3. Move PTE repositories, middleware, utilities, controllers, routes, services, models, views, public assets, docs, tests, and scripts in small groups.
4. Update PTE manifest route paths from old MVC locations to package locations, but keep `metadataOnly: true`.
5. Switch `/pte` from hardcoded app mount to package route loader only after duplicate-route behavior is explicitly tested.
6. Remove the hardcoded `/pte` mount after package dynamic mounting is proven.

## Step 13 Acceptance

- This document exists and records the PTE file groups.
- No PTE files are physically moved in Step 13.
- `app.js` still hardcodes `/pte`.
- The PTE manifest still keeps `/pte` runtime routing metadata-only.
- Step 12 package activation and route-order tests continue to pass.

## Step 14 Follow-Up

Step 14 adds package-aware view and asset loading support. PTE still remains physically in the current MVC/public locations, and its asset declaration stays metadata-only to avoid changing public script URLs.
