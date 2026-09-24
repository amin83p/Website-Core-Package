# Classes Operation and Scope Capabilities

Access Profile reference | 24 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_CLASSES` access checks
- Wiring route gates, UI capability flags, class list scope, or entity picker class terminals
- Deciding which operation (READ, READ_ALL, CREATE, UPDATE, DELETE, etc.) gates each class-management action
- Distinguishing **class section access** from **session editor**, **rolling enrollment**, or **class cycles** on URLs under `/school/classes/...`

**Critical rules:**

1. This doc defines **`SCHOOL_CLASSES` section behavior only** — not Manage Session panels, rolling enrollment, cycle rollover, or final grades (see boundary table below).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless a separate bypass rule is stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — incremental `"+"` extras, not bypass admins.
4. **Class list scope** uses the **active instructor roster** on the class document (`instructors[]` with non-inactive status). Session **main/co-teacher delivery** does **not** grant class list or class-record access at assignment scope.
5. **Class admin** (Family B) is **`SCHOOL_CLASSES` UPDATE at ADMIN scope** (`adminAuthorityService.isAdminForRequestAsync`). It unlocks session lock, completed-session override windows on Manage Session, and administrative session metadata — not org-wide class list by itself unless READ_ALL at ORGANIZATION is also granted.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope; developer API
- [manage-session-access-architecture-report-2026-09-04.md](../manage-session-access-architecture-report-2026-09-04.md) — Manage Session runtime split and class admin overrides
- [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md) — attendance matrix (which classes appear in matrix)
- [student-case-operation-scope-capabilities-2026-09-06.md](student-case-operation-scope-capabilities-2026-09-06.md) — student cases (class picker visibility referenced there)

**Status:** **Implemented** for core list, CRUD routes, repository list scope, and `buildRouteAccessContext` wiring. Intentional gaps: **READ** is not used as a list gate (READ_ALL only); Class Management **print** and **file import** modals are shared table UI without dedicated `SCHOOL_CLASSES` EXPORT/IMPORT route gates.

---

## Scope of this document for SCHOOL_CLASSES

This document defines **class-section access only** — what a user may do within `SCHOOL_CLASSES` once central access has approved the requested operation and scope.

Classes own **metadata, instructors, sessions (embedded or linked)**, and links to enrollment workflows. Many features are exposed under `/school/classes/:id/...` but gated by **other section keys**. This document does **not** replace those section matrices.

When reading operation rows, **data scope** (which class rows load) is applied **after** the route operation gate passes, via `req.accessScope` → `buildRouteAccessContext` → `schoolDataService` / repository scope filters.

### What this document answers

| Question | Answered here | Answered elsewhere |
| --- | --- | --- |
| Can the user open Class Management? | Yes — `READ_ALL` on `SCHOOL_CLASSES` | — |
| Which classes appear in the list and class picker? | Yes — READ_ALL scope tier + instructor/owner filters | — |
| Can the user create, edit, or delete a class? | Yes — CREATE / UPDATE / DELETE + record reachability | — |
| Can the user open Manage Session for a class? | No (page gate only) | `SCHOOL_SESSIONS` READ_ALL + session scope |
| Can the user run rolling enrollment or cycle rollover? | No | `SCHOOL_ROLLING_ENROLLMENT`, `SCHOOL_CLASS_CYCLES` |
| Can the user mark attendance on a session? | No | `SCHOOL_SESSIONS` / `SCHOOL_ATTENDANCES` |
| Which sessions the user may edit on Manage Session? | No | `SCHOOL_SESSIONS` + `schoolRecordAccessService.isSessionAccessible` |
| Official final grades workflow? | Partial — OR path includes `SCHOOL_CLASSES` | `SCHOOL_GRADEBOOK`, `SCHOOL_DEPARTMENTS` |

### How to read operation and scope rows

Each row answers: *Given `SCHOOL_CLASSES` access at this scope, what class-management actions and which class rows are permitted?*

**Incremental scopes:** `+` = additional visibility or actions at that scope level. Effective access is cumulative unless stated otherwise. Operation tables apply to non-bypass users only.

**Scope mode mapping (runtime):**

| Access Profile scope | List / record filter |
| --- | --- |
| USER | No class rows (`denyAll`) |
| OWNER | Classes where the user is create-owner (`ownerUserId`, `audit.createUser`, etc.) |
| DEPARTMENT / DIVISION | **Assignment:** active **instructor roster** on the class **or** create-owner |
| ORGANIZATION | All classes in the active org |
| ADMIN (Family B) | Same visible rows as ORGANIZATION for READ_ALL; **UPDATE at ADMIN** adds **class admin** powers (see below) |

---

## SCHOOL_CLASSES section pages and surfaces

| Page / Where | What user can do and see |
| --- | --- |
| **Class Management** (`/school/classes`) | Primary list: search, filters, pagination, row actions. **Route gate:** READ_ALL. Rows filtered by scope. **Add Class** when CREATE granted and org create rules pass (`canCreateOrgScopedItem`). Generic **print** and **import** modals from shared list partials — not separately gated on EXPORT/IMPORT for this section (see operation tables). |
| **Add class** (`/school/classes/new`, `/school/classes/new-wizard`) | Create class (form or wizard). **CREATE** + active org context. |
| **Edit class** (`/school/classes/edit/:id`, `/school/classes/edit-wizard/:id`) | Edit class in scope. **UPDATE**; load uses scoped `getDataById('classes', ...)`. |
| **Class template API** (`GET /school/classes/api/template/:id`) | Load template for wizard/copy flows. **READ_ALL**; class must be in scope. |
| **Storage integrity** (`/school/classes/storage-integrity`) | Scan orphaned class storage. **READ_ALL** to open and scan API; **UPDATE** to apply fixes (`POST .../api/storage-integrity/apply`). |
| **Conflict check** (`POST /school/classes/api/check-conflicts`) | Schedule/conflict validation when creating or editing. **CREATE** or **UPDATE** or **READ_ALL** (`requireAnyClassMutationAccess`). |
| **Teacher assignment impact** (`POST /school/classes/api/:classId/teacher-assignment-impact`) | Preview session roster impact when changing instructors. **UPDATE**; class in scope. |
| **Delete class** (`GET|DELETE /school/classes/delete/:id`) | Remove class. **DELETE**; class in scope. |
| **Session lock** (`POST /school/classes/:id/sessions/:sessionId/lock`) | Toggle administrative session lock. **SCHOOL_CLASSES UPDATE** (not `SCHOOL_SESSIONS` alone). Class admin / scoped editor context on Manage Session. |
| **Entity picker — classes** (`/school/entity-picker/...`) | Terminal level `classes` requires `SCHOOL_CLASSES` in profile; options use same list scope as Class Management. |
| **Dual-gate session batch APIs** (rolling enrollment helpers) | `POST .../sessions/preview-batch`, `enrollment-gap-conflict-review`, `append-batch` require **both** `SCHOOL_ROLLING_ENROLLMENT` UPDATE **and** `SCHOOL_CLASSES` UPDATE. Rolling enrollment owns the workflow; classes UPDATE ensures the actor may mutate that class record. |

### Surfaces on class URLs governed by other sections

| Page / Where | Section | Notes |
| --- | --- | --- |
| Manage Session (`/school/classes/:id/sessions/:sessionId`) | `SCHOOL_SESSIONS` | Page load: READ_ALL. Saves: UPDATE. Class admin override: `SCHOOL_CLASSES` UPDATE admin — see [manage-session-access-architecture-report-2026-09-04.md](../manage-session-access-architecture-report-2026-09-04.md). |
| Rolling enrollment (`/school/classes/:id/rolling-enrollment`, enrollment APIs) | `SCHOOL_ROLLING_ENROLLMENT` | Often paired with `SCHOOL_CLASSES` UPDATE on session-append APIs. |
| Cycle rollover, delete preparation, cycle links | `SCHOOL_CLASS_CYCLES` | — |
| Final grades (`/school/classes/:id/final-grades`) | OR: `SCHOOL_GRADEBOOK`, `SCHOOL_DEPARTMENTS`, `SCHOOL_CLASSES` | READ_ALL / UPDATE per workflow. |
| Session student cases, reports, book covering (embedded) | `SCHOOL_SESSION_STUDENT_CASES`, report sections, `SCHOOL_LIBRARY_BOOK_COVERING` | — |

---

## Admin reference (do not duplicate here)

See [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) for bypass admin types (Family A).

| Topic | See |
| --- | --- |
| Bypass admin types (Family A) | [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) |
| ADMIN in scope column (Family B) | Access Profile ADMIN scope (`SCP_ADMIN`) on the stated operation |

---

## Access profile definitions — SCHOOL_CLASSES

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **No separate READ-only Class Management workflow today.** Section may still appear on dashboard when minimum section access is met, but **list and template routes require READ_ALL**. |

**Note:** Operation is bound on section **442039** in the catalog; `classRoutes` does not gate any class page on READ alone.

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | Open Class Management; see **classes the user created** (ownership fields) in the active org. Open template API for in-scope classes. Open storage integrity **scan** UI when route reached. |
| READ_ALL | DEPARTMENT / DIVISION | Open Class Management; see classes where the user is an **active instructor on the class roster** **or** is the create-owner. **Not** classes where the user only appears as session main/co-teacher without roster membership. Entity picker class lists match this filter. |
| READ_ALL | ORGANIZATION | All classes in the active org in list, picker, and template API. |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION (Family B). |

**Notes:**

- List data: `schoolDataService.fetchDataPaged('classes', ...)` with `buildRouteAccessContext(req)` (scope from middleware).
- Repository: `assignmentScopeKind: 'instructor'` — Mongo filter on `instructors` `$elemMatch` (active status).
- **Final grades page** may be opened with `SCHOOL_CLASSES` READ_ALL as one of three OR grants; gradebook rules still apply to edits.

### CREATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER | No Access. |
| CREATE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Open add form and wizard; submit new class. Requires **active org** create context (`assertCreateOrgContextOrThrow`, `canCreateOrgScopedItem`). New class is stamped with create ownership; typically visible under OWNER and, when instructor is assigned, under DEPARTMENT/DIVISION assignment rules. |

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | Edit **own** classes (create-owner) in the active org: forms, wizard, storage integrity apply, teacher-assignment impact, dual-gate rolling session batch APIs (with rolling enrollment access). |
| UPDATE | DEPARTMENT / DIVISION | Edit classes where user is **active instructor on roster** **or** create-owner. Same routes as OWNER within reachable rows. |
| UPDATE | ORGANIZATION | Edit any class in the active org. |
| UPDATE | ADMIN | **Class admin (Family B):** `+` session **lock/unlock** route; `+` **completed-session override** on Manage Session (`canOverride` / `canOverrideCompletedSections`); `+` administrative session metadata and co-teacher management when policy allows. Does not by itself grant READ_ALL on unrelated org classes — profile must still grant list scope. |

**Notes:**

- Edit routes call `getClassByIdWithOrgCheck` with scoped fetch; out-of-scope ids return access denied.
- Manage Session **save** remains **`SCHOOL_SESSIONS` UPDATE**; class admin augments override flags, not the base session gate.

### DELETE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER | No Access. |
| DELETE | OWNER | Delete **own** classes when route and business rules allow. |
| DELETE | DEPARTMENT / DIVISION | Delete classes on roster (active instructor) **or** owned. |
| DELETE | ORGANIZATION | Delete any org class permitted by deletion rules. |
| DELETE | ADMIN | No additional DELETE extras beyond ORGANIZATION (Family B). |

### EXPORT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| EXPORT | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | **No dedicated class EXPORT API** gated on `SCHOOL_CLASSES`. Class list sets `print: true` for browser print of the visible table; treat as UI convenience, not EXPORT operation enforcement. |

### PRINT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| PRINT | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Same as EXPORT note: shared list **print** affordance; **not** wired to `OPERATIONS.PRINT` on class routes today. |

### IMPORT

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| IMPORT | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | List enables `includeModal_FileImport`; **no** `SCHOOL_CLASSES` import route in `classRoutes`. Bulk class import is not defined by this section matrix until a gated API exists. |

### UPLOAD

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPLOAD | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Class workspace uploads on Manage Session and class forms follow **session** or **core file** rules, not a separate `SCHOOL_CLASSES` UPLOAD route gate in `classRoutes`. |

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION | No Access for class-section CONFIGURE surfaces. |
| CONFIGURE | ADMIN | Reserved for future class-wide configuration routes if added; no CONFIGURE-only class admin page today. Conduct scale redirects use `SCHOOL_SETTINGS`, not `SCHOOL_CLASSES`. |

---

## Class admin and bypass overrides

Apply to **bypass admins (Family A)** where marked. Family B **UPDATE at ADMIN scope** on `SCHOOL_CLASSES` triggers the same **class admin** checks as `isAdminForRequestAsync(..., SCHOOL_CLASSES, UPDATE)` in Manage Session.

| # | Feature / override | Family B class admin (UPDATE + ADMIN scope) | Bypass admin (Family A) |
| --- | --- | --- | --- |
| C1 | Session lock / unlock (`POST .../lock`) | Yes — route requires UPDATE; admin flag used in session UI | Yes |
| C2 | Override completed-session edit windows (attendance, notes, gradebook, cases, conduct, curriculum) | Yes — `canOverrideCompletedSections` | Yes |
| C3 | Administrative session schedule / metadata edits on locked administrative session | Yes — `canOverride` | Yes |
| C4 | Co-teacher management on session when policy restricts non-admins | Yes — `canManageCoTeachers` | Yes |
| C5 | View or edit all org classes without READ_ALL ORGANIZATION | No — still need list scope from READ_ALL tier | Bypass may ignore scope per global bypass rules |

Implementation: `classController.manageSession` (`adminAuthorityService.isAdminForRequestAsync` on `SCHOOL_CLASSES` UPDATE); see manage-session architecture report for panel-level mapping.

---

## Route mapping (`SCHOOL_CLASSES` only)

| Method and route | Operation | Notes |
| --- | --- | --- |
| `GET /school/classes` | READ_ALL | List page |
| `GET /school/classes/api/template/:id` | READ_ALL | Template |
| `GET /school/classes/new`, `GET /school/classes/new-wizard` | CREATE | |
| `POST /school/classes/new` | CREATE | Action token |
| `GET /school/classes/edit/:id`, `GET /school/classes/edit-wizard/:id` | UPDATE | |
| `POST /school/classes/edit/:id` | UPDATE | Action token |
| `GET /school/classes/delete/:id`, `DELETE /school/classes/delete/:id` | DELETE | |
| `GET /school/classes/storage-integrity` | READ_ALL | Page; UPDATE action state for apply |
| `GET /school/classes/api/storage-integrity/scan` | READ_ALL | |
| `POST /school/classes/api/storage-integrity/apply` | UPDATE | |
| `POST /school/classes/api/check-conflicts` | CREATE **or** UPDATE **or** READ_ALL | |
| `POST /school/classes/api/:classId/teacher-assignment-impact` | UPDATE | |
| `POST /school/classes/:id/sessions/:sessionId/lock` | UPDATE | Session lock |
| `GET /school/classes/:id/final-grades` | READ_ALL | OR with gradebook / departments |
| `POST /school/classes/api/:id/official-final-grades` | UPDATE | OR with gradebook / departments |
| `POST /school/classes/api/:classId/sessions/preview-batch` | UPDATE | **Also** `SCHOOL_ROLLING_ENROLLMENT` UPDATE |
| `POST /school/classes/api/:classId/sessions/enrollment-gap-conflict-review` | UPDATE | **Also** rolling enrollment |
| `POST /school/classes/api/:classId/sessions/append-batch` | UPDATE | **Also** rolling enrollment |

---

## Runtime services

| Service / module | Role |
| --- | --- |
| `schoolRecordAccessService` | `buildRouteAccessContext`, `isClassAccessible`, `assertClassAccessible`, session accessibility (Manage Session — `SCHOOL_SESSIONS` context) |
| `schoolDataService` | `fetchDataPaged` / `getDataById` for `classes` with entity scope |
| `school/repositories` `classes` | `assignmentScopeKind: 'instructor'`, `buildSchoolScopeFilter` |
| `schoolEntityPickerService` | Class terminal; requires `SCHOOL_CLASSES` |
| `adminAuthorityService` | Class admin: `SCHOOL_CLASSES` UPDATE + ADMIN scope |
| `classController` | List, CRUD, storage integrity, Manage Session overrides |

**Explicit rule:** Class **list** assignment scope uses **instructor roster only**. `isClassAccessible` for assignment scope does **not** use `classHasSessionDeliveredByPerson` (see unit tests).

---

## Implementation references

| Concern | Location |
| --- | --- |
| Routes | `packages/school/MVC/routes/classRoutes.js` |
| Controller | `packages/school/MVC/controllers/school/classController.js` |
| List scope | `packages/school/MVC/repositories/school/index.js` (`classes` repository) |
| Access service | `packages/school/MVC/services/school/schoolRecordAccessService.js` |
| Data service | `packages/school/MVC/services/school/schoolDataService.js` |
| Entity picker | `packages/school/MVC/services/school/schoolEntityPickerService.js` |
| Tests | `packages/school/test/class-instructor-roster-access.test.js`, `packages/school/test/class-storage-integrity.test.js` |
| Section catalog | MongoDB `sections` collection (`442039` / `SCHOOL_CLASSES`) |

---

## MongoDB catalog and access profiles

When `DATA_BACKEND=mongo`, bind operations on section **`442039` / `SCHOOL_CLASSES`** per [school_sections_manifest_input.json](../../school_sections_manifest_input.json) (operations OP1001–OP1023).

There is **no** dedicated `scripts/seed-school-classes-section.js` in this repository. Apply or verify section bindings in MongoDB directly or via your environment’s section sync process.

**Access profiles:** Section binding alone does not grant user access. Update profiles after catalog changes.

Regenerate Word output from this markdown (source of truth):

```bash
node scripts/design_docs/generate_design_doc_docx.mjs docs/design_docs/classes-operation-scope-capabilities-2026-09-24.md docs/design_docs/classes-operation-scope-capabilities-2026-09-24.docx
```

After publishing a new revision:

1. Add or update the row in [access-definition-catalog.json](access-definition-catalog.json).
2. Move the previous markdown to [archive/](archive/) and list it under `superseded` in the catalog if replacing an older revision.
3. Update [README.md](README.md) access definition table.
