# PTE Upload Middleware Boundary (Step 42)

## Summary

This step locks the upload context middleware into package-local upload primitives so it does not
couple directly to hard-coded bucket strings.

## What Changed

- Added regression coverage in `test/pte-package-upload-middleware-step42.test.js`.
- The test verifies that `packages/pte/MVC/middleware/pteUploadContextMiddleware.js` uses:
  - `../utils/pteUploadPathUtils` import.
  - `PTE_BUCKETS` constants for all upload branches.
  - No raw bucket string literals such as `Practice_By_Skills`, `Mock_Exams`, or `Smart_Practice`.

## Why

This keeps upload behavior explicit and package-owned, reducing coupling risk when upload bucket naming or storage contexts are migrated.

## Acceptance Criteria

- Upload middleware continues to support the same request modes and behaviors.
- Bucket usage goes through package constants (`pteUploadPathUtils.PTE_BUCKETS`).
- Raw hard-coded bucket tokens are removed from middleware logic.
