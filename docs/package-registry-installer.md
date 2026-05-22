# Package Registry Installer (Step 5)

This step adds a compatibility-first installer layer that applies package declarations into core registries without changing public routes/payload contracts.

## Scope

For each enabled package manifest, the installer can process:

- `operations`
- `roles`
- `sections`
- `symbols`
- `accesses`
- `uploadFolders` (definition registration + default value write into `app.uploadFolders`)

## Implementation

- Service: `MVC/services/packageRegistryInstallerService.js`
- App wiring: startup loader hooks in `app.js` now call installer hooks during package load.
- Loader context now carries `backendMode` into hooks (`MVC/services/packageLoaderService.js`).

## Ownership + Safety Rules

- Existing records already owned by another package are skipped.
- Unmanaged existing rows are skipped by default.
- Explicit adoption is supported per declaration with `adoptExisting: true`.
- System-protected rows (such as system roles/operations) are not force-updated.

## Upload Folder / Default Path Integration

`manifest.uploadFolders[]` supports:

- registering new folder definition keys (when `defaultTemplate` is provided for unknown keys),
- applying configured/default folder templates into persisted settings,
- writing values under existing settings key: `app.uploadFolders`.

This ensures package installation can seed **Default File Paths** behavior in core settings.

## Notes

- No DB schema changes.
- No API payload changes for existing modules.
- Behavior is idempotent for already-owned declarations (creates once; subsequent runs skip or update safely).
- A real sample package manifest is included at `packages/pte/package.manifest.json` to exercise declaration and default-path installation in tests.
