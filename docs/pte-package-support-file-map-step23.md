# PTE Package Support File Map (Step 23)

Step 23 maps PTE support files before moving them into the package.

## What Changed

- Added `packages/pte/package.support-files.json`.
- Mapped PTE seed scripts, migrations, maintenance scripts, docs, Postman files, and tests to intended package-owned paths.
- Left all mapped files root-active for now.
- Added regression coverage so new root-active PTE support files must be added to the package map.

## Compatibility Behavior

- No script, migration, doc, or test file was moved in this step.
- Existing commands and test paths remain unchanged.
- The package support map is metadata only. It is not executed by the package loader or installer yet.

## Why This Matters

The remaining PTE files outside the MVC and public asset trees are now visible in one package-owned map. This gives the physical move a checklist and prevents new PTE support files from being forgotten while the package is still split across root and `packages/pte`.

## Remaining Work

- Convert mapped scripts into package-safe scripts with adjusted imports before copying or moving them.
- Decide which docs should remain project-level handover docs and which should become package docs.
- Move PTE tests only after their fixtures and imports can run from package-local paths.

