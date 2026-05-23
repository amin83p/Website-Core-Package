# PTE Package Enable Script (Step 25)

Step 25 converts the package-local PTE activation script from a delegate wrapper into a package-safe implementation.

## What Changed

- Replaced `packages/pte/scripts/maintenance/enable-pte-package.js` with a real implementation.
- The package-local script now reads `packages/pte/package.manifest.json` directly.
- The package-local script keeps the same dry-run default and `--apply` behavior as the root script.
- `packages/pte/package.support-files.json` now marks this entrypoint as `package-safe`.
- Added regression coverage for package-local dry-run and idempotent apply behavior.

## Compatibility Behavior

- The root script `scripts/packages/enable-pte-package.js` remains active and unchanged.
- The package-local script writes the same registry payload shape, except `metadata.activatedBy` identifies the package-local script.
- No registry data is written unless `--apply` is passed.

## Remaining Work

- Convert non-destructive seeders or validation scripts into package-safe implementations next.
- Keep destructive maintenance scripts delegated until their safety prompts and environment assumptions are reviewed.
- Consider extracting shared activation helper logic if both root and package-local activation scripts need to remain long term.

