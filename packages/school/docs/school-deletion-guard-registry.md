# School Deletion Guard Registry

Central deletion guard for school entities. Delete safety checks flow through `schoolDeletionGuardService` and the rule registry in `schoolDeletionRuleRegistry.js`.

## Integration points (delete path)

### Hard deletes (`deleteData`)

Standard hard deletes call `schoolDataService.deleteData(repositoryKey, id, user)`. Before `repository.remove`, the data service resolves the guard `entityKey` and runs `schoolDeletionGuardService.assertCanDelete`.

```
deleteController → schoolDataService.deleteData → assertCanDelete → repository.remove
```

### Purge deletes (`purgeData`) — people

Students, teachers, and staff use `purgeData` after multi-step role/account cleanup. Controllers call `assertCanDelete` **before** starting the transaction; `purgeData` accepts `skipDeletionGuard: true` when the controller already checked.

### Service-layer deletes

Task and leave-request deletes route through `schoolDataService.deleteData` from `taskService` and `leaveRequestService`, so they inherit the same guard automatically.

### Repository key → entity key map

| repositoryKey | entityKey |
|---------------|-----------|
| `programs` | `program` |
| `departments` | `department` |
| `subjects` | `subject` |
| `terms` | `term` |
| `classes` | `class` |
| `reportTemplates` | `reportTemplate` |
| `reportAssignments` | `reportAssignment` |
| `reportInstances` | `reportInstance` |
| `timesheetPeriods` | `timesheetPeriod` |
| `activities` | `activity` |
| `activityCategories` | `activityCategory` |
| `sessionStatuses` | `sessionStatus` |
| `holidays` | `holiday` |
| `students` | `student` |
| `teachers` | `teacher` |
| `staff` | `staff` |
| `schoolAccounts` | `schoolAccount` |
| `transactionDefinitions` / `transactionTemplates` / `feeDefinitions` | `transactionDefinition` |
| `transactionJournals` | `transactionJournal` |
| `examTemplates` | `examTemplate` |
| `examRevisions` | `examRevision` |
| `examQuestions` | `examQuestion` |
| `examAllocations` | `examAllocation` |
| `examAssignments` | `examAssignment` |
| `examAttempts` | `examAttempt` |
| `examAnswers` | `examAnswer` |
| `classEnrollmentPeriods` | `classEnrollmentPeriod` |
| `studentProgramPriorSubjects` | `studentProgramPriorSubject` |
| `leaveRequests` | `leaveRequest` |
| `tasks` | `task` |

Exported as `REPOSITORY_KEY_TO_ENTITY_KEY` and `resolveEntityKeyFromRepositoryKey()` from `schoolDeletionRuleRegistry.js`.

### Service options

| Option | Purpose |
|--------|---------|
| `skipDeletionGuard: true` | Bypass guard for internal maintenance or after controller pre-check |
| `deletionContext` | Extra context for composite deletes (e.g. `session` + `classId`) |
| `orgId` | Org scope when `requestingUser` lacks `activeOrgId` |

### Session exception

Class sessions are embedded in class documents, not deleted via `deleteData`. Makeup session removal in `classController.saveSession` calls `assertCanDelete({ entityKey: 'session', context: { classId } })` directly before splicing sessions.

## Optional preview API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/school/api/deletion-preview/:entityKey/:id` | Preview blockers (`?classId=` required for `session`) |
| DELETE | `/school/api/delete/:entityKey/:id` | Confirmed delete after preview passes |

Blocked deletes return HTTP `409` with `{ code: 'DELETE_BLOCKED', preview }` when controllers use `respondDeleteBlocked`.

## Entity matrix

### Phase 1 (core academics)

| Entity key | Repository | Blocked by (summary) |
|------------|------------|----------------------|
| `program` | programs | Registrations, class program terms, enrollment periods, ledger/snapshots, withdrawals, transactions, prior credits |
| `department` | departments | Programs, subjects, classes, teachers, staff, pay rates, activities, exam templates |
| `subject` | subjects | Program embeds/prereqs, class curricula, prior credits, ledger/snapshots, exam templates |
| `term` | terms | Program embeds, term registrations, classes, enrollment periods, ledger/snapshots, withdrawals |
| `class` | classes | Reports, exams, enrollments, cases, ledger, class cycle links, withdrawals, timesheet locks/refs |
| `session` | embedded in class | Report assignments/instances, cases, leave substitutions, timesheet locks/refs (`classId` context required) |
| `reportTemplate` | reportTemplates | Report assignments, report instances |
| `reportAssignment` | reportAssignments | Report instances, approved timesheet `rptref-*` refs |
| `reportInstance` | reportInstances | (no extra rules in Phase 1) |
| `timesheetPeriod` | timesheetPeriods | Any timesheets on the period |
| `activity` | activities | Timesheet locks, approved timesheet activity refs |
| `activityCategory` | activityCategories | Activities using the category |
| `sessionStatus` | sessionStatuses | Class sessions using status code, approved timesheet refs on those sessions |
| `holiday` | holidays | (no cross-refs in Phase 1) |

### Phase 2a (people)

| Entity key | Repository | Blocked by (summary) |
|------------|------------|----------------------|
| `student` | students | Program/term registrations, enrollment periods, academic ledger, global transactions, report instances, exam assignments/attempts/answers |
| `teacher` | teachers | Report assignments (teacherIds array), report instances, timesheets, global transactions, pay rates |
| `staff` | staff | Global transactions, pay rates |

### Phase 2b (financial, exams, operations)

| Entity key | Repository | Blocked by (summary) |
|------------|------------|----------------------|
| `schoolAccount` | schoolAccounts | Linked students/teachers/staff, child accounts, journal lines |
| `transactionDefinition` | transactionDefinitions | Global transactions, posting policies on programs/departments/classes |
| `transactionJournal` | transactionJournals | Non-draft status (posted/voided journals cannot be deleted) |
| `examTemplate` | examTemplates | Exam revisions, allocations |
| `examRevision` | examRevisions | Questions, allocations, attempts |
| `examQuestion` | examQuestions | Exam answers |
| `examAllocation` | examAllocations | Non-cancelled status, active assignments |
| `examAssignment` | examAssignments | Attempts, answers |
| `examAttempt` | examAttempts | Answers |
| `examAnswer` | examAnswers | (leaf) |
| `classEnrollmentPeriod` | classEnrollmentPeriods | Posted enrollment transactions (non-draft periods with posted refs) |
| `studentProgramPriorSubject` | studentProgramPriorSubjects | (leaf) |
| `leaveRequest` | leaveRequests | (leaf; linked tasks removed first) |
| `task` | tasks | (leaf) |

## Client helper (deferred UI)

`public/scripts/schoolDeletionGuard.js` and `school/partials/deletionPreviewModal.ejs` exist for a future UI pass. List delete buttons are **not** wired to the guard in this step.

## Immutable children

Some references use `childPolicy: 'immutable_child'` (registrations, academic ledger, global transactions, withdrawals). These cannot be auto-resolved by deletion; users must follow withdrawal, void, or reversal workflows linked in blocker hints.
