# PTE AI Assist Decryption Boundary (Step 36)

## What Changed

- Added an AI provider repository capability to retrieve decrypted provider API keys through the package repository boundary:
  - `packages/pte/MVC/repositories/pteAiProviderRepository.js`
    - New method: `getDecryptedApiKeyById`
    - Added internal helper: `resolveApiKeyFromProviderRecord`
- Extended repository dependency facade:
  - `packages/pte/MVC/repositories/pteAiRepositoryDependencies.js`
    - Added re-export of `decrypt`
- Updated `PTE AI provider data service` to consume repository API for key decryption:
  - `packages/pte/MVC/services/pte/pteAiProviderDataService.js`
    - Removed direct provider model dependency for key loading.
    - `loadDecryptedApiKeyForProviderRecord()` now calls
      `pteAiProviderRepository.getDecryptedApiKeyById(...)`.

## Why

This removes one remaining direct core-model-path read path from the AI Assist service layer and keeps
key decryption behavior behind package repository utilities already designed for JSON/Mongo parity.

## Added Test

- `test/pte-package-ai-assist-decryption-core-bridge-step36.test.js`
  - Verifies repository-boundary behavior for decrypted provider-key loading.
  - Ensures the service no longer requires `packages/pte/MVC/models/pte/pteAiProviderModel` directly.
  - Ensures repository gets `decrypt` via dependency adapter.

## Next Step

- Continue AI Assist boundary hardening for any other service code that reads core-owned domain records
  directly instead of going through package-local repository/dependency adapters.
