# Manage Session Access Architecture Reference

Date: 2026-09-04

## Purpose and Status

This document is the working access reference for the **Manage Session** page (`/school/classes/:classId/sessions/:sessionId`). It describes how requests are validated, which Access Profile sections apply to each sub-feature, and how session scope narrows generic RBAC to a specific class session.

The most important distinction is this:

1. The central access system decides whether an actor has an allowed operation on a section (`SCHOOL_SESSIONS`, `SCHOOL_SESSION_STUDENT_CASES`, and so on).
2. Manage Session then decides whether the actor may act on **this specific session** (assignment/owner scope, instructional state, completed-session edit windows, and feature-specific row filters).

Manage Session is **not** a single-section page. Most instructional edits inherit **`SCHOOL_SESSIONS` + session editor scope**. Sub-features that have their own catalog sections add a **second route gate** and sometimes a **third target check** (report row visibility, case routing, book-covering scope).

## Manage Session at a Glance

| Area | Current design |
| --- | --- |
| Page route | `GET /school/classes/:id/sessions/:sessionId` |
| Primary section | `SCHOOL_SESSIONS` |
| Primary view | `packages/school/MVC/views/school/class/sessionManager.ejs` |
| Primary controller | `packages/school/MVC/controllers/school/classController.js` (`manageSession`, `saveSession`, and related handlers) |
| Session scope service | `packages/school/MVC/services/school/schoolRecordAccessService.js` |
| Completed-session edit windows | `packages/school/MVC/services/school/sessionAttendanceEditAccessService.js` |
| Route mount | `packages/school/MVC/routes/classRoutes.js` (session execution routes) |
| CSRF / action state | `trackActionState` mints tokens per section/operation on mutating routes |

## Access Decision Flow

```text
HTTP request
        |
        v
Authentication (requireAuth on /school routes)
        |
        v
Route middleware: requireAccess(section, operation)
        |
        v
trackActionState (CSRF token for mutating routes)
        |
        v
Controller handler
        |
        v
Class access: getClassByIdWithOrgCheck + buildRouteAccessContext
        |
        v
Session scope: assertSessionScopeForRequest / isSessionAccessible
  manageSession context = session editor
  viewSession context = read-only fallback on page load
  mutation context = write operations on sub-features
        |
        v
Feature-specific checks
  Attendance marking: SCHOOL_SESSIONS + edit window + optional SCHOOL_ATTENDANCES admin override
  Student cases: SCHOOL_SESSION_STUDENT_CASES + mutation scope + edit window
  Reports: mixed sections + canViewerSeeSessionReportRow
  Gradebook panel: SCHOOL_SESSIONS + edit window (not SCHOOL_GRADEBOOK)
        |
        v
Response / render sessionManager.ejs with capability flags
```

The route middleware provides the **first** operation check. Controllers repeat **session scope** and **edit-window** checks before writes. Client-side flags in `sessionManager.ejs` improve UX but are not authoritative.

## Access Profile Definition

An Access Profile configures a section and its operations. For Manage Session, the operative fields are:

| Field | Meaning on Manage Session |
| --- | --- |
| Section | One of `SCHOOL_SESSIONS`, `SCHOOL_SESSION_STUDENT_CASES`, `SCHOOL_REPORTS_ASSIGNMENT`, `SCHOOL_LIBRARY_BOOK_COVERING`, `SCHOOL_ATTENDANCES`, `SCHOOL_GRADEBOOK`, `SCHOOL_CLASSES`, and related report sections for linked pages. |
| Section access type | `custom` uses configured operation rows. `full_access` grants section administration. `full_ban` denies the section. |
| Operation | `READ_ALL`, `UPDATE`, `CREATE`, `DELETE`, `RESOLVE`, and so on, depending on the route. |
| Scope | Returned as `scopeId` from central access evaluation. On Manage Session this primarily drives **list/assignment scope** through `schoolRecordAccessService` (`ASSIGNMENT`, `OWNER`, org-wide). |
| Operation admin access | `adminAccess: true` or section/operation `full_access` can unlock overrides (for example class admin bypass on completed-session locks). |
| Profile organization | Profiles bound to an organization apply only in that org context. |

