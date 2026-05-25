# PTE Package Scoring Registry Root Shims - Step 72

## Summary
This Pass 4 slice makes the package-owned PTE scoring registries the active implementations. The root service files remain only as compatibility shims for older imports that still require `MVC/services/pte/...`.

## Changes
- Moved the active `questionTypeRegistry` implementation into `packages/pte/MVC/services/pte/questionTypeRegistry.js`.
- Moved the active `pteScoringRubricRegistry` implementation into `packages/pte/MVC/services/pte/pteScoringRubricRegistry.js`.
- Converted the matching root service files to package compatibility shims.
- Updated service-shim regression coverage so these two registries are treated as package-owned services.

## Notes
- This slice does not move the larger PTE student, teacher, attempt, question-bank, or scoring-engine data services yet.
- Root import paths remain loadable during the transition.
- Package registry code now owns question type definitions and rubric metadata before the heavier scoring engines are moved.

## Verification
- `node --check MVC/services/pte/questionTypeRegistry.js`
- `node --check MVC/services/pte/pteScoringRubricRegistry.js`
- `node --check packages/pte/MVC/services/pte/questionTypeRegistry.js`
- `node --check packages/pte/MVC/services/pte/pteScoringRubricRegistry.js`
- `node test/pte-package-scoring-registry-root-shims-step72.test.js`
- `node packages/pte/test/pte-package-scoring-registry-root-shims-step72.test.js`
- `node test/pte-package-service-shims-step19.test.js`
- `node test/pte.question-type-registry.scoring-contracts.test.js`
