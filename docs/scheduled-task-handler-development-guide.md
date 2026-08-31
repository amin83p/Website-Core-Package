# Scheduled Task Handler Development Guide

Use this guide when adding a **new automated scheduled task** to the platform. Give this file to an AI assistant or follow it manually so you do not need to re-explain the architecture each time.

---

## Mental model (3 layers)

| Layer | What it stores | Responsibility |
|-------|----------------|----------------|
| **Definition** | `scheduledTaskDefinition` (Mongo/JSON) | **When** to run: `taskKey`, `orgId`, schedule, `enabled`, `nextRunAt` |
| **Registry** | In-memory map at startup | **Which code** runs for a `taskKey` |
| **Handler** | Your service function | **What** actually happens when the task fires |

The scheduler does **not** scan packages or auto-discover services. Resolution is always:

```
scheduledTaskDefinition.taskKey  →  scheduledTaskRegistry.getScheduledTaskHandler(taskKey)  →  handler()
```

If the `taskKey` on the definition has no registered handler, the run fails with `No handler registered for task '…'`.

---

## Core vs package: which service goes where?

| Use **core** when… | Use **package** (e.g. SCHOOL) when… |
|--------------------|--------------------------------------|
| Cross-cutting platform work (email outbox dispatch, retention, etc.) | Domain logic belongs to one package (sessions, attendance, school policies) |
| Any package may enqueue work into a shared core facility | Task reads/writes package-owned data or rules |
| Task key should start with `core.` | Task key should start with `{package}.` (e.g. `school.`) |

**Examples today**

| `taskKey` | Owner | Handler registration | Service invoked |
|-----------|-------|----------------------|-----------------|
| `core.emailOutbox.dispatch` | Core | `MVC/services/coreScheduledTaskRegistration.js` | `emailOutboxDispatchService.dispatchDue()` |
| `core.smsOutbox.dispatch` | Core | `MVC/services/coreScheduledTaskRegistration.js` | `smsOutboxDispatchService.dispatchDue()` |
| `school.uncompletedSessionEmail.prepare` | School | `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js` | `sessionNotificationPrepareService.prepareUncompletedSessionEmailsForOrg()` |
| `school.uncompletedSessionEmail.dispatch` | School | `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js` | `sessionNotificationOutboxDispatchService.dispatchUncompletedSessionEmailsForOrg()` |
| `school.uncompletedSessionSms.prepare` | School | `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js` | `sessionNotificationPrepareService.prepareUncompletedSessionSmsForOrg()` |
| `school.uncompletedSessionSms.dispatch` | School | `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js` | `sessionNotificationOutboxDispatchService.dispatchUncompletedSessionSmsForOrg()` |

Packages **cannot** register `core.*` keys. Core handlers are registered once in `app.js` via `registerCoreScheduledTasks()`.

---

## `taskKey` naming convention

Use dot-separated, stable identifiers:

```
{owner}.{domain}.{action}
```

- **Core:** `core.emailOutbox.dispatch`
- **School:** `school.uncompletedSessionEmail.prepare`
- **Future school example:** `school.session.autoCompleteWhenAttendanceMarked`

Export the key as a constant (e.g. `TASK_KEY`) from a sync module so definitions and registration stay in sync.

---

## Handler contract

Handlers are registered with `registerCoreScheduledTaskHandler` or `registerPackageScheduledTaskHandler`.

### Registration shape

```javascript
registerPackageScheduledTaskHandler('SCHOOL', {
  taskKey: 'school.myDomain.myAction',
  label: 'Human-readable label',
  description: 'What this task does',
  scope: 'org', // 'org' | 'system'
  handler: async ({ definition, orgId, input, run, logger, now }) => {
    // call your service here
    return {
      resultSummary: 'Short outcome for admin run log',
      metrics: { processed: 12, skipped: 3 } // optional
    };
  }
});
```

### Handler arguments

| Arg | Meaning |
|-----|---------|
| `definition` | Full `scheduledTaskDefinition` row |
| `orgId` | Org scope (`''` for system-wide tasks) |
| `input` | JSON from `definition.input` (policy-specific payload) |
| `run` | Current `scheduledTaskRun` row |
| `logger` | `{ info(), error() }` — lines stored on the run |
| `now` | Execution timestamp |

### Return value

Return `{ resultSummary, metrics? }`. The orchestrator marks the run `succeeded` or `failed` and updates `definition.lastRunAt` / `nextRunAt`.

---

## Checklist: add a new **package** task (School)

