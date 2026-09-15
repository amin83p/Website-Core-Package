# Notification Centre Operation and Scope Capabilities

Access Profile reference | 15 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_NOTIFICATION_CENTER` access checks
- Wiring route gates, UI capability flags, or scheduled/on-demand notification runs
- Deciding which operation gates rule configuration, evaluation, preview, and dispatch

**Critical rules:**

1. This doc defines **notification centre section behavior only** — not access to edit sessions, attendance, or timesheets (deep links still use target sections).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only.
4. Evaluators must only include findings the **recipient** can act on; operators see batches filtered by **READ_ALL** scope tier.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md)
- [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md)

**Status:** Promoted with School Notification Centre MVP (rules, runs, preview, dispatch).

---

## SCHOOL_NOTIFICATION_CENTER section pages

| Page / Where | What user can do and see |
| --- | --- |
| **Notification Centre** (`/school/notification-center`) | List rules, run history, trigger on-demand evaluation (preview). |
| **Rule editor** (`/school/notification-center/rules/:id`) | Configure criteria, channels, schedule (**CONFIGURE**). |
| **Run detail** (`/school/notification-center/runs/:id`) | Recipient batches, consolidated previews (**READ_ALL**). |
| **Dispatch** (API) | Queue approved email/SMS for selected batches (**UPLOAD**). |

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

### UPLOAD (dispatch)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPLOAD | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| UPLOAD | ORGANIZATION / ADMIN | Queue email/SMS for approved batches from a preview run. |

---

## Developer notes

- Section id: `445586`, home URL `/school/notification-center`.
- Implementation: `notificationCenterAccessService.js`, `notificationCenterRoutes.js`.
- School Tasks (`SCHOOL_TASKS`) remain separate workflow items; optional future `alsoCreateTask` on rules.
