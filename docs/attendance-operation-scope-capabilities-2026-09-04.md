# Attendance Operation and Scope Capabilities

Access Profile reference | 4 September 2026

This matrix describes the effective **SCHOOL_ATTENDANCES** behavior after central access approval. Every action is rechecked against the target class, session, enrollment window, session lock, completed-session edit policy, and matrix business rules. Client-side flags improve UX but are not authoritative.

Central access returns an operation grant and a **scope** (`USER`, `OWNER`, `DEPARTMENT`/`DIVISION`, `ORGANIZATION`/`ADMIN`). Attendance then applies **class scope** through `schoolDataService.buildRouteAccessContext(req)` and `schoolRecordAccessService.isClassAccessible`. Session-level edits inside Manage Session still use **session editor scope** through `schoolRecordAccessService.isSessionAccessible` until attendance section access is promoted there (see Future Work).

## SCHOOL_ATTENDANCES Section Pages and Surfaces

| Page / Where | What user can do and see |
| --- | --- |
| **Attendance Matrix** (`/school/attendances`) | Primary attendance workspace: pick an in-scope active class, load a date window, view student-by-session cells, mark attendance, timing minutes, notes, comments, files, rollups, Excel export, and change-log queries. Route gate: `SCHOOL_ATTENDANCES` **UPDATE**. |
| **Manage Session — attendance panel** (`/school/classes/:classId/sessions/:sessionId`) | In-page roster attendance marking during session save. **Current implementation** uses `SCHOOL_SESSIONS` UPDATE + session editor scope, not `SCHOOL_ATTENDANCES`. External **Open Attendance Matrix** link uses `userCanOpenAttendanceMatrix` (`SCHOOL_ATTENDANCES` UPDATE or attendance admin). |
| **Manage Session — comments / files on roster rows** | Shared endpoints accept either `SCHOOL_ATTENDANCES` UPDATE or `SCHOOL_SESSIONS` UPDATE (`requireAccessAny`). |
| **Student Attendance Report** (`/school/attendances/report`) | Separate section **`SCHOOL_ATTENDANCE_REPORT`** (UPDATE on all report routes). Not governed by `SCHOOL_ATTENDANCES` operation rows; listed here because it is part of the attendance product surface. |
| **Legacy attendance settings redirect** (`GET/POST /school/attendances/settings`) | Redirects to **`SCHOOL_SETTINGS`** (READ_ALL / UPDATE). Matrix policy catalog is applied server-side; operational pages do not expose settings controls. |

## ADMINS And their privileges

| ADMIN | What user can do and see |
| --- | --- |
| **BUILT-IN SUPER USERS** | Not subject to access limitations. Access checks are skipped for them. The system only verifies authentication and active organization context. |
| **ADMIN GLOBAL** | Not subject to access limitations. Access checks are skipped for them. The system only verifies authentication. |
| **ADMIN GLOBAL IN ORGANIZATION** | Not subject to access limitations in the data scope of the selected organization. Access checks are skipped within that org. |
| **SCOPED ADMIN TO "GENERAL" CATEGORY** | Not subject to access limitations for sections classified in the **GENERAL** category. |
| **SCOPED ADMIN TO "GENERAL" CATEGORY IN ORGANIZATION** | Same as above, limited to the selected organization. |
| **ADMIN ACCESS TO THIS SECTION** | Not subject to access limitations on **`SCHOOL_ATTENDANCES`**. Treated as attendance section admin (`isAttendancesAdminViewerAsync`, session-lock override, completed-session attendance edit override, excuse marking). |
| **ADMIN ACCESS TO THIS SECTION IN ORGANIZATION** | Same as above, limited to the selected organization. |

Attendance section admin is resolved by `schoolAdminAccessService.isAttendancesAdminViewerAsync(user, operationId)` and `adminAuthorityService.isAdminForRequestAsync(..., SECTIONS.SCHOOL_ATTENDANCES, ...)`.

## Scope Definitions (class data layer)

After the route middleware approves an operation, attendance loads classes and sessions with `req.accessScope`:

| Scope | Class list / class-by-id (`isClassAccessible`) | Effective meaning on Attendance Matrix |
| --- | --- | --- |
| **USER** | Denied | No Access. Class picker empty; APIs return access errors for out-of-scope classes. |
| **OWNER** | Classes created by the user | Matrix limited to owned classes and their sessions. |
| **DEPARTMENT / DIVISION** (`ASSIGNMENT` mode) | Classes where the user is an active instructor, has delivered a session, or owns the class | Matrix limited to assigned teaching scope. This is the normal instructor experience. |
| **ORGANIZATION / ADMIN** (`ORG_WIDE`) | All classes in the active organization | Full org attendance matrix. |

