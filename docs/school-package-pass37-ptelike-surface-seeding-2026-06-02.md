# School Package Pass 37: PTE-Like Surface Seeding (2026-06-02)

## Goal
Record and wire the school package operational surface in support metadata so future work can execute package-like scripts and tests the way PTE does.

## Actions completed
- Added package-support script inventory for school maintenance/migration/activation scripts.
- Added package-support test inventory for school ownership/runtime verification tests.
- Kept runtime behavior unchanged; this pass is about package lifecycle tooling parity.

## New support artifacts
- `packages/school/package.support-files.json`
  - `step` advanced to `37`.
  - `status` set to `surface-seeded`.
  - `scripts` list now includes school script artifacts with `root-active` entrypoint mode intent.
  - `tests` list now includes school ownership/runtime verification tests as root-owned checks.

## Remaining gaps to full PTE-like parity
- Package-local script/test file copies are not required for this pass; next pass should create mirrored artifacts only when execution paths depend on them.
- Manifest-level contract expansion remains pending (roles/sections/symbols/accesses/menu/dashboard upload scopes) and should be handled in subsequent passes once the operational surface is stable.
