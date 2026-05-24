# PTE Route Dependency Surface Expansion (Step 58)

## Summary

After moving PTE route submodules into package ownership, some subroutes started reading middleware helpers from
`packages/pte/MVC/routes/pteRouteDependencies.js` that were not previously re-exported there.

## What Changed

- Updated `packages/pte/MVC/routes/pteRouteDependencies.js` to forward:
  - `upload`
  - `pteUploadContext`
  - `resolveActivityQuotaPolicy`
  through the existing package dependency adapter.
- Expanded `test/pte-package-route-dependency-boundary-step44.test.js` to verify these exports remain available.

## Why

This keeps package-local route modules fully runnable even when mounted through the package route loader, instead of depending on the current hardcoded MVC route fallback.

## Acceptance Criteria

- `packages/pte/MVC/routes/pteRouteDependencies.js` re-exports all middleware currently used by package-owned routes.
- The boundary test validates route dependency availability and guards direct deep core imports.