**Note:** Attendance Matrix cell saves do not re-run session-editor checks. Any user with matrix UPDATE on an in-scope class can edit any session cell in that class subject to business guards (lock, enrollment window, makeup-required status, rolling capacity, completed-session edit window). Manage Session still requires session-editor scope for in-page saves.

## Read Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER | **Not wired to attendance routes today.** Intended: read-only matrix visibility for owned classes. Current routes require UPDATE even to open the page. |
| READ | DEPARTMENT / DIVISION | **Not wired to attendance routes today.** Intended: read-only matrix for assigned classes. |
| READ | ORGANIZATION / ADMIN | **Not wired to attendance routes today.** Intended: read-only org-wide matrix. |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | On **Attendance Matrix**: no additional admin-only manage buttons (`showAttendanceManageBtns` false). Does not grant page access without UPDATE. |
| READ_ALL | DEPARTMENT / DIVISION | On **Attendance Matrix**: if combined with UPDATE, enables attendance-admin viewer affordances (manage buttons) for assigned classes. Does not bypass class scope. |
| READ_ALL | ORGANIZATION / ADMIN | On **Attendance Matrix**: if combined with UPDATE, enables attendance-admin viewer affordances org-wide. Used by `isAttendancesAdminViewerAsync(user, READ_ALL)`. Does not bypass class scope. |

## Create Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER | No Access. |
| CREATE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Registered in section catalog; not bound to attendance HTTP routes.** Matrix roster rows can be created implicitly when marking a first cell for a student/session (`updateAttendanceRosterCell` pushes a roster record). That behavior is gated by **UPDATE**, not CREATE. |

## Update Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | On **Attendance Matrix**: can open `/school/attendances` and all matrix APIs (`/api/data`, `/api/update-roster-cell`, rollups, export, change log, active classes) for **owned** active classes only. Can mark attendance statuses enabled for the class, late/early minutes, and notes. Cannot set excuse flags unless also attendance section admin. Cannot edit locked sessions unless attendance section admin. Completed-session edits respect org `completedSessionAttendanceEdit` policy unless attendance section admin override applies. Cannot edit cells outside enrollment window, makeup-required original sessions, enrollment-office N/A locks, or rolling-capacity violations. Subject to profile limits (`maxAttempts`, `maxTimeMinutes`, `maxVolumeKB`) when configured. On **Manage Session** (current): in-page attendance save uses **`SCHOOL_SESSIONS`**, not this row. |
| UPDATE | DEPARTMENT / DIVISION | On **Attendance Matrix**: same as OWNER scope but limited to **assigned** classes (instructor, session deliverer, or owner). Primary instructor/co-teacher matrix workflow. On **Manage Session** (current): session marking uses **`SCHOOL_SESSIONS` UPDATE** with **session editor** scope (stricter than matrix class scope). |
| UPDATE | ORGANIZATION / ADMIN | On **Attendance Matrix**: full org matrix for all active classes. Can use admin-only affordances when also granted attendance admin (`READ_ALL` admin or operation/section admin flags): manage buttons, session-lock override, completed-session attendance edit override, excuse marking (`userCanMarkAttendanceExcused`). On **Manage Session**: can open Attendance Matrix link (`userCanOpenAttendanceMatrix`); in-page attendance still **`SCHOOL_SESSIONS`** today. Attendance admin override for completed-session attendance edits uses `SCHOOL_ATTENDANCES` UPDATE admin (`canOverrideAttendanceEdit`). |

### UPDATE — shared matrix capabilities (all non-USER scopes)

When UPDATE is granted and class scope passes:

- Load matrix payload and post cell updates.
- Post attendance comments and upload roster files (also allowed with **`SCHOOL_SESSIONS` UPDATE** on the same endpoints).
- Recompute rollups and export Excel (`.xlsx`).
- Query attendance change logs.
- List active classes for picker (`/api/active-classes`).

### UPDATE — business guards (all scopes)

These apply after access approval:

