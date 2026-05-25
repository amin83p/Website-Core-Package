# PTE Package View And Asset Ownership (Step 22)

Step 22 prepares PTE views and public assets for package ownership while keeping current runtime behavior stable.

## What Changed

- Copied the current PTE EJS view tree into `packages/pte/MVC/views/pte`.
- Copied `public/scripts/ptePracticeCoachRules.js` into `packages/pte/public/scripts`.
- Updated the PTE package manifest view declaration to `packages/pte/MVC/views`.
- Updated the PTE package manifest asset declaration to `packages/pte/public/scripts`.
- Kept PTE package assets `metadataOnly: true`, so `/scripts` is not mounted a second time by the package loader.
- Added regression coverage that compares package-local PTE views/assets with the current root copies.

## Compatibility Behavior

- Runtime `/pte` traffic still comes from the hardcoded route mount.
- Existing controllers still render `pte/...` view names.
- The core view root remains registered first, so current root views keep taking precedence while both copies exist.
- `/scripts/ptePracticeCoachRules.js` continues to be served by the existing app static middleware.

## Why This Matters

PTE now has package-local view and public script ownership ready for the physical move. The root copies remain active for compatibility, and the package copies are protected by tests so changes to PTE UI files are not silently lost during the transition.

## Remaining Work

- Step 23 mapped PTE scripts, migrations, seeders, docs, and package-local tests into package-owned target folders.
- Decide when to switch the app from root-first view resolution to package-first or package-only resolution for PTE.
- Keep `/scripts` asset mounting unchanged until duplicate static mount behavior is explicitly tested and the root public script copy can be retired.