### Effective Access Precedence

The central resolver combines the active profile with user and organization policy. In practical terms:

- Section or operation `full_ban` denies access even if another grant exists.
- Section `full_access` makes all operations in that section available through generic evaluation.
- Manage Session **still** applies session editor scope for `manageSession` / `mutation` contexts unless the actor is org-wide.
- Completed-session edits may be time-locked by org policy even when `SCHOOL_SESSIONS` UPDATE is granted.
- External links (Attendance Matrix, Grades Matrix) enforce their **destination section** independently.

## Primary Section: `SCHOOL_SESSIONS`

### Operations used on Manage Session

| Operation | Typical use on Manage Session |
| --- | --- |
| `READ_ALL` | Open Manage Session page; list session report instances; read session context. |
| `UPDATE` | Save session (roster/attendance, notes, curriculum, gradebook entries, conduct, files, makeup, merge, co-teachers, metadata overrides). |
| `DELETE` | Delete session; delete linked makeup; preview delete. |

Page load mints an UPDATE action-state token because the UI posts to UPDATE routes:

```519:523:packages/school/MVC/routes/classRoutes.js
router.get('/:id/sessions/:sessionId',
  requireAccess(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.READ_ALL),
  trackActionState(SECTIONS.SCHOOL_SESSIONS, OPERATIONS.UPDATE),
  classCtrl.manageSession);
```

### Session scope (`manageSession` vs `viewSession` vs `mutation`)

`schoolRecordAccessService.isSessionAccessible` applies scope after the route gate:

| Scope mode | `manageSession` / `mutation` | `viewSession` (read-only fallback) |
| --- | --- | --- |
| Org-wide / `canViewAll` | Full access to session | Full view access |
| `ASSIGNMENT` | Must be a **session editor** (main teacher, merged previous teacher, or co-teacher with edit permission) | Must be a **session viewer** or active class instructor |
| `OWNER` | Must be session creator | Session creator or class owner |
| `USER` / deny | Denied | Denied |

On page load, the controller tries `manageSession` first; if that fails it falls back to `viewSession` and sets `canEditSession = false` (read-only UI):

```4030:4046:packages/school/MVC/controllers/school/classController.js
        let canEditSession = true;
        try {
            schoolRecordAccessService.assertSessionAccessible({
                classRow: classData,
                session,
                access: sessionAccess,
                context: 'manageSession'
            });
        } catch (manageError) {
            schoolRecordAccessService.assertSessionAccessible({
                classRow: classData,
                session,
                access: sessionAccess,
                context: 'viewSession'
            });
            canEditSession = false;
        }
```

Class admin override (`SCHOOL_CLASSES` UPDATE admin) unlocks administrative session metadata, co-teacher management, and most completed-session section overrides via `canOverride`. Access Profile matrix: [design_docs/classes-operation-scope-capabilities-2026-09-24.md](design_docs/classes-operation-scope-capabilities-2026-09-24.md).

## Sub-Feature Access Matrix

This table answers whether Manage Session reuses another section's access or inherits session access.

