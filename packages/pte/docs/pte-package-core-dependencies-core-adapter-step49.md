# PTE Core Dependencies Core Adapter Split (Step 49)

## Summary

Step 49 makes `packages/pte/MVC/services/pte/pteCoreDependencies.js` explicit through a dedicated core adapter module.

This keeps package modules that consume core dependencies stable even if the internal source imports of the adapter evolve.

## What Changed

- Added `packages/pte/MVC/services/pte/pteCoreDependenciesCoreAdapter.js`.
  - Centralizes all direct core service and utility imports used by package service-level code.
- Updated `packages/pte/MVC/services/pte/pteCoreDependencies.js` to delegate to the adapter:
  - `require('./pteCoreDependenciesCoreAdapter')`
- Added regression coverage:
  - `test/pte-package-core-dependencies-core-adapter-step49.test.js`

## Why

This is a continuation of the boundary hardening sequence:
- route dependency adapters,
- upload context adapters,
- helper/upload utility adapters.

The core dependency adapter keeps PTE package service entrypoints cleaner and makes future file moves safer.

## Acceptance Criteria

- `pteCoreDependencies` imports only through `pteCoreDependenciesCoreAdapter`.
- no direct `../../../../MVC/...` path remains in `pteCoreDependencies` itself.
- the adapter exposes the expected exported API used by package services.
