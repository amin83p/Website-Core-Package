# Notification Centre Operation and Scope Capabilities

> **Superseded:** Use [notification-center-operation-scope-capabilities-2026-09-16.md](../notification-center-operation-scope-capabilities-2026-09-16.md).

Access Profile reference | 15 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_NOTIFICATION_CENTER` access checks
- Wiring route gates, UI capability flags, or scheduled/on-demand notification runs
- Deciding which operation gates rule configuration, evaluation, preview, and dispatch

**Critical rules:**

1. This doc defines **notification centre section behavior only** — not access to edit sessions, attendance, or timesheets (deep links still use target sections).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](../admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only.
4. Evaluators must only include findings the **recipient** can act on; operators see batches filtered by **READ_ALL** scope tier.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](../admin-access-types-reference-2026-09-05.md)
- [attendance-operation-scope-capabilities-2026-09-06.md](../attendance-operation-scope-capabilities-2026-09-06.md)

**Status:** Manual workflow (no background prepare/dispatch tasks). Operators run rules, review findings, and schedule email only.

**Navigation:** Primary entry is the **School dashboard** tile (`/school` → Notification Centre, grouped beside Reports). Package catalog nests section **445586** under **SCHOOL_REPORTS**. List UI follows [list-page-development-guide.md](../../../packages/school/docs/list-page-development-guide.md) (Skills baseline).

**Automation:** Notification Centre does **not** register active scheduled prepare/dispatch tasks. Legacy `school.notificationCenter` task definitions are disabled when rules are saved or the centre home loads.

---

## SCHOOL_NOTIFICATION_CENTER section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Notification Centre** (`/school/notification-center`) | List rules, recent preview runs, link to scheduled emails. |
| **Rule editor** (`/school/notification-center/rules/:id`) | Configure rule type, criteria, and whether email compose is allowed (**CONFIGURE**). |
| **Run review** (`/school/notification-center/runs/:id`) | Teacher → class → session tree; select sessions; open compose (**READ_ALL**). |
| **Compose / schedule** (`/school/notification-center/runs/:id/compose`) | Edit generated subject/body; set send datetime; queue to core email outbox (**UPLOAD**). |
| **Scheduled emails** (`/school/notification-center/outbox`) | List NC outbox rows; cancel queued; delete cancelled/failed (**READ_ALL** / **UPLOAD** / **DELETE**). |

---

## Access profile definitions — SCHOOL_NOTIFICATION_CENTER

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Open centre shell and own-addressed batch summaries (phase 2+). |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | View runs and batches for recipients tied to the actor’s delivery roles. |
| READ_ALL | DEPARTMENT / DIVISION | View runs and batches for teachers/sessions in class-picker scope. |
| READ_ALL | ORGANIZATION | Org-wide run and batch visibility. |
| READ_ALL | ADMIN | No additional READ_ALL extras beyond ORGANIZATION (Family B). |

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| CONFIGURE | ORGANIZATION | Create, edit, pause notification rules and schedules. |
| CONFIGURE | ADMIN | Same as ORGANIZATION (Family B). |

### UPDATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | No Access. |
| UPDATE | DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Trigger on-demand evaluation (“Run now”, preview runs). |

### UPLOAD (schedule email)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPLOAD | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| UPLOAD | ORGANIZATION / ADMIN | Compose and schedule email for selected sessions from a preview run; cancel queued NC outbox entries. |

### DELETE (outbox cleanup)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | ORGANIZATION / ADMIN | Delete cancelled or failed NC outbox rows (not queued/sending). |

---

## Developer notes

- Section id: `445586`, home URL `/school/notification-center`.
- Implementation: `notificationCenterAccessService.js`, `notificationCenterRoutes.js`.
- School Tasks (`SCHOOL_TASKS`) remain separate workflow items; optional future `alsoCreateTask` on rules.
