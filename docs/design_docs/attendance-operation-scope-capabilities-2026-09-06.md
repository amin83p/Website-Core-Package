# Attendance Operation and Scope Capabilities

Access Profile reference | 6 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_ATTENDANCES` or `SCHOOL_ATTENDANCE_REPORT` access checks
- Wiring route gates, UI capability flags, or Manage Session attendance integration
- Deciding which operation (READ, READ_ALL, UPDATE, UPLOAD, etc.) gates each attendance action

**Critical rules:**

1. This doc defines **attendance-section behavior only** — not which classes/sessions appear (see `SCHOOL_CLASSES` / `SCHOOL_SESSIONS`).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only**.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — incremental `"+"` extras, not bypass admins.
4. **Locked sessions** are visible to all scopes that can open the matrix; lock blocks **UPDATE** only (unless UPDATE + ADMIN scope or bypass override A1).
5. **Rollups** require READ to call API + READ_ALL with DEPARTMENT/DIVISION, ORGANIZATION, or ADMIN scope. **USER and OWNER: No Access** to rollups.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope; developer API
- [manage-session-access-architecture-report-2026-09-04.md](../manage-session-access-architecture-report-2026-09-04.md) — Manage Session runtime split

**Status:** Target specification for attendance access promotion. Current runtime may still gate matrix page on UPDATE until implementation completes.

---

## Scope of this document for SCHOOL_ATTENDANCES

This document defines **attendance-section access only** — what a user may do within `SCHOOL_ATTENDANCES` once central access has approved the requested operation and scope.

Attendance data lives on **session rosters**, and sessions belong to **classes**. This document does **not** define which classes or sessions a user can reach. Those boundaries are governed by `SCHOOL_CLASSES` and `SCHOOL_SESSIONS`.

When reading this matrix, assume the user is already viewing an attendance context they are allowed to open under those other sections.

### What this document answers

| Question | Answered here | Answered elsewhere |
| --- | --- | --- |
| Can the user open the Attendance Matrix? | Yes — by `SCHOOL_ATTENDANCES` operation | — |
| Which classes/sessions load in the matrix? | No | `SCHOOL_CLASSES` / `SCHOOL_SESSIONS` |
| Can the user see student names in attendance? | Yes — by READ_ALL scope tier | — |
| Can the user see and update attendance status and roster notes? | Yes — by READ_ALL / UPDATE tier | — |
| Can the user save a mark or excuse flag? | Yes — by UPDATE tier | — |

### How to read operation and scope rows

Each row answers: *Given an attendance context the user can already open, what attendance information and actions are permitted?*

It does **not** answer: *Which classes or sessions appear in the picker or matrix?*

**Wording note:** Phrases such as *On the Attendance Matrix page* and *On Manage Session (attendance panel)* describe **where** a capability applies, not how class/session scope is calculated.

**Incremental scopes:** `+` = additional visibility or actions at that scope level. Effective access is cumulative unless stated otherwise. Operation tables apply to non-bypass users only.

---

## SCHOOL_ATTENDANCES section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Attendance Matrix** (`/school/attendances`) | Primary workspace: pick in-scope class, date window, student-by-session cells, mark attendance, timing, notes, comments, files, rollups, Excel export, change-log queries. **Route gate (target):** READ to open page; UPDATE for mutations. **Current runtime:** page and APIs still require UPDATE until promotion. |
| **Manage Session — attendance panel** | In-page roster at `/school/classes/:classId/sessions/:sessionId`. Today saves via `SCHOOL_SESSIONS` UPDATE + session-editor scope. External matrix link uses `userCanOpenAttendanceMatrix`. |

---

## Admin reference (do not duplicate here)

See [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) for bypass admin types (Family A).

| Topic | See |
| --- | --- |
| Bypass admin types (Family A) | [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass operation/scope rows unless a separate business rule applies |
| ADMIN in scope column (Family B) | Access Profile ADMIN scope (`SCP_ADMIN`) only — incremental `"+"` rows below |

---

## Access profile definitions — SCHOOL_ATTENDANCES

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION | Open Attendance Matrix page only; no field visibility unless READ_ALL granted; no mutations unless UPDATE granted. |
| READ | ORGANIZATION | Same as above. |
| READ | ADMIN | Open Attendance Matrix page only; no additional READ extras at this tier (Family B). |

**Note:** Users with READ and any non-USER scope can open the Attendance Matrix page.

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | **Matrix:** student names, statuses, late/early mins, student note. Date window: 3 months from today. **Manage Session:** same fields (view). |
| READ_ALL | DEPARTMENT / DIVISION | **Matrix:** `+` excuse/reference notes, student notes, attached files, admin discussion, excuse marks, rollups. Date window: 1 year. **Manage Session:** `+` excuse notes, files, admin discussion. |
| READ_ALL | ORGANIZATION | **Matrix:** `+` change history. |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION. Locked sessions remain visible to all users who can open the matrix; only cell **updates** on locked sessions are blocked (unless UPDATE + ADMIN or bypass A1). Admin viewer tools and full field visibility are bypass-only — see overrides A4 and A12. |

**Notes:**

- READ_ALL alone does not allow update; visibility is limited to class/session context from `SCHOOL_CLASSES` / `SCHOOL_SESSIONS`.
- Access checks use `SCHOOL_ATTENDANCES` section only for attendance capabilities.
- **Rollups:** READ_ALL with DEPARTMENT/DIVISION, ORGANIZATION, or ADMIN scope. **USER and OWNER: No Access** to rollups.
- **Locked sessions:** visible for all scopes that can open the matrix; lock blocks UPDATE only.

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | **Matrix:** statuses, late/early mins, student note. Window: 3 months. **Manage Session:** statuses, late/early mins. |
| UPDATE | DEPARTMENT / DIVISION | **Matrix:** `+` excuse notes, student note, files, admin discussion. **Manage Session:** same. |
| UPDATE | ORGANIZATION | **Matrix:** `+` excuse flags (Late/Early, Absent, ACF); edit after completed-session deadline. **Manage Session:** same. |
| UPDATE | ADMIN | **Matrix + Manage Session:** `+` edit attendance on locked session; `+` change attendance **away from N/A** when rolling enrollment placed the student on-hold or exempted the session (office session mark). |

**Notes:**

- Comments on shared endpoints: `SCHOOL_ATTENDANCES` UPDATE or `SCHOOL_SESSIONS` UPDATE.
- **File uploads:** `SCHOOL_ATTENDANCES` UPLOAD only.
- Locked sessions visible to all; lock blocks UPDATE only.
- **Rolling enrollment N/A lock (on-hold period or office session exemption):** Users with UPDATE below ADMIN scope may still view N/A and edit **student roster notes** and **admin discussion** while status remains N/A, but **changing away from N/A** or adjusting **late/early minutes and arrival/leave times** requires bypass admin (Family A) or **UPDATE at ADMIN scope** — same capability as locked-session override (`canOverrideSessionLock`).

### DELETE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER / OWNER | No Access. |
| DELETE | DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | `+` Can delete files attached to attendance details (Matrix + Manage Session where exposed). |

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION | No Access. |
| CONFIGURE | ADMIN | Required along with `SCHOOL_SETTINGS` access for attendance settings under school settings. |

### EXPORT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| EXPORT | USER / OWNER | No Access. |
| EXPORT | DEPARTMENT / DIVISION / ORGANIZATION | **Matrix:** export Excel from visible attendance page. |
| EXPORT | ADMIN | No additional EXPORT extras beyond ORGANIZATION. |

### PRINT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| PRINT | USER / OWNER | No Access. |
| PRINT | DEPARTMENT / DIVISION / ORGANIZATION | **Matrix:** print visible attendance page. |
| PRINT | ADMIN | No additional PRINT extras beyond ORGANIZATION. |

### UPLOAD

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPLOAD | USER / OWNER | No Access. |
| UPLOAD | DEPARTMENT / DIVISION / ORGANIZATION | **Matrix:** `+` upload files attached to attendance details. **Manage Session:** `+` upload roster attendance files. |
| UPLOAD | ADMIN | No additional UPLOAD extras beyond ORGANIZATION. |

---

## Other notes

| Topic | Rule |
| --- | --- |
| **Manage Session matrix link** | Shown when user has `SCHOOL_ATTENDANCES` READ (or attendance section admin). Roster shown with READ_ALL; editable with UPDATE. Missing access: show alert to contact admin for `SCHOOL_ATTENDANCES` profile update. **Runtime:** link still checks UPDATE via `userCanOpenAttendanceMatrix` until READ promotion. |
| **Rollups API** (`POST /api/rollups`) | Requires READ to call. Display requires READ_ALL with DEPARTMENT/DIVISION, ORGANIZATION, or ADMIN. **USER and OWNER: No Access.** |
| **Rolling enrollment on-hold / office session exemption** | When attendance is N/A because of an applied on-hold period or a locked enrollment session mark, changing **away from N/A** or editing **late/early timing** requires bypass admin (Family A) or `SCHOOL_ATTENDANCES` UPDATE at ADMIN scope (Family B). **Student roster notes** and **admin discussion** may still be edited. Does not use `SCHOOL_CLASSES` admin. |

---

## Admin and other scope overrides

Apply to **bypass admins (Family A)** for rows marked bypass-only. **A9** also applies to Family B users with **UPDATE at ADMIN scope** (same as locked-session override). Do not replace READ / READ_ALL / UPDATE rows.

Implementation: `schoolAdminAccessService.isAttendancesAdminViewerAsync`, `userCanOpenAttendanceMatrix`, `userCanMarkAttendanceExcused` (excuses follow ORGANIZATION UPDATE scope, not A6), `attendanceEnrollmentNaLockService` + `canOverrideSessionLock`.

| # | Feature / override | Bypass admin? | In override form? |
| --- | --- | --- | --- |
| A1 | Edit attendance on locked session | Yes | Yes |
| A2 | Edit after completed-session deadline | Yes | Yes |
| A3 | View change history (when restricted below ORG READ_ALL) | Yes | Yes |
| A4 | Admin viewer tools on matrix | Yes | Yes |
| A5 | Open matrix without normal READ/UPDATE | Yes | Yes |
| A6 | Mark excuse flags / excuse notes | N/A — scope at ORGANIZATION UPDATE | No |
| A7 | Bypass enrollment window | No | Not attendance admin override |
| A8 | Bypass makeup-required original session | No | Not attendance admin override |
| A9 | Bypass rolling enrollment on-hold / office-exempt N/A (change away from N/A) | Yes | Yes |
| A10 | Bypass rolling enrollment capacity | No | Not attendance admin override |
| A11 | Lock / unlock session metadata | No (class/session admin) | Not attendance admin override |
| A12 | Full field visibility regardless of scope | Optional bypass | Note only |

---

## SCHOOL_ATTENDANCE_REPORT

Separate section; report routes use `SCHOOL_ATTENDANCE_REPORT` operations. Also considers `SCHOOL_CLASSES` and `SCHOOL_STUDENTS` for data scope.

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION | Open Student Attendance Report page only; no field visibility unless READ_ALL. |
| READ | ORGANIZATION | Same as above. |
| READ | ADMIN | Open report page only; no additional READ extras (Family B). |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| READ_ALL | ORGANIZATION | Access page for generating reports (subject to `SCHOOL_CLASSES` / `SCHOOL_STUDENTS`). |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION. |

### EXPORT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| EXPORT | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| EXPORT | ORGANIZATION | Export reports in available formats. |
| EXPORT | ADMIN | No additional EXPORT extras beyond ORGANIZATION. |

---

## Implementation references

| Concern | Location |
| --- | --- |
| Routes | `packages/school/MVC/routes/attendanceRoutes.js` |
| Controller | `packages/school/MVC/controllers/school/attendanceController.js` |
| Matrix access | `packages/school/MVC/services/school/attendanceMatrixAccessService.js` |
| Admin checks | `packages/school/MVC/services/school/schoolAdminAccessService.js` |
| Manage Session | `packages/school/MVC/controllers/school/classController.js` |
| Section catalog | MongoDB `sections` collection (`SCHOOL_ATTENDANCES`) |

---

## Implementation checklist (apply to app)

Target changes to align runtime with this document:

1. Gate Attendance Matrix page and read APIs on **READ** (not UPDATE-only).
2. Gate mutations on **UPDATE**; gate attendance file uploads on **SCHOOL_ATTENDANCES** UPLOAD only.
3. Gate Excel export on **EXPORT**; print on **PRINT**.
4. Rollups API: READ to call; display only for READ_ALL with DEPT/DIV, ORG, or ADMIN (not USER/OWNER).
5. Manage Session: matrix link on READ; roster view READ_ALL; edit UPDATE; promote from `SCHOOL_SESSIONS` where specified.
6. `userCanOpenAttendanceMatrix`: accept READ grant, not UPDATE-only.
7. UI flags: split `canEdit`, `canUpload`, `canExport`, `canPrint`, rollups visibility per scope rows above.
8. Add/update tests in `test/attendance-*` and `packages/school/test/`.
