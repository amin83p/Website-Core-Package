# Student Case Operation and Scope Capabilities

Access Profile reference | 6 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_SESSION_STUDENT_CASES` access checks
- Wiring route gates, UI capability flags, or Manage Session student-cases panel integration
- Deciding which operation (READ, READ_ALL, CREATE, UPDATE, RESOLVE, DELETE, CONFIGURE) gates each student-case action

**Critical rules:**

1. This doc defines **student-case section behavior only** — not which classes/sessions appear (see `SCHOOL_CLASSES` / `SCHOOL_SESSIONS`).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless a separate bypass rule is stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — incremental `"+"` extras, not bypass admins.
4. **No `SCHOOL_SESSIONS` fallback** for student-case operations. Case routes, capability builders, and list filtering use **`SCHOOL_SESSION_STUDENT_CASES` section scope only**.
5. Manage Session page entry remains **`SCHOOL_SESSIONS` READ_ALL**; embedded student-cases panel uses **student-case section capabilities** only. Case-only users use **`/school/session-student-cases`** list + modal.
6. When status becomes **resolved** or **cancelled**, the case is **locked**. UPDATE/DELETE on locked cases requires **RESOLVE** (or **ADMIN scope override**, or bypass admin). RESOLVE grants edit access to locked resolved cases.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope; developer API
- [manage-session-access-architecture-report-2026-09-04.md](../manage-session-access-architecture-report-2026-09-04.md) — Manage Session runtime split

**Status:** **Promoted.** Runtime policy, routes, UI, and tests align with this specification as of September 2026.

---

## Scope of this document for SCHOOL_SESSION_STUDENT_CASES

This document defines **student-case section access only** — what a user may do within `SCHOOL_SESSION_STUDENT_CASES` once central access has approved the requested operation and scope.

Student cases are stored on **sessions**, and sessions belong to **classes**. This document does **not** define which classes or sessions a user can reach. Those boundaries are governed by `SCHOOL_CLASSES` and `SCHOOL_SESSIONS`.

When reading this matrix, assume the user is already viewing a student-case context they are allowed to open under those other sections (or the standalone list page).

### What this document answers

| Question | Answered here | Answered elsewhere |
| --- | --- | --- |
| Can the user open the Session Student Cases list? | **READ** opens page/tab; **READ_ALL** loads filtered case rows | — |
| Which cases appear in the list filter? | **READ_ALL** scope (plus routed-case overrides per notes below) | — |
| Which classes/sessions load on Manage Session? | No | `SCHOOL_SESSIONS` READ_ALL |
| Can the user create/update/resolve/delete a case? | Yes — by CREATE/UPDATE/RESOLVE/DELETE + session mutation scope + locked-case rules | — |
| Can the user configure routing assignees? | **CONFIGURE** at ADMIN scope **or** bypass admin (Family A) | — |

---

## SCHOOL_SESSION_STUDENT_CASES section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Session Student Cases list** (`/school/session-student-cases`) | Primary workspace for case-only users. **READ** (non-USER) opens the page shell; **READ_ALL** is required for populated list data and review-context payloads. Create/resolve/delete actions use CREATE/UPDATE/RESOLVE/DELETE plus session mutation scope. |
| **Routing admin** (`/school/session-student-cases/routing`) | Configure org routing assignees. Route gate: **CONFIGURE** at ADMIN scope **or** bypass admin (Family A). |
| **Manage Session — student cases panel** | Embedded on `/school/classes/:classId/sessions/:sessionId`. Page load uses `SCHOOL_SESSIONS` READ_ALL. Student Cases **tab**: `SCHOOL_SESSION_STUDENT_CASES` **READ** (non-USER). Embedded **case list API** (`GET .../cases`): **READ_ALL**. Mutations: CREATE / UPDATE / RESOLVE / DELETE per operation tables + session mutation scope. Panel capabilities from `studentCaseCapabilities` only. |

---

## Access profile definitions — SCHOOL_SESSION_STUDENT_CASES

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Only open the page. Later we will check the READ_ALL access for loading the page with data. |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | Can see the list of the cases they created within the active org. |
| READ_ALL | DEPARTMENT / DIVISION | Can see the list of the cases that have been created for the classes they can see in the class picker. The cases are only within the active org. |
| READ_ALL | ORGANIZATION | Org-wide case visibility in list. |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION (Family B). |

**Notes:**

- The **READ** access (non-USER scopes) allows picking the Student Cases tab on Manage Session. Proper **READ_ALL** access loads the cases for that session. Adding a new item is based on **CREATE** access and scope.
- For **OWNER**, **DEPARTMENT**, and **DIVISION**, actors can also see list cases which are **routed to them** (in addition to scope-filtered rows).

### CREATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER | No Access. |
| CREATE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Create cases on sessions where the actor passes **session mutation scope** (`isSessionAccessible` with student-case section context). |

### Case lifecycle (locked resolved/cancelled)

When status becomes **resolved** or **cancelled**, the case is **locked**. **UPDATE** and **DELETE** on locked cases require **RESOLVE** (or **ADMIN scope override**, or bypass admin). **RESOLVE** grants edit access to locked resolved cases (result fields, reopen flows).

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | Edit cases the actor created. Cannot edit **locked resolved/cancelled** cases without proper RESOLVE access. |
| UPDATE | DEPARTMENT / DIVISION | Can edit the cases that have been created for the classes the actor can see in the class picker. Cannot edit **locked resolved/cancelled** cases without proper RESOLVE access. |
| UPDATE | ORGANIZATION | Org-wide case modification in list. Cannot edit **locked resolved/cancelled** cases without proper RESOLVE access. |
| UPDATE | ADMIN | May edit all in-scope cases, including **locked resolved/cancelled** and routed cases, without RESOLVE (**ADMIN scope override**). |

**Notes:**

- For **OWNER**, **DEPARTMENT**, and **DIVISION**, actors can also edit cases which are **routed to them** when those cases are **not locked** (not resolved/cancelled, or unlocked).
- All case actions are only within the **active org**.

### RESOLVE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| RESOLVE | USER | No Access. |
| RESOLVE | OWNER | Can resolve cases the actor created. Edit cases the actor created and **resolved** (result fields). |
| RESOLVE | DEPARTMENT / DIVISION | Can resolve cases created for classes visible in the class picker; may edit **resolved** cases (result fields) when RESOLVE is granted. |
| RESOLVE | ORGANIZATION | Resolve org-wide cases. Org-wide **resolved** case modification (result fields). |
| RESOLVE | ADMIN | No additional RESOLVE extras beyond ORGANIZATION (Family B). ADMIN override for locked-case edit/delete is defined under UPDATE/DELETE rows. |

**Note:** Routed assignees with **RESOLVE** may resolve and edit **locked resolved** routed cases.

### DELETE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER | No Access. |
| DELETE | OWNER | Can delete cases the actor created when those cases are **not locked** (not resolved/cancelled, or unlocked). |
| DELETE | DEPARTMENT / DIVISION | Can delete cases created for classes visible in the class picker when those cases are **not locked**. |
| DELETE | ORGANIZATION | Org-wide case deletion when cases are **not locked**. |
| DELETE | ADMIN | May delete all in-scope cases, including **locked resolved/cancelled**, without RESOLVE (**ADMIN scope override**). |

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION / ORGANIZATION | No Access. |
| CONFIGURE | ADMIN | Routing admin pages and APIs under `/school/session-student-cases/routing`. Either Family B CONFIGURE at ADMIN or bypass admin (Family A). |

---

## Route mapping

| Method and route | Section | Operation |
| --- | --- | --- |
| `GET /school/session-student-cases` | `SCHOOL_SESSION_STUDENT_CASES` | READ (page); list **data** requires READ_ALL in controller/workspace |
| `GET /school/session-student-cases/routing` | `SCHOOL_SESSION_STUDENT_CASES` | CONFIGURE (ADMIN or bypass admin) |
| `POST /school/session-student-cases/api/routing` | `SCHOOL_SESSION_STUDENT_CASES` | CONFIGURE (ADMIN or bypass admin) |
| `GET /school/session-student-cases/:caseId/review-context` | `SCHOOL_SESSION_STUDENT_CASES` | READ_ALL |
| `POST /school/session-student-cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | CREATE or UPDATE |
| `POST /school/session-student-cases/:caseId/status` | `SCHOOL_SESSION_STUDENT_CASES` | RESOLVE or UPDATE |
| `DELETE /school/session-student-cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | DELETE |
| `GET /school/classes/:id/sessions/:sessionId/cases` | `SCHOOL_SESSION_STUDENT_CASES` | READ_ALL |
| `POST /school/classes/:id/sessions/:sessionId/cases` | `SCHOOL_SESSION_STUDENT_CASES` | CREATE |
| `POST /school/classes/:id/sessions/:sessionId/cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | UPDATE |
| `POST /school/classes/:id/sessions/:sessionId/cases/:caseId/status` | `SCHOOL_SESSION_STUDENT_CASES` | RESOLVE or UPDATE |
| `DELETE /school/classes/:id/sessions/:sessionId/cases/:caseId` | `SCHOOL_SESSION_STUDENT_CASES` | DELETE |

