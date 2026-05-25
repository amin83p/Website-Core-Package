# PTE Repository Core Dependency Boundary (Step 53)

## Summary

Step 53 extends boundary regression coverage to package repository files.

## What Changed

- Added `test/pte-package-repository-core-dependency-boundary-step53.test.js` which:
  - scans `packages/pte/MVC/repositories/*.js`,
  - allows one-line repository shims by default,
  - allows `pteAiRepositoryDependencies.js` as the explicit repository dependency adapter,
  - fails for unauthorized deep core imports in repository implementations.

## Why

Repositories are another major coupling seam. This keeps extraction-ready package ownership clear and ensures deep core access remains controlled through dedicated adapter files.

## Acceptance Criteria

- Repository-level files are either pure shims or package-owned adapters.
- New direct deep imports into core from package repositories are caught immediately.
- Existing repository behavior remains unchanged.
