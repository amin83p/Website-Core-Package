# PTE Package Upload Context Middleware (Step 56)

## Summary

Step 56 adds focused regression coverage for `packages/pte/MVC/middleware/pteUploadContextMiddleware`.

## What Changed

- Added `test/pte-package-upload-context-middleware-step56.test.js` to verify:
  - question bank storage context sets `PTE_BUCKETS.QUESTION_BANK`
  - student/public-applicant storage context sets the expected bucket
  - runtime attempt middleware sets fallback context safely when session id is missing

## Why

Upload-context middleware is frequently used across PTE routes and is central to file path behavior.
This test set guarantees the context shape stays stable so subsequent refactors to the package
dependency layer do not regress runtime behavior.

## Acceptance Criteria

- `setQuestionBankContext`, `setStudentContext`, and `setRuntimeAttemptContext` keep writing deterministic storage context values.
- Fallback behavior avoids runtime DB dependency when a session id is not supplied.