**Note:** READ-only users may reach READ-gated routes but receive empty or read-shell responses where **READ_ALL** is required for case data.

---

## Runtime services

| Service | Role |
| --- | --- |
| `studentCaseOperationPolicyService` | Scope allowlists, USER-scope rejection, admin bypass, `deriveAccessFlags`; READ vs READ_ALL split, OWNER READ_ALL visibility, ADMIN override flags |
| `studentCaseAccessService` | `buildStudentCaseAccess`, `buildStudentCaseSectionAccessContext` (section scope for mutation + list filter) |
| `sessionStudentCaseAccessService` | Capability mapping, routed-case overrides, session mutation checks |
| `sessionStudentCaseWorkspaceService` | List filtering via student-case section scope; returns list data only when READ_ALL (`canViewCases`) |
| `sessionStudentCaseResultVisibilityService` | Locked-case edit/delete rules; auto-lock on resolve/cancel; ADMIN scope override path |
| `sessionStudentCaseRouteGuards` | Route operation gates; routing admin = CONFIGURE at ADMIN **or** bypass admin |

**Explicit rule:** Session mutation scope for case writes uses `buildStudentCaseSectionAccessContext(user, builtAccess)` — **not** `resolveAccessFromRequest(req)` from Manage Session middleware.

---

## Completed-session edit window

