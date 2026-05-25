# PTE Controller Core Dependency Completion (Step 64)

## Summary

The PTE controller dependency adapter pass is now complete for remaining domains that were still resolving to missing core modules.

## What Changed

- Added core adapter files under `MVC/controllers/pte`:
  - `attemptControllerCoreDependencies.js`
  - `feedbackControllerCoreDependencies.js`
  - `infoControllerDependencies.js`
  - `mockExamControllerDependencies.js`
  - `practiceControllerDependencies.js`
  - `publicJoinControllerCoreDependencies.js`
  - `publicPageSettingsControllerDependencies.js`
  - `questionBankControllerDependencies.js`
  - `studentControllerCoreDependencies.js`
  - `userDashboardControllerCoreDependencies.js`

- Updated `packages/pte/MVC/controllers/*Dependencies.js` and `.../*CoreDependencies.js` shims to point at the MVC core counterparts.
- Added regression test `test/pte-package-controller-core-dependencies-step64.test.js` to verify:
  - Package dependency files delegate to core targets.
  - Delegating files are loadable.
  - Expected core adapter files exist.

## Why

This removes missing require paths introduced while moving package dependency shims to core-owned modules and keeps package controllers dependent on core-owned adapter layers.

## Acceptance Criteria

- Package controller dependency files for feedback, mock exam, practice, student, question bank, info, public join, public page settings, and user dashboard resolve correctly.
- Core adapters contain practical dependency exports required by corresponding package controllers.
- Regression test confirms delegation and file existence.