| Sub-feature | Own section required for in-page action? | Route / operation gate | Session scope required? | Completed-session edit window | Primary UI flags |
| --- | --- | --- | --- | --- | --- |
| **Page shell / navigation** | `SCHOOL_SESSIONS` | `READ_ALL` | `manageSession` or `viewSession` | N/A | `isReadOnly`, `canEditSession` |
| **Attendance marking** (roster in save) | **No** — not `SCHOOL_ATTENDANCES` | `SCHOOL_SESSIONS` `UPDATE` (`POST .../save`) | Yes (`manageSession`) | `completedSessionAttendanceEdit`; override: `SCHOOL_ATTENDANCES` UPDATE admin **or** `SCHOOL_CLASSES` UPDATE admin | `attendanceEditLocked`, `attendanceReadOnly` |
| **Attendance Matrix link** | **Yes** — `SCHOOL_ATTENDANCES` | Evaluated in `manageSession`; destination `/school/attendances/*` enforces attendance section | N/A (separate page) | N/A | `canOpenAttendanceMatrix` |
| **Session notes** | No (part of `SCHOOL_SESSIONS` save) | `SCHOOL_SESSIONS` `UPDATE` | Yes | `completedSessionNotesEdit`; override: class admin | `notesEditLocked`, `sessionNotesReadOnly` |
| **Student cases** | **Yes** — `SCHOOL_SESSION_STUDENT_CASES` | Per-route CREATE/UPDATE/DELETE/READ_ALL; status uses RESOLVE or UPDATE | Yes for **writes** (`mutation`) | `completedSessionStudentCasesEdit`; override: class admin | `studentCaseCapabilities`, `studentCasesSectionReadOnly` |
| **Report instance list** | Partial — list route uses `SCHOOL_SESSIONS` | `GET .../report-instances` → `READ_ALL` | Yes | N/A | Rows filtered server-side |
| **Assign report to session** | **Yes** — `SCHOOL_REPORTS_ASSIGNMENT` | `POST .../report-assignments` → `CREATE` | Yes (controller asserts session scope) | N/A | `canAssignSessionReports` |
| **Fill / open report instance** | **Yes** — destination report routes | Manage Session links to report hub / instance routes (`SCHOOL_REPORTS_INSTANCES` and participant rules) | Session context preserved in URLs | Conduct may block fill | Row visibility + conduct gates |
| **Book covering report** | **Yes** — `SCHOOL_LIBRARY_BOOK_COVERING` | READ/CREATE/DELETE on session book-covering routes | Yes | N/A | `canViewBookCoveringReport`, `canCreateBookCoveringReport`, `canDeleteBookCoveringReport` |
| **Class conduct (before reports)** | No — `SCHOOL_SESSIONS` | `POST .../conduct` → `UPDATE` | Yes | `completedSessionConductEdit`; override: class admin | `canManageClassConduct`, `conductEditLocked` |
| **Gradebook / activities panel** | **No** — not `SCHOOL_GRADEBOOK` | `SCHOOL_SESSIONS` `UPDATE` (`POST .../save` or `.../gradebooks/save`) | Yes | `completedSessionGradebookEdit`; override: class admin | `gradebookSectionReadOnly`, `sessionGradebookSectionReadOnly` |
| **Grades Matrix link** | **Yes** — `SCHOOL_GRADEBOOK` | Destination `/school/grades-matrix/*` | N/A (separate page) | N/A | Link shown without gate; destination enforces access |
| **Activity work sessions** | **No** on Manage Session | `SCHOOL_ACTIVITIES` applies to Activity Work Session Manager, not this panel | N/A | N/A | N/A |
| **Curriculum / skills covered** | No — `SCHOOL_SESSIONS` | `SCHOOL_SESSIONS` `UPDATE` | Yes | `completedSessionCurriculumEdit`; override: class admin | `curriculumEditLocked` |

**Core pattern:** instructional data on the page is **`SCHOOL_SESSIONS` + session editor scope**. Dedicated sections are added only where the product exposes a separately cataloged capability (cases, report assignment, book covering, external matrix tools).

## Attendance

### In-page attendance marking

Attendance marks are saved as part of the session roster through `POST /school/classes/:id/sessions/:sessionId/save`. The route requires **`SCHOOL_SESSIONS` UPDATE**, not `SCHOOL_ATTENDANCES`.

The controller asserts session scope and, for completed sessions, the attendance edit window:

```5819:5821:packages/school/MVC/controllers/school/classController.js
        if (!shouldSkipInstructionalPayload && roster !== undefined) {
            await assertCompletedSessionSectionEditable('attendance', canOverrideAttendanceEdit);
        }
```

`canOverrideAttendanceEdit` is true when the actor is a **class admin** (`SCHOOL_CLASSES` UPDATE admin) **or** an **attendance admin** (`SCHOOL_ATTENDANCES` UPDATE admin).

### Attendance Matrix link (external)

The link on Manage Session is gated by `userCanOpenAttendanceMatrix`, which checks:

