# Package Route Import Compatibility (Step 15)

Step 15 prepares route module resolution for the future PTE physical move without changing active `/pte` routing.

## What Was Added

- New service: `MVC/services/packageModuleResolverService.js`
  - resolves module paths inside the project root,
  - supports current project-root paths such as `MVC/routes/pte/pteMainRoute.js`,
  - supports future package-root relative paths such as `test/fixtures/package-route.fixture.router.js` from `packages/pte`,
  - rejects parent traversal in package declarations.

- `MVC/services/packageRouteService.js` now resolves router modules through the package module resolver.

## Compatibility Behavior

- Current PTE manifest route declarations remain unchanged and metadata-only.
- The hardcoded `/pte` mount in `app.js` remains the runtime source of truth.
- Future package-root router paths can be introduced in a later step after PTE files are physically moved.

## Result

The route loader can now resolve both old MVC route paths and future package-owned route module paths. This removes one more blocker before moving PTE files under `packages/pte`.

## Remaining Work

- Add package-aware controller/service import adapters or update paths during the physical move.
- Keep `/pte` metadata-only until duplicate route handoff testing is complete.
- Move PTE route files only after route import compatibility and view/asset compatibility are both stable.
