# PTE AI Assist Core Bridges (Step 31)

## What Changed

- Added package-local core adapter modules used by package-owned AI Assist services and controllers:
  - `packages/pte/MVC/services/pte/pteCoreDependencies.js`
  - `packages/pte/MVC/controllers/pte/coreHelpers.js`
- Updated AI Assist package services to use the service adapter:
  - `packages/pte/MVC/services/pte/pteAiProviderDataService.js`
  - `packages/pte/MVC/services/pte/pteAiScoringSettingsDataService.js`
  - `packages/pte/MVC/services/pte/pteAiTokenUsageDataService.js`
- Updated AI Assist package controllers to use package-local controller helper:
  - `packages/pte/MVC/controllers/aiProviderController.js`
  - `packages/pte/MVC/controllers/aiTokenUsageController.js`

## Why This Matters

This reduces repetitive direct root path imports across AI Assist package modules and keeps a dedicated extension point for future package/core migration work. Runtime behavior remains unchanged because all adapter methods forward to existing core services and utilities.

`isAjax` is now also surfaced through `coreHelpers` so AI Assist controllers avoid local helpers and share the same core boundary behavior.

## Test Coverage

- Added `test/pte-package-ai-assist-core-bridge-step31.test.js` to verify:
  - package AI Assist services/controllers consume their local adapter helpers,
  - service/controller helper modules expose expected facades.

## Follow-up

- Continue widening this pattern to additional package-owned modules outside AI Assist.