1. Attendance admin viewer (`schoolAdminAccessService.isAttendancesAdminViewerAsync`), or
2. `SCHOOL_ATTENDANCES` UPDATE allowed through central access evaluation.

The Attendance Matrix page and its API routes enforce `SCHOOL_ATTENDANCES` independently. Opening the matrix from Manage Session does **not** grant attendance section access to in-page marking—the two paths are separate.

### Client gating

```1349:1354:packages/school/MVC/views/school/class/sessionManager.ejs
    <% const disabledAttr = isReadOnly ? 'disabled' : ''; %>
    <% const attendanceReadOnly = isReadOnly || (typeof attendanceEditLocked !== 'undefined' && attendanceEditLocked); %>
```

Attendance Matrix button renders only when `canOpenAttendanceMatrix` is true.

## Student Cases

### Section and routes

All case routes under the session path use **`SCHOOL_SESSION_STUDENT_CASES`**:

| Method and route | Operation gate |
| --- | --- |
| `GET .../cases` | `READ_ALL` |
| `POST .../cases` | `CREATE` |
| `POST .../cases/:caseId` | `UPDATE` |
| `POST .../cases/:caseId/status` | `RESOLVE` if status is `resolved`, else `UPDATE` |
| `DELETE .../cases/:caseId` | `DELETE` |

### Capability model (section **and** session scope)

`sessionStudentCaseAccessService.resolveCaseCapabilities` evaluates section operations through **`studentCaseAccessService.buildStudentCaseAccess`** and session mutation scope from **`buildStudentCaseSectionAccessContext`** (student-case section scope — not `req.accessScope` from `SCHOOL_SESSIONS` middleware):

| Capability | Section operation | Session mutation scope |
| --- | --- | --- |
| `canCreate`, `canUpdate`, `canResolve`, `canDelete` | Required | Required (`mutation` context) |
| `canRead`, `canReadAll` | Required | **Not** required for read |

Routed cases can grant read/resolve overrides when the viewer is the routed assignee and holds `RESOLVE`.

**Design reference:** [student-case-operation-scope-capabilities-2026-09-06.md](design_docs/student-case-operation-scope-capabilities-2026-09-06.md)

### Completed-session lock

Student case writes also respect `completedSessionStudentCasesEdit`. Override uses **class admin** (`canOverrideCompletedSections`), not a separate case-section admin flag on the edit window.

### Client gating

- Sidebar tab: `studentCaseCapabilities.canRead || studentCaseCapabilities.canReadAll`
- Create button: `canCreate` and not `studentCasesSectionReadOnly`
- `studentCasesSectionReadOnly = isReadOnly || studentCasesEditLocked`

## Reports

Reports on Manage Session involve **multiple sections** and **row-level visibility**.

### Report instance list

- Route: `GET .../report-instances` → **`SCHOOL_SESSIONS` READ_ALL**
- Controller asserts session accessibility and builds rows through `sessionReportInstanceService`
- Rows are filtered with `canViewerSeeSessionReportRow`:

| Viewer condition | Can see row |
| --- | --- |
| Report admin viewer (`SCHOOL_REPORTS_INSTANCES` READ_ALL admin) | Yes |
| Row teacher matches viewer person | Yes |
| Row student matches viewer person | Yes |
| Assignment scope `each_student` | Viewer owns a roster student in session |
| Assignment scope `selected_students` | Viewer owns a targeted student |

### Assign report to session

- Route: `POST .../report-assignments` → **`SCHOOL_REPORTS_ASSIGNMENT` CREATE**
- Page flag: `canAssignSessionReports` from central access evaluation on that section
- UI: Assign Report button hidden when false

### Fill / open report instances

Manage Session links into report instance routes (Report Hub / `reportRoutes.js`). Those destinations enforce **`SCHOOL_REPORTS_INSTANCES`** and participant access rules. The list endpoint on Manage Session does not substitute for fill authorization.

### Book covering

| Action | Section | Operation |
| --- | --- | --- |
| Summary | `SCHOOL_LIBRARY_BOOK_COVERING` | READ or READ_ALL |
| Create | `SCHOOL_LIBRARY_BOOK_COVERING` | CREATE |
| Delete | `SCHOOL_LIBRARY_BOOK_COVERING` | DELETE |

