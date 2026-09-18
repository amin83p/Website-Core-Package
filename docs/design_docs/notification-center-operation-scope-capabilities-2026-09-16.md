# Notification Centre Operation and Scope Capabilities

Access Profile reference | 16 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_NOTIFICATION_CENTER` access checks
- Wiring route gates, UI capability flags, on-demand rule evaluation, preview runs, and email outbox actions
- Deciding which operation gates rule configuration, run review, compose/schedule, and outbox cleanup

**Critical rules:**

1. This doc defines **notification centre section behavior only** — not access to edit sessions, attendance rosters, or timesheets. Evaluators **read** those domains using the actor’s data scope; deep links still require the target section’s access.
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — incremental `"+"` extras, not bypass admins.
4. Evaluators must only include findings the **recipient** can act on. Operators reviewing runs see **batches and findings filtered by READ_ALL scope tier** (not org-wide unless ORGANIZATION scope or bypass).
5. **Evaluation workflow:** Operators may **Run now** (manual preview) or enable **scheduled evaluation** per rule (weekdays + run time). Wall-clock time uses the **active organization timezone** (same as uncompleted session notifications). Optional **activity date window** (start/end dates, organization calendar) limits **scheduled** evaluation only; **Run now** is not gated by the window. Scheduled runs register `school.notificationCenter.prepare` weekly task definitions (`sourceRef` `rule:{ruleId}`, `input.daysOfWeek`) and store **preview-only** results in notification runs. Task `enabled` on sync and `prepareScheduledRule` both respect the activity window for the org’s current date. Email/SMS still requires compose from run review (outbox). Pausing or cancelling the scheduled task, disabling the rule, or being outside the activity window stops automatic evaluation. NC dispatch tasks remain unused.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope; developer API
- [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md) — attendance **data** evaluators may reference; not NC route gates

**Status:** Target specification for `SCHOOL_NOTIFICATION_CENTER` access promotion. Implementation should match this matrix; gaps are bugs until promoted.

**Navigation:** School dashboard tile (`/school` → Notification Centre). Package catalog: section **445586** nested under **SCHOOL_REPORTS**. List UI follows [list-page-development-guide.md](../../packages/school/docs/list-page-development-guide.md).

---

## Scope of this document for SCHOOL_NOTIFICATION_CENTER

This document defines **notification centre section access only** — what a user may do within `SCHOOL_NOTIFICATION_CENTER` once central access has approved the requested operation and scope.

Findings reference **classes, sessions, and timesheets**. Which rows evaluators return is governed by the actor’s **school list scope** (`schoolRecordAccessService`) and org data rules. This document does **not** replace `SCHOOL_CLASSES`, `SCHOOL_SESSIONS`, or timesheet section matrices.

When reading this matrix, assume the user already has the NC operation at the stated scope.

### What this document answers

| Question | Answered here | Answered elsewhere |
| --- | --- | --- |
| Can the user open Notification Centre home? | Yes — `READ` | — |
| Can the user see rule list metadata on home (label, type, enabled)? | Yes — `READ_ALL` at ORGANIZATION / ADMIN only | — |
| Can the user create or edit notification rules? | Yes — `CONFIGURE` | — |
| Can the user run a rule now (preview evaluation)? | Yes — `UPDATE` at ORGANIZATION / ADMIN only | — |
| Can the user open run review and see teacher/session findings? | Yes — `READ_ALL` (filtered by scope tier) | — |
| Can the user compose and schedule email for selected sessions? | Yes — `UPLOAD` | — |
| Can the user list scheduled NC emails, cancel queued, delete failed? | `READ_ALL` / `UPLOAD` / `DELETE` respectively | — |
| Can the user delete rows from Recent runs on home? | Yes — `DELETE` at ORGANIZATION / ADMIN | — |
| Which classes/sessions appear in evaluator findings? | Partially — filtered with actor scope during evaluation and run display | `SCHOOL_CLASSES` / `SCHOOL_SESSIONS` |

### How to read operation and scope rows

Each row answers: *Given NC access at this scope, what centre actions and run/outbox visibility are permitted?*

**Incremental scopes:** `+` = additional visibility or actions at that scope level. Effective access is cumulative unless stated otherwise. Operation tables apply to non-bypass users only.

---

## SCHOOL_NOTIFICATION_CENTER section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Notification Centre** (`/school/notification-center`) | Open home (**READ**). **Rules** and **Recent runs** table shells are always visible when home is open; rule metadata and run rows populate only when the matching operation/scope applies (see Home UI capability flags). **Run now** shows a waiting modal then opens run review (**UPDATE** at ORGANIZATION / ADMIN). Recent preview runs when **READ_ALL** granted (sortable; read/unread icons per user). Links to rule editor (**CONFIGURE**), run review (**READ_ALL**), scheduled emails (**READ_ALL**). |
| **Rule editor** (`/school/notification-center/rules/:id`) | Configure rule type, criteria, channels, email compose, optional **weekday + run time** schedule, and optional **activity date window** for scheduled evaluation (**CONFIGURE**). Saving syncs scheduled task definitions when evaluation schedule is enabled and today falls within the activity window (if configured). |
| **Run review** (`/school/notification-center/runs/:id`) | Teacher → class → session tree for batches visible at actor’s READ_ALL scope; select sessions; open compose when UPLOAD granted (**READ_ALL**). |
| **Compose / schedule** (`/school/notification-center/runs/:id/compose`, `POST .../schedule-email`) | Edit generated subject/body; set send datetime; queue to core email outbox (**UPLOAD**). |
| **Scheduled emails** (`/school/notification-center/outbox`) | List NC outbox rows (**READ_ALL**). Cancel queued (**UPLOAD**). Delete cancelled/failed (**DELETE**). |

---

## Admin reference (do not duplicate here)

See [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) for bypass admin types (Family A).

| Topic | See |
| --- | --- |
| Bypass admin types (Family A) | [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) |
| ADMIN in scope column (Family B) | Access Profile ADMIN scope (`SCP_ADMIN`) only |

---

## Access profile definitions — SCHOOL_NOTIFICATION_CENTER

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Open Notification Centre home. **Cannot** see rule list metadata (label, type, enabled). **Cannot** see recent run rows, edit rules, or outbox without other operations. Both **Rules** and **Recent runs** table shells are visible; cells stay masked or empty until the user gains the operation that unlocks that content. |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | View runs and batches where the actor is the **recipient** (teacher person id) or is a **session editor** on at least one finding in the batch. Does **not** unlock rule list metadata on home. |
| READ_ALL | DEPARTMENT / DIVISION | View runs and batches whose findings reference classes/sessions in the actor’s **assignment (class-picker) scope**. Does **not** unlock rule list metadata on home. |
| READ_ALL | ORGANIZATION | Org-wide run and batch visibility. **Can see rule list metadata** on home (label, type, enabled). |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION (Family B). |

**Notes:**

- Run list on home shows only runs that have at least one visible batch after filtering.
- Run detail presentation tree is filtered the same way.

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| CONFIGURE | ORGANIZATION | Create, edit, pause, and save notification rules. |
| CONFIGURE | ADMIN | Same as ORGANIZATION (Family B). |

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER / DEPARTMENT / DIVISION | No Access. |
| UPDATE | ORGANIZATION | Trigger on-demand evaluation (“Run now”); creates preview runs. |
| UPDATE | ADMIN | Same as ORGANIZATION (Family B). |

### UPLOAD (schedule email)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPLOAD | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| UPLOAD | ORGANIZATION / ADMIN | Open compose from run review; schedule email for selected sessions; cancel **queued** NC outbox entries. |

### DELETE (runs and outbox cleanup)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| DELETE | ORGANIZATION / ADMIN | Delete rows from the **Recent runs** table on home. Delete **cancelled** or **failed** NC outbox rows (not queued/sending). |

---

## Home UI capability flags

Implementers map Access Profile evaluations to UI and secondary checks in `notificationCenterOperationPolicyService.deriveAccessFlags`:

| Flag | When true (non-bypass) |
| --- | --- |
| `canOpen` | READ allowed at OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN |
| `canViewRuleMetadata` | READ_ALL allowed at ORGANIZATION / ADMIN / global |
| `canViewRuns` | READ_ALL allowed at OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN |
| `canConfigure` | CONFIGURE allowed at ORGANIZATION / ADMIN / global |
| `canRunNow` | UPDATE allowed at ORGANIZATION / ADMIN / global |
| `canDispatch` | UPLOAD allowed at ORGANIZATION / ADMIN / global |
| `canDeleteRuns` | DELETE allowed at ORGANIZATION / ADMIN / global |
| `canDeleteOutbox` | DELETE allowed at ORGANIZATION / ADMIN / global |

Bypass admins (Family A) receive the corresponding bypass for each operation under test.

---

## Rule types (informational)

| Rule type | Evaluates | Typical recipients |
| --- | --- | --- |
| `session_not_final` | Sessions not in a final status in date range | Session editors |
| `session_attendance_incomplete` | Sessions with unmarked roster attendance | Session editors |
| `timesheet_not_submitted` | Timesheets in configured statuses | Teacher on timesheet |

Current UI supports **email schedule** only (no SMS dispatch from NC compose).

---

## Route-to-operation matrix

| Method | Path | Operation | Scope behavior |
| --- | --- | --- | --- |
| GET | `/school/notification-center` | READ | Open home |
| GET | `/school/notification-center/rules/:id` | CONFIGURE | Rule editor |
| POST | `/school/notification-center/rules/save` | CONFIGURE | Save rule |
| POST | `/school/notification-center/rules/:id/run` | UPDATE | Run now (ORG / ADMIN scope) |
| GET | `/school/notification-center/runs/:id` | READ_ALL | Run review (filtered) |
| POST | `/school/notification-center/runs/:id/delete` | DELETE | Delete recent run row |
| GET | `/school/notification-center/runs/:id/compose` | UPLOAD | Compose email |
| POST | `/school/notification-center/runs/:id/schedule-email` | UPLOAD | Queue outbox |
| GET | `/school/notification-center/outbox` | READ_ALL | List outbox |
| POST | `/school/notification-center/outbox/:id/cancel` | UPLOAD | Cancel queued |
| POST | `/school/notification-center/outbox/:id/delete` | DELETE | Delete terminal outbox rows |

---

## Developer notes

- Section id: `445586`, name: `SCHOOL_NOTIFICATION_CENTER`, home URL `/school/notification-center`.
- Routes: `packages/school/MVC/routes/notificationCenterRoutes.js`
- Access flags: `packages/school/MVC/services/school/notificationCenterAccessService.js`, policy `notificationCenterOperationPolicyService.js`, run filtering `notificationCenterRunScopeService.js`
- Tests: `test/school-notification-center-access.test.js`, `test/school-notification-center-feature.test.js`
- School Tasks (`SCHOOL_TASKS`) remain separate; optional future `alsoCreateTask` on rules.

Regenerate Word copy:

```bash
python scripts/design_docs/generate_design_doc_docx.py docs/design_docs/notification-center-operation-scope-capabilities-2026-09-16.md "docs/design_docs/School Notification-operation-scope-capabilities-2026-09-16.docx"
```

Node fallback (requires `npm install docx`):

```bash
node scripts/design_docs/generate_design_doc_docx.mjs docs/design_docs/notification-center-operation-scope-capabilities-2026-09-16.md "docs/design_docs/School Notification-operation-scope-capabilities-2026-09-16.docx"
```
