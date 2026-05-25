# PTE Package Core Partial Dependency Direction (Step 61)

## Summary

Packages should not own or duplicate framework core partials/middlewares. PTE views are now updated to consume core partials directly from the core framework through explicit include paths, and package-local partial bridge files under `packages/pte/MVC/views/partials` were removed.

## What Changed

- Updated package PTE EJS views in `packages/pte/MVC/views/pte` to replace `../../partials/...` with:
  - `../../../../../../MVC/views/partials/...`
- Removed package-local partial bridge files:
  - `packages/pte/MVC/views/partials/modal.ejs`
  - `packages/pte/MVC/views/partials/modal_AudioPreview.ejs`
  - `packages/pte/MVC/views/partials/modal_GenericPicker.ejs`
  - `packages/pte/MVC/views/partials/modal_ImageViewer.ejs`
  - `packages/pte/MVC/views/partials/modal_MediaManager.ejs`
  - `packages/pte/MVC/views/partials/pagination.ejs`
  - `packages/pte/MVC/views/partials/tablePages-end.ejs`
  - `packages/pte/MVC/views/partials/tablePages-search.ejs`
  - `packages/pte/MVC/views/partials/tablePages-start.ejs`
- Updated regression test to validate direct core-partial references and to ensure no local partial bridge directory is present:
  - `test/pte-package-ai-assist-view-partials-step40.test.js`

## Why

This removes package-side copies for view fragments that are part of core infrastructure and keeps package code dependent on framework-supplied partials, matching installable-package behavior.

## Acceptance Criteria

- Package PTE view files should include core partials via `MVC/views/partials` paths.
- `packages/pte/MVC/views/partials` should not exist.
- Regression test should fail if package views again include `../../partials/*`.
