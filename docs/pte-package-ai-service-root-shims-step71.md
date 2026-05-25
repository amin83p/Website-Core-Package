# PTE Package AI Service Root Shims - Step 71

## Summary
This Pass 4 slice makes the package-owned PTE AI Assist services and repositories the active implementations. The legacy root files remain as compatibility shims for older imports and tests that still require `MVC/services/pte/...` or `MVC/repositories/...`.

## Changes
- Converted root PTE AI Assist data services to package compatibility shims:
  - `pteAiProviderDataService`
  - `pteAiScoringSettingsDataService`
  - `pteAiTokenUsageDataService`
- Converted root PTE AI provider facade and provider adapters to package compatibility shims.
- Converted root PTE AI repositories to package compatibility shims so root-import tests and package services share the same repository objects.
- Added regression coverage to verify the root AI service/repository shims export the matching package-owned modules.

## Notes
- This slice does not move the broader PTE scoring, question-bank, student, teacher, course, or attempt services yet.
- Package AI services continue to use package-local core dependency adapters rather than copying core services.
- Existing root import paths remain loadable during the package transition.

## Verification
- `node test/pte-package-ai-service-root-shims-step71.test.js`
- `node test/pte-package-model-repository-shims-step20.test.js`
- `node test/pte-package-service-shims-step19.test.js`
- `node test/pte-package-service-core-dependency-boundary-step50.test.js`
- `node test/pte.ai-scoring-settings-service.test.js`
- `node test/pte.ai-assist.prompt-registry.test.js`
- `node test/pte.ai-assist.autofill-private.test.js`