| Guard | Behavior |
| --- | --- |
| Session locked | Blocked unless attendance section admin (`SCHOOL_ATTENDANCES` UPDATE admin). |
| Completed session edit window | Enforced by `sessionAttendanceEditAccessService.assertSessionAttendanceEditable`; attendance admin can override. |
| Makeup-required session status | Original session forced N/A; edits blocked with redirect-to-makeup message. |
| Enrollment window | Student/session combination outside enrollment dates → N/A; edits blocked. |
| Enrollment-office N/A lock | Blocked unless **`SCHOOL_CLASSES` UPDATE** class admin (`assertEnrollmentLockedAttendanceEditable`). |
| Rolling enrollment capacity | Adding roster via first mark blocked when capacity rules fail. |
| Enabled attendance statuses | Class/org policy may restrict which marks can be saved. |

## Delete Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER | No Access. |
| DELETE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Registered in section catalog; not bound to attendance HTTP routes.** Matrix does not expose row delete. Clearing a cell uses UPDATE to empty/N/A states, not DELETE. |

## Delete All Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE_ALL | USER | No Access. |
| DELETE_ALL | OWNER / DEPARTMENT / DIVISION | No Access (not implemented on attendance surfaces). |
| DELETE_ALL | ORGANIZATION / ADMIN | **Registered in section catalog; not bound to attendance HTTP routes.** No bulk attendance wipe UI. |

## Configure Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE / CONFIGURED | USER | No Access. |
| CONFIGURE / CONFIGURED | OWNER / DEPARTMENT / DIVISION | No Access on operational attendance pages. |
| CONFIGURE / CONFIGURED | ORGANIZATION / ADMIN | **Not wired to `SCHOOL_ATTENDANCES` routes.** Org matrix policy catalog, mark appearance, and completed-session edit policies are maintained under **`SCHOOL_SETTINGS`** and related policy models. Matrix **consumes** policy via `attendanceMatrixPolicyModel.getPolicyCatalogForOrg` without exposing configure UI. |

## Export Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| EXPORT | USER | No Access. |
| EXPORT | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Registered in section catalog; Excel export is currently gated by UPDATE.** `GET /school/attendances/api/export.xlsx` requires `SCHOOL_ATTENDANCES` UPDATE. Intended future split: EXPORT without UPDATE for read-only exports. Student Attendance Report export uses **`SCHOOL_ATTENDANCE_REPORT` UPDATE**. |

## Import Access in Access Profile Definitions

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| IMPORT | USER | No Access. |
| IMPORT | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **Registered in section catalog; not implemented.** No attendance bulk-import route. |

## Operation Summary — catalog vs routes

| Operation | OP id | Registered on `SCHOOL_ATTENDANCES` | Bound to attendance routes today | Primary surface |
| --- | --- | --- | --- | --- |
| CREATE | OP1001 | Yes | No (implicit roster create via UPDATE) | Matrix cell first mark |
| READ | OP1002 | Yes | No | — |
| READ_ALL | OP1003 | Yes | Partial (admin viewer UI only) | Matrix manage buttons; excuse admin checks |
| DELETE | OP1004 | Yes | No | — |
| UPDATE | OP1005 | Yes | **Yes (primary gate)** | Matrix page, APIs, comments/files |
| CONFIGURE | OP1006 | Yes | No | Settings / policy models |
| CONFIGURED | OP1010 | Yes | No | Settings / policy models |
| EXPORT | OP1012 | Yes | No (uses UPDATE) | Matrix Excel export |
| IMPORT | OP1013 | Yes | No | — |
| DELETE_ALL | OP1022 | Yes | No | — |

## Manage Session vs Attendance Matrix (current split)

| Capability | Attendance Matrix (`SCHOOL_ATTENDANCES`) | Manage Session in-page (current) |
| --- | --- | --- |
| Route section | `SCHOOL_ATTENDANCES` | `SCHOOL_SESSIONS` |
| Scope unit | Class (`isClassAccessible`) | Session editor (`isSessionAccessible`, `manageSession`) |
| Mark attendance | Yes (`/api/update-roster-cell`) | Yes (`saveSession` roster payload) |
| Excuse flags | Attendance section admin only (`userCanMarkAttendanceExcused`) | Class admin (`canOverride` / `SCHOOL_CLASSES` UPDATE admin) |
| Session lock override | Attendance section admin | Class admin for metadata; attendance admin for attendance edit window |
| Completed-session edit override | Attendance section admin | Class admin **or** attendance section admin (`canOverrideAttendanceEdit`) |
| Open matrix link | N/A | `userCanOpenAttendanceMatrix` |

This split is the main reason to **promote** `SCHOOL_ATTENDANCES` operations and scopes into Manage Session after this reference is approved.

