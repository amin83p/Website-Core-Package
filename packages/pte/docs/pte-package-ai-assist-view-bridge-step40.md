# PTE AI Assist View Bridge (Step 40)

## Summary

This step hardens package-side PTE EJS partial dependencies so package views do not import core partials directly through hardcoded relative paths.

## What Changed

- Added package-local partial bridge files under `packages/pte/MVC/views/partials`:
  - `modal.ejs`
  - `modal_AudioPreview.ejs`
  - `modal_GenericPicker.ejs`
  - `modal_ImageViewer.ejs`
  - `modal_MediaManager.ejs`
  - `pagination.ejs`
  - `tablePages-end.ejs`
  - `tablePages-search.ejs`
  - `tablePages-start.ejs`
- Each bridge delegates to the equivalent core partial in `views/partials` via `include('../../../../views/partials/...')`.
- Added regression test:
  - `test/pte-package-ai-assist-view-partials-step40.test.js`

## Why

PTE package views currently use `../../partials/...` includes. Without a local partial surface, those views are coupled to root partial resolution. The bridge files keep package view usage stable while the runtime remains compatible and no behavior changes are introduced.

## Acceptance

- Package-side PTE views that include `../../partials/...` can resolve those includes from the package partial bridge directory.
- Each bridge file delegates to an existing core partial.


> Note (Step 61): Bridge files were intentionally replaced with direct core partial references for installable-package boundaries. See pte-package-view-core-partials-direct-step61.md.
