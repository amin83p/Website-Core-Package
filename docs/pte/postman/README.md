# PTE Attempt Runtime Postman Set

Files:
- `pte-attempt-runtime.postman_collection.json`
- `pte-attempt-runtime.local.postman_environment.json`

Run order:
1. `00 Bootstrap Action Token (GLOBAL_SCOPE)`
2. `01 Start Runtime Session (test_run)`
3. `02 Bootstrap Action Token (SESSION_SCOPE)`
4. `03 Runtime Item Start`
5. `04 Runtime Item Save`
6. `05 Runtime Item Submit`
7. `06 Runtime Item Score`
8. `07 Runtime Item Feedback`
9. `08 Runtime Session Submit`
10. `09 Runtime Session Detail`
11. `10 Runtime Analytics (Me)`

Notes:
- Set `testVersionId` first (published PTE test version).
- Login first so Postman has an authenticated session cookie for your app domain.
- Requests include `actionStateId` and idempotency keys required by middleware.
- Session and item IDs are auto-captured from the start response.
