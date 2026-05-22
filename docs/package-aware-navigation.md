# Package-Aware Menus and Dashboard Shortcuts (Step 7)

This step makes core navigation package-aware while keeping existing route contracts unchanged.

## What was added

- New service: `MVC/services/packageNavigationService.js`
  - reads package registry rows,
  - resolves manifests for enabled/disabled packages,
  - normalizes `menuEntries` and `dashboardEntries`,
  - keeps an in-memory navigation snapshot,
  - exposes disabled mount paths for compatibility filtering.

- Startup refresh in `app.js`
  - after package loading, navigation cache is refreshed once at boot.
  - fallback is safe: app continues with static defaults if refresh fails.

- Public menu integration in `MVC/services/appBrandingService.js`
  - base menu + enabled package menu entries are merged,
  - disabled package mount paths are filtered out (for both menu render and endpoint options),
  - dedupe is applied by id/href/label.

- Dashboard shortcut integration
  - `MVC/controllers/dashboardController.js` adds package dashboard entries to the main dashboard view.
  - `MVC/views/dashboard.ejs` renders a “Package Shortcuts” block.

## Compatibility rules

- Existing core/default public menu behavior remains intact.
- Compatibility package defaults are provided for known domains (PTE, School, IELTS, BenchPath, Credit).
- If a package is explicitly disabled in registry, links under its mount path are removed from public menu/options.

## Notes

- No route path changes.
- No schema changes.
- Packages can declare navigation via manifest:
  - `menuEntries[]`
  - `dashboardEntries[]`