`canViewBookCoveringReport` is true when read, read-all, or create access is allowed.

### Class conduct before reports

- Saved via `POST .../conduct` → **`SCHOOL_SESSIONS` UPDATE**
- `canManageClassConduct = class admin OR canEditSession` (session editor)
- Edit window: `completedSessionConductEdit`
- Some report assignments require conduct before fill (`conductRequiredBeforeFill`)

## Grade Book and Activities

### Session gradebook panel (on Manage Session)

The panel labeled **Grade book/Activities** stores **session gradebook entries**, not Activity Work Session records.

| Action | Section gate |
| --- | --- |
| View panel | Inherited from page (`SCHOOL_SESSIONS` READ_ALL) |
| Save entries | `SCHOOL_SESSIONS` UPDATE via `POST .../save` (gradebooks in body) or `POST .../gradebooks/save` |
| Completed-session edits | `completedSessionGradebookEdit`; override: class admin |

**`SCHOOL_GRADEBOOK` is not checked** for in-page gradebook saves.

### Grades Matrix link (external)

The Grades Matrix link in `sessionManager.ejs` is not permission-gated in the view. The destination `/school/grades-matrix` requires **`SCHOOL_GRADEBOOK` READ_ALL** (and UPDATE for edits) on its own routes.

### Activity work sessions (`SCHOOL_ACTIVITIES`)

The **`SCHOOL_ACTIVITIES`** section applies to the Activity Work Session Manager (`activityRoutes.js`). It is a separate product surface from the Manage Session gradebook panel. Timesheet links may say "Manage Work Session" for activity entries; those routes use activity/work-session scope, not session gradebook scope.

## Completed Session Edit Windows

When a session reaches a **completion status** (per org session status policy), section edits may become time-locked. Policy keys are org-configurable through `sessionAccessPolicyModel`.

| Target key | Policy key | Label | Override on Manage Session |
| --- | --- | --- | --- |
| `attendance` | `completedSessionAttendanceEdit` | Attendance | Class admin **or** `SCHOOL_ATTENDANCES` UPDATE admin |
| `notes` | `completedSessionNotesEdit` | Session Notes | Class admin |
| `gradebook` | `completedSessionGradebookEdit` | Grade book/Activities | Class admin |
| `conduct` | `completedSessionConductEdit` | Class Conduct Before Reports | Class admin |
| `curriculum` | `completedSessionCurriculumEdit` | Curriculum | Class admin |
| `studentcases` | `completedSessionStudentCasesEdit` | Student Cases | Class admin |

Window types include end of week, end of month, timesheet period end, and days after session. When a policy is disabled, a fixed one-day grace applies.

Server enforcement uses `sessionAttendanceEditAccessService.assertSessionSectionEditable`. Client flags (`attendanceEditLocked`, `gradebookEditLocked`, and so on) mirror the result for UX.

## HTTP Route Reference

All routes below are mounted under `/school/classes` via `classRoutes.js`.

