# School Package Pass 39: Manifest Surface Seeding (2026-06-02)

## Goal
Seed the school package manifest contract surface to match existing runtime domain artifacts and move toward PTE-like package autonomy.

## Actions completed
- Added school roles to `packages/school/package.manifest.json` using existing seeded IDs with `adoptExisting: true`.
- Added school sections used across route/controller access checks with full existing definitions and `adoptExisting: true`.
- Added school class symbols from `data/symbols.json` and marked them with `adoptExisting: true`.

## Notes
- This pass intentionally avoids adding menu/dashboard/access/upload entries yet because the corresponding data contracts are either optional for current runtime behavior or not yet consistently authored.
- Remaining parity work: evaluate whether to seed `menuEntries`, `dashboardEntries`, and `accesses` in a follow-up once product behavior demands them.

## Success signals to verify next
- Restart/reload package registry installer to confirm school manifest entity application completes without destructive section changes.
- Confirm app startup remains at `loaded=1 failed=0` and that school pages remain accessible.