Student case writes respect org policy key **`completedSessionStudentCasesEdit`**. When the edit window closes for a completed session:

- Writes are blocked unless the actor has **class admin override** (`canOverrideCompletedSections` on Manage Session).
- **Locked-case rules still apply** unless **ADMIN scope override** or bypass admin applies.
- Read paths (`canRead`, `canReadAll`) are unaffected.

---

## Routing assignee overrides

When a case is routed to the viewer's person record:

- **Read/list:** Routed assignees gain **read/list visibility** for that case even when normal READ_ALL scope would exclude it (see READ_ALL notes).
- **Update:** Routed assignees may **edit** routed cases when those cases are **not locked**; locked resolved/cancelled cases require **RESOLVE** (or ADMIN override / bypass admin).
- **Resolve:** Routed assignees with **RESOLVE** may resolve and edit **locked resolved** routed cases.

---

## MongoDB catalog

When `DATA_BACKEND=mongo`, bind operations on section **`778771` / `SCHOOL_SESSION_STUDENT_CASES`** only:

```bash
node scripts/seed-school-student-cases-section.js
node scripts/school/verify-student-case-access-profiles.js
```

Dry-run:

```bash
node scripts/seed-school-student-cases-section.js --dry-run
```

**Access profiles:** Grant **READ_ALL at OWNER** if OWNER-own-case list visibility is desired. Section binding alone does not grant user access.

Regenerate Word output from this markdown (source of truth):

```bash
python scripts/design_docs/generate_design_doc_docx.py docs/design_docs/student-case-operation-scope-capabilities-2026-09-06.md docs/design_docs/student-case-operation-scope-capabilities-2026-09-06.docx
```

Code changes alone do not update Mongo catalog bindings or access profiles.
