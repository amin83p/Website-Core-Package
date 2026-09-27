# Work Sessions Operation and Scope Capabilities

Access Profile reference | 26 September 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_WORK_SESSIONS` (or fallback `SCHOOL_ACTIVITIES`) access checks on Manage Work Session
- Wiring route gates, UI capability flags, or assignee/session save validation
- Deciding which operation (READ, READ_ALL, CREATE, UPDATE, DELETE) gates each action

**Critical rules:**

1. **Manage Work Session routes** — GET pages use **READ** on `SCHOOL_WORK_SESSIONS` or `SCHOOL_ACTIVITIES`. **What data appears** uses **READ_ALL** scope tiers. **Mutations** use CREATE / UPDATE / DELETE as stated below.
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only**.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — same effective tier as ORGANIZATION on this surface unless noted.
4. **Scope tiers are cumulative** — higher scopes retain lower-scope assignee capabilities on UPDATE.
5. **Timesheet-locked assignees** — locked rows are read-only; when any assignee on an entry is locked, org-wide editors get **partial** session metadata only (title, location, notes; add assignees allowed) — aligned with Edit Activity Form.

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md)
- [classes-operation-scope-capabilities-2026-09-24.md](classes-operation-scope-capabilities-2026-09-24.md) — pattern for capability services

**Status:** **Implemented** — full READ / READ_ALL / CREATE / UPDATE / DELETE matrix in `workSessionAccessService.js`.

---

## Scope of this document for SCHOOL_WORK_SESSIONS

Manage Work Session lives under school activities routes:

- Overview: `/school/activities/:activityId/work-sessions/manage`
- Session editor: `/school/activities/:activityId/work-sessions/:entryId/manage`

Work Session **Explorer** (`/school/work-sessions`) is a separate list surface and remains gated on **READ_ALL** only.

---

## READ (page reachability)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DIVISION / DEPARTMENT / ORGANIZATION / ADMIN (Family B) | May open Manage Work Session overview and session editor routes. **Data visibility** is governed by READ_ALL. |
| READ | Family A bypass | May open all Manage Work Session routes for the active org. |

---

## READ_ALL (data visibility on Manage Work Session)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER / DIVISION / DEPARTMENT | Posted work sessions where the user is an **assignee** only. **Self assignee row only** in the roster. **Read-only** session details (date, time, title, location, status summary). |
| READ_ALL | ORGANIZATION / ADMIN (Family B) | All posted work sessions in the activity. **All assignees** visible. Edit rights follow UPDATE. |
| READ_ALL | Family A bypass | All org work sessions and all assignees. |

---

## CREATE (add assignees to a work session)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER / OWNER / DIVISION / DEPARTMENT | No Access. |
| CREATE | ORGANIZATION / ADMIN (Family B) | Add assignees to a work session (subject to eligibility and locked-session rules). |
| CREATE | Family A bypass | Add assignees on any org work session. |

---

## UPDATE (Manage Work Session)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | On entries where the user is an **assignee**: edit **own row status** only (attendance or completion status). No session metadata, role, times, notes, payable, or paid hours. |
| UPDATE | DIVISION | Assignee-scoped entries. On **own unlocked** row: status, role, start/end (within session window), notes. No payable toggle or paid hours. |
| UPDATE | DEPARTMENT | Same entry visibility as DIVISION. Adds payable toggle and paid hours on own unlocked row (paid hours ≤ assignee time span). |
| UPDATE | ORGANIZATION | Org-wide work sessions. When **no** timesheet-locked assignees: full session metadata and roster field edits. When **any** assignee is locked: partial session edit only (title, location, notes; add assignees; no date/time/status changes). |
| UPDATE | ADMIN (Family B) | Same as ORGANIZATION for Manage Work Session. |

**Family A bypass:** Full UPDATE on all org work sessions and all fields.

---

## DELETE (remove assignees from a work session)

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| DELETE | USER / OWNER / DIVISION / DEPARTMENT | No Access. |
| DELETE | ORGANIZATION / ADMIN (Family B) | Remove **non-locked** assignees from a work session. |
| DELETE | Family A bypass | Remove non-locked assignees on any org work session. |

Whole-session delete on `DELETE /:activityId/work-sessions/:entryId` uses the same DELETE operation gate.

---

## Implementation references

| Concern | Location |
| --- | --- |
| Routes | `packages/school/MVC/routes/activityRoutes.js` |
| Capabilities | `packages/school/MVC/services/school/workSessionAccessService.js` |
| Work session saves | `packages/school/MVC/services/school/activityWorkSessionService.js` |
| Record reachability | `packages/school/MVC/services/school/schoolRecordAccessService.js` |
| UI | `packages/school/MVC/views/school/activity/activityWorkSessionManager.ejs` |
| Tests | `packages/school/test/work-session-update-capabilities.test.js`, `work-session-access-capabilities.test.js` |
| Section seed | `packages/school/scripts/maintenance/seedSchoolWorkSessionsSection.js` |

---

## MongoDB catalog

Section id **555013** (`SCHOOL_WORK_SESSIONS`). Seed via `seedSchoolWorkSessionsSection.js` (operations OP1001–OP1005). Access profiles must grant READ, READ_ALL, CREATE, UPDATE, and DELETE separately as needed.
