# Package View and Asset Loading (Step 14)

Step 14 adds compatibility-first support for package-declared views and public assets. It prepares the core for a future PTE physical move while keeping the current `/pte` runtime behavior unchanged.

## What Was Added

- New service: `MVC/services/packageViewAssetService.js`
  - reads `manifest.views` and `manifest.assets`,
  - validates paths stay inside the project root,
  - appends package view roots to the Express `views` setting,
  - mounts static package assets when an asset declaration is active and not metadata-only,
  - skips duplicate asset mounts in the same process.

- Loader hook wiring:
  - `packageRegistryInstallerService.createLoaderHooks()` now exposes `registerViews` and `registerAssets`.
  - `packageLoaderService` already calls those hooks after routes and before registry data.

## PTE Compatibility Behavior

- `packages/pte/package.manifest.json` now declares the current PTE view roots:
  - `MVC/views`
  - `MVC/views/pte`
- PTE also declares the current public script asset folder:
  - `public/scripts` at `/scripts`
- The PTE asset declaration is `metadataOnly: true`, so the app does not mount a duplicate static route for `/scripts`.
- Existing PTE view render names such as `pte/testInfo` and existing browser URLs such as `/scripts/ptePracticeCoachRules.js` remain unchanged.

## Result

The package loader can now prepare and register package view roots and can prepare package asset metadata. PTE remains hardcoded at `/pte` and no files are physically moved in this step.

## Remaining Work

- Add package-local view roots after PTE views physically move under `packages/pte`.
- Switch PTE assets from metadata-only to runtime-mounted only after the public URL strategy is decided.
- Keep `/pte` routes metadata-only until the route handoff from hardcoded mount to package loader is explicitly tested.