| Method and route | Section | Operation | Notes |
| --- | --- | --- | --- |
| `GET /:id/sessions/:sessionId` | `SCHOOL_SESSIONS` | `READ_ALL` | Page load; mints UPDATE token |
| `GET /:id/sessions/:sessionId/cases` | `SCHOOL_SESSION_STUDENT_CASES` | `READ_ALL` | List cases |
| `GET /:id/sessions/:sessionId/report-instances` | `SCHOOL_SESSIONS` | `READ_ALL` | Filtered rows |
| `POST /:id/sessions/:sessionId/report-assignments` | `SCHOOL_REPORTS_ASSIGNMENT` | `CREATE` | Assign report |
| `GET /:id/sessions/:sessionId/book-covering-reports/summary` | `SCHOOL_LIBRARY_BOOK_COVERING` | READ or READ_ALL | Summary |
| `POST /:id/sessions/:sessionId/book-covering-reports` | `SCHOOL_LIBRARY_BOOK_COVERING` | `CREATE` | Create report |
| `DELETE /:id/sessions/:sessionId/book-covering-reports/:reportId` | `SCHOOL_LIBRARY_BOOK_COVERING` | `DELETE` | Delete report |
| `POST /:id/sessions/:sessionId/files/upload` | `SCHOOL_SESSIONS` | `UPDATE` | File upload |
| `POST /:id/sessions/:sessionId/makeup` | `SCHOOL_SESSIONS` | `UPDATE` | Create makeup |
| `DELETE /:id/sessions/:sessionId/makeup/:makeupSessionId` | `SCHOOL_SESSIONS` | `DELETE` | Delete makeup |
| `POST /:id/sessions/:sessionId/merge/preview` | `SCHOOL_SESSIONS` | `UPDATE` | Merge preview |
| `GET /:id/sessions/:sessionId/merge/eligible-teachers` | `SCHOOL_SESSIONS` | `UPDATE` | Merge helpers |
| `POST /:id/sessions/:sessionId/merge` | `SCHOOL_SESSIONS` | `UPDATE` | Execute merge |
| `POST /:id/sessions/:sessionId/merge/unmerge` | `SCHOOL_SESSIONS` | `UPDATE` | Unmerge |
| `POST /:id/sessions/:sessionId/cases` | `SCHOOL_SESSION_STUDENT_CASES` | `CREATE` | Create case |
| `POST /:id/sessions/:sessionId/cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | `UPDATE` | Update case |
| `POST /:id/sessions/:sessionId/cases/:caseId/status` | `SCHOOL_SESSION_STUDENT_CASES` | `RESOLVE` or `UPDATE` | Status change |
| `DELETE /:id/sessions/:sessionId/cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | `DELETE` | Delete case |
| `GET /:id/sessions/:sessionId/delete-preview` | `SCHOOL_SESSIONS` | `DELETE` | Delete preview |
| `DELETE /:id/sessions/:sessionId` | `SCHOOL_SESSIONS` | `DELETE` | Delete session |
| `POST /:id/sessions/:sessionId/gradebooks/save` | `SCHOOL_SESSIONS` | `UPDATE` | Gradebook save |
| `POST /:id/sessions/:sessionId/lock` | `SCHOOL_CLASSES` | `UPDATE` | Session lock (class admin route gate) |
| `POST /:id/sessions/:sessionId/save` | `SCHOOL_SESSIONS` | `UPDATE` | Roster, attendance, notes, curriculum, gradebooks |
| `POST /:id/sessions/:sessionId/conduct` | `SCHOOL_SESSIONS` | `UPDATE` | Class conduct |

Mutating routes use `trackActionState` with section-appropriate tokens. Session scope is asserted in controllers after the route gate passes.

## Client-Side Gating

`manageSession` passes capability flags into `sessionManager.ejs`. These improve UX but **must not** be treated as security boundaries.

| Flag | Server source | Effect |
| --- | --- | --- |
| `isReadOnly` | `!canEditSession` or administrative/timesheet locks | Disables most edits |
| `attendanceEditLocked` | Completed-session attendance window + override | Read-only attendance controls |
| `gradebookSectionReadOnly` | `isReadOnly` or `gradebookEditLocked` | Hides add-activity, disables gradebook edits |
| `studentCasesSectionReadOnly` | `isReadOnly` or `studentCasesEditLocked` | Blocks case create/edit UI |
| `studentCaseCapabilities` | `sessionStudentCaseAccessService` | Tab visibility, create/update/delete/resolve |
| `canAssignSessionReports` | `SCHOOL_REPORTS_ASSIGNMENT` CREATE evaluation | Assign Report button |
| `canOpenAttendanceMatrix` | `userCanOpenAttendanceMatrix` | Attendance Matrix link |
| `canViewBookCoveringReport` | Book covering read/create evaluation | Book covering nav and panel |
| `canManageClassConduct` | Class admin or session editor | Conduct editing |

JavaScript mirrors several flags (`sessionGradebookSectionReadOnly`, `canCreateStudentCases`, and so on) for dynamic behavior. Always validate on the server for mutations.