Copy this checklist for each new school automated task.

### 1. Implement the service

Create something like:

```
packages/school/MVC/services/school/<yourTask>Service.js
```

- Accept `{ orgId, … }` (and optional `logger`).
- Return metrics object: `{ processed, skipped, … }`.
- Use `schoolDataService` / existing school services — not raw JSON files when Mongo is active.
- Keep side effects idempotent where possible (safe if the scheduler runs twice).

### 2. Register the handler

In `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js`:

- Import your service.
- Call `registerPackageScheduledTaskHandler('SCHOOL', { taskKey, handler, … })`.

Registration runs from `packages/school/MVC/routes/schoolMainRoute.js` → `registerSchoolScheduledTasks()` on package mount. **Do not** register school handlers in `app.js`.

### 3. Create or sync the definition (schedule)

The handler only defines **what** runs. You still need a **definition** row for **when** it runs.

**Option A — Policy/settings sync (recommended for org-scoped tasks)**

Create `*TaskSyncService.js` that calls core:

```javascript
const scheduledTaskDefinitionService = requireCoreModule('MVC/services/scheduledTaskDefinitionService');

await scheduledTaskDefinitionService.upsertDefinition({
  orgId,
  packageName: 'SCHOOL',
  taskKey: TASK_KEY,
  label: '…',
  description: '…',
  scheduleType: 'daily',        // or 'interval' for system-style ticks
  runAtTime: '17:00',           // HH:MM in org timezone
  timezone,
  enabled: true,                // set false when feature disabled
  paused: false,
  source: 'school.myFeature',   // provenance for upsert matching
  sourceRef: orgId,
  input: { /* optional payload for handler */ }
});
```

Call sync from the relevant save handler (e.g. school settings controller after policy save).

**Reference:** `packages/school/MVC/services/school/sessionAccessPolicyTaskSyncService.js`

**Option B — One-off / manual**

Upsert via admin UI (`/scheduled-tasks`) or seed script for system-wide definitions.

### 4. Wire settings UI (if user-configurable)

If schedule time or enable/disable comes from school settings:

- Add fields to policy/model + settings EJS.
- Call your `*TaskSyncService` on save.

### 5. Tests

Add `test/school-<feature>-scheduled-task.test.js` (or extend existing):

- Handler registered (grep `schoolMainRoute.js` / registration file).
- Service unit test with mocked dependencies.
- Sync service upserts definition with expected `taskKey`, `runAtTime`, `enabled`.
- Optional: orchestrator test with mocked handler.

Run: `node --test test/<your-test>.test.js`

### 6. Do **not** do this

- Do not add a new `setInterval` in the package — use the core scheduler only.
- Do not call `emailOutboxDispatchService` directly from package code — enqueue via `emailOutboxService` and let `core.emailOutbox.dispatch` send.
- Do not call `smsOutboxDispatchService` directly from package code — enqueue via `smsOutboxService` and let `core.smsOutbox.dispatch` send.
- Do not use immediate `emailDispatchService.sendByEvent` for deferred work — use the outbox pattern instead.

---

## Checklist: add a new **core** task

Only for platform-wide automation.

1. Implement service under `MVC/services/`.
2. Register in `MVC/services/coreScheduledTaskRegistration.js` with `registerCoreScheduledTaskHandler`.
3. Ensure `registerCoreScheduledTasks()` is called from `app.js` (already wired).
4. Bootstrap definition if needed (see `ensureSystemDispatchDefinition` for interval-based core tasks).
5. Add tests under `test/scheduled-tasks.*.test.js`.

---

## Email: immediate vs scheduled

| Pattern | When | API |
|---------|------|-----|
| **Immediate** | Password reset, contact form, etc. | `emailDispatchService.sendByEvent()` — unchanged |
| **Scheduled** | Digest prepared now, sent later | Package handler → `emailOutboxService.enqueue({ …, sendAt })` → core `core.emailOutbox.dispatch` sends when due |

Two-phase school notifications (daily recurring prepare + dispatch):

1. **Prepare email** (`school.uncompletedSessionEmail.prepare` at `prepareAtTime`) — build payloads for the org's current `cycleDate`, write email outbox rows with `sendAt` on the org wall clock. If `sendAtTime` is earlier on the clock than `prepareAtTime`, `sendAt` uses the next calendar day (cross-midnight).
2. **Dispatch email** (`school.uncompletedSessionEmail.dispatch` at `sendAtTime`) — sends due email outbox rows for the org.
3. **Prepare SMS** (`school.uncompletedSessionSms.prepare` at `prepareAtTime`) — same pattern for SMS outbox.
4. **Dispatch SMS** (`school.uncompletedSessionSms.dispatch` at `sendAtTime`) — sends due SMS outbox rows for the org.
5. **Safety net** — `core.emailOutbox.dispatch` and `core.smsOutbox.dispatch` (interval) still sweep overdue rows platform-wide.

