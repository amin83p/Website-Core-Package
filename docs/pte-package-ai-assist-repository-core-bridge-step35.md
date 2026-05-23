# PTE AI Assist Repository Core Bridge (Step 35)

## What Changed

- Added package-local repository adapter:
  - `packages/pte/MVC/repositories/pteAiRepositoryDependencies.js`
- Updated AI Assist repositories to consume package-local dependencies:
  - `packages/pte/MVC/repositories/pteAiProviderRepository.js`
  - `packages/pte/MVC/repositories/pteAiScoringSettingRepository.js`
  - `packages/pte/MVC/repositories/pteAiTokenUsageRepository.js`
- Added regression test:
  - `test/pte-package-ai-assist-repository-core-bridge-step35.test.js`

## Why

This keeps AI Assist repository code aligned with the package-boundary strategy used in
services/controllers: package-owned modules should consume core dependencies through package-local
adapter shims rather than deep core `../../../../MVC/...` imports.

## Acceptance

- AI Assist repository files only reference `./pteAiRepositoryDependencies` for cross-cutting core services.
- Existing repository behavior remains unchanged.
- Step 35 test validates direct-require replacement behavior.

## Next Step

Continue hardening additional package-owned utility modules that still bind directly to core paths (as needed).
