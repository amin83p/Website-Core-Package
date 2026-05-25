# PTE Route Upload-Context Invocation (Step 59)

## Summary

Route ownership is now in `packages/pte/MVC/routes/questionBankRoutes.js`, and we validated that
`setQuestionBankContext` is wired as a direct middleware reference in each upload route.

## What Changed

- Added regression test coverage for `packages/pte/MVC/routes/questionBankRoutes.js` to verify:
  - `pteUploadContext.setQuestionBankContext` is present exactly for the three upload routes.
  - The middleware is mounted as a function reference (not as `setQuestionBankContext()`).
- Added regression test:
  - `test/pte-package-route-upload-context-invocation-step59.test.js`

## Why

Package routes should be fully runnable through the adapter layer. This fix prevents subtle upload-context regressions when files are uploaded via question bank routes.

## Acceptance Criteria

- All question-bank upload routes pass `setQuestionBankContext` as middleware.
- Regression test confirms all references are mounted correctly as middleware references.
