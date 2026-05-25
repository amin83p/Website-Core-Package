# PTE Package AI Provider Ownership (Step 30)

## What Changed

- Promoted AI Assist provider runtime into package-owned implementations:
  - `packages/pte/MVC/services/pte/ai/aiProviderService.js`
  - `packages/pte/MVC/services/pte/ai/providers/openaiService.js`
  - `packages/pte/MVC/services/pte/ai/providers/anthropicService.js`
  - `packages/pte/MVC/services/pte/ai/providers/azureOpenAIService.js`
  - `packages/pte/MVC/services/pte/ai/providers/googleGeminiService.js`
  - `packages/pte/MVC/services/pte/ai/providers/googleVertexService.js`
- Added AI provider code as package-owned code so it no longer delegates to core ielts implementations.
- Updated `test/pte-package-service-shims-step19.test.js`:
  - Marked AI provider files as package-owned exceptions to shim checks.
  - Removed `ai/aiProviderService.js` from representative cross-reference identity check, since it is now independently implemented in the package.

## Compatibility Behavior

- Package AI assistant behavior remains unchanged for `/pte/ai-assisst/*` flows.
- External integration remains backward-compatible; route mounting and other dependencies are untouched.
- The package service tree still coexists with root services; the hardcoded `/pte` mount still points to `MVC/routes/pte/pteMainRoute.js`.

## Why It Matters

- This reduces remaining direct runtime coupling to `MVC/services/ielts/ai/providers/*` in package-boundary layers.
- It keeps the package's AI Assist execution path functional even if the root ielts service layer is reorganized later.

## Remaining Work

- Keep package ownership tests focused on behavior parity for AI provider responses (especially model listing/selection fallback and token parsing paths).
- Plan next package step around remaining shared utility dependencies in AI Assist providers if new core primitives are introduced.