## HTTP Route Reference (`SCHOOL_ATTENDANCES`)

| Method | Path | Operation gate | Notes |
| --- | --- | --- | --- |
| GET | `/school/attendances` | UPDATE | Matrix page |
| GET | `/school/attendances/api/data` | UPDATE | Matrix payload |
| POST | `/school/attendances/api/update-roster-cell` | UPDATE | Cell save + change log |
| POST | `/school/attendances/api/rollups` | UPDATE | Rollup recompute |
| GET | `/school/attendances/api/export.xlsx` | UPDATE | Excel export |
| GET | `/school/attendances/api/active-classes` | UPDATE | Class picker |
| POST | `/school/attendances/api/comment` | UPDATE (ATTENDANCES **or** SESSIONS) | Roster comment |
| POST | `/school/attendances/api/files/upload` | UPDATE (ATTENDANCES **or** SESSIONS) | Roster file |
| GET | `/school/attendances/api/change-log` | UPDATE | Change log |
| POST | `/school/attendances/api/change-log/query` | UPDATE | Change log query |

Mount: `packages/school/MVC/routes/attendanceRoutes.js`.

## Client-side capability flags (Attendance Matrix)

| Flag | Source | Effect |
| --- | --- | --- |
| `canEditAttendanceRoster` | `SCHOOL_ATTENDANCES` UPDATE evaluation | Enables cell editing UI |
| `isAttendanceAdminViewer` | `READ_ALL` admin on `SCHOOL_ATTENDANCES` | Shows admin manage buttons |
| `canMarkAttendanceExcused` | `userCanMarkAttendanceExcused` (attendance admin) | Excuse toggles and excuse notes |
| `canOverrideSessionLock` | `SCHOOL_ATTENDANCES` UPDATE admin | Edit locked sessions in UI |
| `attendanceActionLimits` | Profile limits on UPDATE | Throttles volume/time/attempts |

View: `packages/school/MVC/views/school/attendance/attendanceViewer.ejs`.

## Verification coverage (existing tests)

| Test file | What it guards |
| --- | --- |
| `test/attendance-matrix-class-scope.test.js` | Route access context on class load/save |
| `test/attendance-matrix-policy-access.test.js` | Admin viewer buttons, matrix link vs settings, excuse admin-only |
| `test/attendance-matrix-session-edit-guards.test.js` | Session edit guards |
| `test/attendance-excel-export.test.js` | Export route gate |
| `packages/school/test/attendance-change-log.test.js` | Change log on cell save |
| `test/school-package-ownership-pass7.test.js` | Route ownership patterns |

## Implementation references

| Concern | Location |
| --- | --- |
| Routes | `packages/school/MVC/routes/attendanceRoutes.js` |
| Controller | `packages/school/MVC/controllers/school/attendanceController.js` |
| Matrix access helpers | `packages/school/MVC/services/school/attendanceMatrixAccessService.js` |
| Attendance admin | `packages/school/MVC/services/school/schoolAdminAccessService.js` |
| Class scope | `packages/school/MVC/services/school/schoolRecordAccessService.js`, `schoolDataService.buildRouteAccessContext` |
| Completed-session windows | `packages/school/MVC/services/school/sessionAttendanceEditAccessService.js` |
| Manage Session integration | `packages/school/MVC/controllers/school/classController.js` (`manageSession`, `saveSession`) |
| Section catalog | `data/sections.json` (`SCHOOL_ATTENDANCES`, id `778768`) |

## Future work — promote attendance access to Manage Session

Planned alignment after Access Profile updates:

1. Gate Manage Session in-page attendance marking on **`SCHOOL_ATTENDANCES` UPDATE** (plus existing session editor scope where appropriate).
2. Wire **READ** for read-only matrix viewing without UPDATE; keep **UPDATE** for mutations.
3. Bind **EXPORT** to Excel export separately from UPDATE.
4. Align excuse marking on Manage Session with **`userCanMarkAttendanceExcused`** (attendance admin), not only class admin.
5. Use **`SCHOOL_ATTENDANCES` READ_ALL** for attendance-admin viewer tools consistently across matrix and Manage Session.
6. Add route tests when CREATE/DELETE/IMPORT/DELETE_ALL/CONFIGURE gain real endpoints.

Until promotion is implemented, treat this document as the **target** matrix for `SCHOOL_ATTENDANCES` and the Manage Session table above as **current runtime behavior**.
