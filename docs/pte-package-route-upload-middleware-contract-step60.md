# PTE Route Upload Middleware Contract (Step 60)

## Summary

After migrating more PTE route submodules into package ownership, we added a focused regression test for upload storage context middleware contracts used by package routes.

## What Changed

- Added `test/pte-package-route-upload-middleware-contract-step60.test.js` to validate:
  - `questionBankRoutes.js` uses `setQuestionBankContext` as middleware references for each upload path.
  - `studentRoutes.js` applies `setStudentContext({ publicApplicant: false })` for private applicant/student uploads.
  - `publicApplicantRoutes.js` applies `setStudentContext({ publicApplicant: true })` for public applicant uploads.
  - `practiceRoutes.js` applies `setRuntimeAttemptContext('smart' | 'mock' | 'skills')` in matching runtime upload endpoints.

## Why

Upload context selection drives storage buckets used for files and affects restore/recovery behavior. A route-level contract test prevents accidental middleware signature or invocation changes from silently breaking attachment handling.

## Acceptance Criteria

- All package-owned upload routes in the tested modules use expected context middleware signatures.
- The test suite fails fast if a middleware call is removed, duplicated, or wired incorrectly.
