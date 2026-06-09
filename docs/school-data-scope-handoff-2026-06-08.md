# School Data Scope Handoff - 2026-06-08

## Checkpoint Commits Completed

- Core Package: `234c008` - `fix: improve school schedule and leave request flows`
- Core Only: `0205bde` - `fix: stabilize optional action state validation`

## Scope Implementation Completed

- Added PTE-style School read scope support.
- `schoolDataService.fetchData(...)` and `schoolDataService.getDataById(...)` now accept optional `accessContext`.
- School Classes user-facing reads now pass `{ scopeId: req.accessScope }`.
- `SCP_OWNER`, `SCP_DEPT`, `SCP_DIV`, and `SCP_USER` are treated as owner-scoped.
- `SCP_ADMIN` and `SCP_ORG` remain broad active-org scopes.
- School repository JSON and Mongo list paths now apply owner filtering when `scope.userId` is present.
- School repository create/update now stamps/preserves owner audit fields centrally.

## Files Changed In Scope Pass

- `packages/school/MVC/services/school/schoolDataScopeBuilder.js`
- `packages/school/MVC/services/school/schoolDataService.js`
- `packages/school/MVC/repositories/school/index.js`
- `packages/school/MVC/controllers/school/classController.js`

## Expected Behavior To Validate Tomorrow

- User `amir` with `SCP_OWNER` on School Classes should only see classes he created/owns.
- Changing `amir` to `SCP_ORG` should show all classes in the active organization.
- `SCP_DEPT` and `SCP_DIV` should currently behave exactly like `SCP_OWNER`.
- Admin users should remain unaffected.
- Existing old records without ownership fields may be hidden under owner-like scopes until ownership fields are backfilled.

## Validation Suggestions

- Start the app with Mongo backend.
- Log in as `amir`.
- Open School Classes and compare records against `ownerUserId`, `creator.userId`, `audit.createUser`, or `createdBy`.
- Try direct class edit/detail URLs for a class not owned by `amir`; it should be inaccessible.
- Confirm internal flows still work:
  - class enrollment
  - schedule viewer
  - approved leave schedule events
  - report/exam checks
  - transaction posting

## Notes For Next Pass

- This pass scoped School Classes first, as requested.
- Other School pages still need user-facing controller calls migrated to pass `{ scopeId: req.accessScope }`.
- Keep internal/package maintenance reads unscoped unless the operation is explicitly user-facing.
- If old class records need to appear under owner scope, run or write a Mongo backfill to set `ownerUserId` or `audit.createUser`.
