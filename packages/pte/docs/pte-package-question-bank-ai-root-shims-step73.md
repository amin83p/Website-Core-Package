# PTE Package Question-Bank AI Root Shims - Step 73

## Summary
This Pass 4 slice makes the package-owned question-bank AI helper services the active implementations. The root service files remain only as compatibility shims for older imports.

## Changes
- Moved `questionBankAiPromptRegistry` into `packages/pte/MVC/services/pte`.
- Moved `questionBankAiAutofillService` into `packages/pte/MVC/services/pte`.
- Converted the matching root service files to package compatibility shims.
- Routed package-owned autofill core file/upload dependencies through `pteCoreDependencies`.
- Extended the PTE core dependency adapter with upload-mode helper functions used by AI autofill.
- Updated service-shim regression coverage so these two services are treated as package-owned.

## Notes
- This slice keeps behavior and public imports unchanged.
- Root imports such as `MVC/services/pte/questionBankAiAutofillService` still work during transition.
- The larger PTE data services remain for later Pass 4 slices.

## Verification
- `node --check MVC/services/pte/questionBankAiPromptRegistry.js`
- `node --check MVC/services/pte/questionBankAiAutofillService.js`
- `node --check packages/pte/MVC/services/pte/questionBankAiPromptRegistry.js`
- `node --check packages/pte/MVC/services/pte/questionBankAiAutofillService.js`
- `node test/pte-package-question-bank-ai-root-shims-step73.test.js`
- `node packages/pte/test/pte-package-question-bank-ai-root-shims-step73.test.js`
- `node test/pte-package-service-shims-step19.test.js`
- `node test/pte-package-service-core-dependency-boundary-step50.test.js`
- `node test/pte-package-core-dependencies-core-adapter-step49.test.js`
- `node test/pte.ai-assist.prompt-registry.test.js`
- `node test/pte.ai-assist.autofill-private.test.js`
