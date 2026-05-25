# PTE Package Role Registry Step 67

Step 67 removes another core tie from the PTE package preparation roadmap.

## Change

- PTE system role seed rows are now discovered from `packages/pte/package.manifest.json`.
- Core `roleRegistryService` still provides built-in core/school/credit fallback rows, but no longer hardcodes PTE role keys or aliases in its legacy seed constants.
- `personModel` fallback tag constants no longer hardcode PTE role keys. Runtime behavior still resolves PTE role tags through the role registry snapshot, which now includes package manifest role declarations.

## Why

PTE roles are package-owned declarations. Keeping them in the PTE manifest allows package installation, adoption, and future physical package moves to use one source of truth.

## Verification

- `test/pte-package-role-registry-step67.test.js`
- Existing PTE student role migration coverage still verifies `pte_student` alias behavior.