## Security Controls Present

| Control | Coverage |
| --- | --- |
| Authentication | School routes require authenticated users. |
| Route authorization | `requireAccess(section, operation)` on every session route. |
| CSRF / action state | `trackActionState` on mutating routes; page load mints UPDATE token for save flows. |
| Class access | `getClassByIdWithOrgCheck` with route access context. |
| Session scope | `assertSessionScopeForRequest` / `isSessionAccessible` for manage, view, and mutation contexts. |
| Completed-session policy | Time-based edit windows per section target; admin overrides documented above. |
| Timesheet locks | Approved timesheet periods can block metadata/roster mutations. |
| Report row filter | `canViewerSeeSessionReportRow` prevents cross-assignment leakage in the session list. |
| Case capabilities | Section operation plus session mutation scope for writes; routing overrides for assignees. |
| Instructional inactive sessions | Makeup-required inactive sessions block instructional payload saves. |

## Configuration Checklist

### Teacher / session editor profile

- Grant **`SCHOOL_SESSIONS` READ_ALL and UPDATE** with **ASSIGNMENT** (or appropriate) scope so the actor is a session editor for delivered sessions.
- Do **not** require `SCHOOL_ATTENDANCES` for in-page attendance marking if teachers should mark attendance on Manage Session.
- Grant **`SCHOOL_SESSION_STUDENT_CASES`** CREATE/UPDATE/READ_ALL only if the teacher should manage cases on their sessions.
- Grant **`SCHOOL_REPORTS_ASSIGNMENT` CREATE** only if the teacher may assign reports from Manage Session.
- Report filling still requires destination report-instance permissions.

### Attendance office profile

- Grant **`SCHOOL_ATTENDANCES` UPDATE** (or attendance admin viewer) for Attendance Matrix access.
- Optionally grant **`SCHOOL_CLASSES` UPDATE** admin for completed-session attendance overrides on locked sessions.

### Case manager profile

- Grant **`SCHOOL_SESSION_STUDENT_CASES`** operations separately from session delivery scope.
- Remember writes still require session **mutation** scope unless the actor is org-wide.

### Read-only observer profile

- Grant **`SCHOOL_SESSIONS` READ_ALL** with scope that passes **`viewSession`** but not **`manageSession`**.
- UI renders read-only (`canEditSession = false`).

## Verification Coverage

Existing tests that exercise Manage Session access patterns include:

- `test/school-class-scope-enforcement.test.js` — `manageSession` route access context and `assertSessionScopeForRequest`
- `test/school-record-access-service.test.js` — `isSessionAccessible` for `manageSession` context
- `packages/school/test/session-conduct-access.test.js` — conduct management on Manage Session
- `packages/school/test/manage-session-performance.test.js` — controller wiring (not access-focused)

## Implementation References

- `packages/school/MVC/routes/classRoutes.js` — session execution routes and middleware
- `packages/school/MVC/controllers/school/classController.js` — `manageSession`, `saveSession`, `saveSessionConduct`, `saveSessionGradebooks`, case/report handlers
- `packages/school/MVC/services/school/schoolRecordAccessService.js` — class and session scope
- `packages/school/MVC/services/school/sessionAttendanceEditAccessService.js` — completed-session edit windows
- `packages/school/MVC/services/school/sessionStudentCaseAccessService.js` — case capabilities
- `packages/school/MVC/services/school/sessionReportInstanceService.js` — report row visibility
- `packages/school/MVC/services/school/attendanceMatrixAccessService.js` — Attendance Matrix link gate
- `packages/school/MVC/routes/sessionStudentCaseRouteGuards.js` — case status RESOLVE vs UPDATE routing
- `packages/school/MVC/views/school/class/sessionManager.ejs` — client capability flags and section UI
- `packages/school/config/accessConstants.js` — section identifiers
- `packages/school/MVC/routes/gradesMatrixRoutes.js` — Grades Matrix destination gates
- `packages/school/MVC/routes/activityRoutes.js` — Activity Work Session Manager (`SCHOOL_ACTIVITIES`)
