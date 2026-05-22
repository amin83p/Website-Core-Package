# PTE Preparation Step 9

Date: 2026-05-22

## Goal

Make PTE logically package-ready while preserving the existing MVC file locations and all current `/pte` URLs.

## Completed In This Step

- Replaced the sample `packages/pte/package.manifest.json` declarations with real compatibility declarations for the current PTE surface:
  - PTE routes as metadata-only declarations.
  - PTE role keys.
  - PTE sections and symbols.
  - Existing PTE applicant access profile.
  - PTE upload folder definitions and defaults.
  - Public menu and dashboard entries.
- Added `scripts/packages/enable-pte-package.js`.
  - Default mode is dry-run.
  - `--apply` upserts `pte` into the package registry as enabled.
  - The script reads the manifest version and declaration metadata instead of editing `data/packageRegistry.json` by hand.
- Moved `/pte/join` ownership out of the core person controller:
  - `MVC/controllers/pte/publicJoinController.js`
  - `MVC/services/pte/ptePublicJoinService.js`
- Extracted reusable public person/user registration helpers into:
  - `MVC/services/person/publicRegistrationService.js`
- Kept generic `/persons/join` in `personController`, now backed by the shared registration service.

## Preserved Behavior

- `/pte`, `/pte/join`, `/pte/packages`, `/pte/dashboard`, and existing PTE subroutes remain mounted through `MVC/routes/pte/pteMainRoute.js`.
- Logged-in users can still join public PTE with the same account and receive `pte_student_public`.
- Users who already have public PTE access are recognized without rewriting person/user records.
- Guest PTE join still creates person, user, and public applicant records through the same public registration behavior.
- Physical upload paths and `/uploads/...` URLs are unchanged.

## Remaining For Step 10

- Physically move PTE files into `packages/pte` only after the logical boundaries remain stable.
- Replace hardcoded `/pte` app mounting with package route loader support.
- Move PTE package registry declarations out of core seed/state expectations once install/uninstall flows are ready.
- Continue reducing core references to package-specific constants where the package loader can provide them.
- Decide how package-owned upload folder definitions should be installed, disabled, and removed in a full uninstall.

## Useful Commands

```bash
node scripts/packages/enable-pte-package.js
node scripts/packages/enable-pte-package.js --apply
node test/pte-package-step9.test.js
```