Policy sync (`sessionAccessPolicyTaskSyncService`) upserts all four org tasks when school settings are saved and on school package startup. Tasks persist until disabled by policy, updated on save, or manually deleted. Prepare and send must be at least **10 minutes** apart in the daily cycle (cross-midnight aware); for example, prepare `22:20` with send `01:00` is valid.

---

## Example brief: auto-complete session when attendance is marked

When asking an AI to implement this, include:

```
Read docs/scheduled-task-handler-development-guide.md

Feature: Auto-complete school sessions when all attendance is marked.

taskKey: school.session.autoCompleteWhenAttendanceMarked
package: SCHOOL
scope: org
schedule: daily at 23:00 org local time (or sync from school settings)
service: packages/school/MVC/services/school/sessionAutoCompleteService.js
  - list candidate sessions for org
  - skip already completed
  - mark complete when attendance rules pass
registration: schoolScheduledTaskRegistration.js
definition sync: sessionAutoCompleteTaskSyncService.js (call on settings save)
tests: test/school-session-auto-complete-task.test.js
```

---

## Runtime flow (reference)

```
app.js
  registerCoreScheduledTasks()
  scheduledTaskSchedulerService.start()
       ↓ tick
scheduledTaskOrchestratorService.runDueTasks()
       ↓ load definitions where enabled && !paused && nextRunAt <= now
       ↓ for each definition
getScheduledTaskHandler(definition.taskKey)
       ↓
handler({ orgId, input, logger, … })
       ↓
scheduledTaskRun updated (succeeded/failed)
definition.nextRunAt recomputed
```

---

## Key files (quick map)

| Purpose | Path |
|---------|------|
| Registry | `MVC/services/scheduledTaskRegistry.js` |
| Orchestrator | `MVC/services/scheduledTaskOrchestratorService.js` |
| Scheduler tick | `MVC/services/scheduledTaskSchedulerService.js` |
| Core registration | `MVC/services/coreScheduledTaskRegistration.js` |
| Definition upsert | `MVC/services/scheduledTaskDefinitionService.js` |
| School registration | `packages/school/MVC/services/school/schoolScheduledTaskRegistration.js` |
| School policy sync example | `packages/school/MVC/services/school/sessionAccessPolicyTaskSyncService.js` |
| School prepare example | `packages/school/MVC/services/school/sessionNotificationPrepareService.js` |
| Email outbox enqueue | `MVC/services/emailOutboxService.js` |
| SMS outbox enqueue | `MVC/services/smsOutboxService.js` |
| SMS messaging provider | `MVC/services/sms/smsProviderService.js` |
| Admin UI | `/scheduled-tasks`, `/scheduled-tasks/runs`, `/scheduled-tasks/outbox` |
| List page UI guide | `packages/school/docs/list-page-development-guide.md` |
| App startup | `app.js` (`registerCoreScheduledTasks`, `scheduledTaskSchedulerService.start`) |
| School mount | `packages/school/MVC/routes/schoolMainRoute.js` |

---

## Prompt template for AI assistants

Paste this when starting a new task feature:

```text
Read and follow: docs/scheduled-task-handler-development-guide.md

Implement a new scheduled task:

- taskKey: <owner.domain.action>
- package: SCHOOL | CORE
- scope: org | system
- schedule: <daily HH:MM org tz | interval minutes>
- business logic: <what the handler should do>
- settings sync: <which save action upserts the definition, if any>
- deferred email: yes/no (if yes, use emailOutboxService.enqueue)

Match existing conventions in schoolScheduledTaskRegistration.js and
sessionAccessPolicyTaskSyncService.js. Add tests.
```

---

## Manual QA

1. Handler appears in `/scheduled-tasks` definitions list after sync/seed.
2. **Run now** on the definition succeeds; run visible in `/scheduled-tasks/runs`.
3. Paused definitions are skipped on tick.
4. Org-scoped task uses correct `orgId` from definition.
5. Idempotent: second run does not duplicate side effects (ledger/outbox dedupe).
6. For email deferral: outbox row appears with correct `sendAt`; core dispatch sends later.
