# Data Flow Architecture (Core, School, IELTS)

This page summarizes the current architecture after the service/repository/query-bridge refactor.

## 1) Core Path

```mermaid
flowchart LR
  C[Core Controller] --> DS[dataService.fetchData]
  DS --> SB[dataScopeBuilder]
  DS --> R[Core Repository]
  R --> M[Core Model.queryX]
  M --> QB{queryExecutionBridge executor?}
  QB -- Yes --> EX[Registered Executor]
  QB -- No --> FB[Model fallback applyGenericFilter]
  EX --> OUT[Filtered rows]
  FB --> OUT
  OUT --> C
```

### Core module list (exact `FETCH_ENTITY_REGISTRY`)
- `users` -> `userRepository` -> scope: `canViewAll`
- `persons` -> `personRepository` -> scope: `buildPersonScope`
- `organizations` -> `organizationRepository` -> scope: `buildOrganizationScope`
- `contracts` -> `contractRepository` -> scope: `canViewAll`
- `sections` -> `sectionRepository` -> scope: `buildSectionScope`
- `operations` -> `operationRepository` -> scope: `canViewAll`
- `scopes` -> `scopeRepository` -> scope: `canViewAll`
- `accesses` -> `accessRepository` -> scope: `buildAccessScope`
- `accessPolicies` -> `accessPolicyRepository` -> scope: `buildAccessPolicyScope`
- `logs` -> `logRepository` -> scope: `canViewAll`
- `tableSettings` -> `tableSettingsRepository` -> scope: `buildTableSettingsScope`
- `actionStates` -> `actionStateRepository` -> scope: `canViewAll`
- `orgPolicies` -> `orgPolicyRepository` -> scope: `buildOrgPolicyScope`
- `symbols` -> `symbolRepository` -> scope: `buildSymbolScope`
- `sessions` -> `sessionRepository` -> scope: `buildSessionScope`
- `news` -> `newsRepository` -> scope: `buildNewsScope`
- `contactMessages` -> `contactRepository` -> scope: `buildContactScope`
- `newsletter` -> `newsletterRepository` -> scope: `buildNewsletterScope`
- `newsletterSubscribers` -> alias of `newsletter`
- `newsletterSubscriptions` -> alias of `newsletter`
- `subscriptionGroups` -> `subscriptionGroupRepository` -> scope: `buildSubscriptionGroupScope`

Primary files:
- `MVC/services/dataService.js`
- `MVC/services/security/dataScopeBuilder.js`
- `MVC/repositories/*.js`

## 2) School Path

```mermaid
flowchart LR
  SC[School Controller] --> SDS[schoolDataService.fetchData]
  SDS --> SSB[schoolDataScopeBuilder]
  SDS --> SR[schoolRepositories.<entity>.list]
  SR --> SQB{queryExecutionBridge executor?}
  SQB -- Yes --> SEX[Registered school executor]
  SQB -- No --> SF[Repository local fallback]
  SEX --> SC
  SF --> SC
```

### School module list (exact `SCHOOL_ENTITY_REGISTRY`)
- `students`
- `programs`
- `transactionDefinitions`
- `feeDefinitions` (alias -> `transactionDefinitions`)
- `transactionTemplates` (alias -> `transactionDefinitions`)
- `schoolAccounts`
- `globalTransactions`
- `transactionJournals`
- `academicLedger`
- `academicSnapshots`
- `reportTemplates`
- `reportAssignments`
- `reportInstances`
- `subjects`
- `classes`
- `holidays`
- `terms`
- `departments`
- `teachers`
- `staff`
- `payRates`
- `timesheetPeriods`
- `timesheets`
- `studentProgramRegistrations`
- `studentTermRegistrations`

Primary files:
- `MVC/services/school/schoolDataService.js`
- `MVC/services/school/schoolDataScopeBuilder.js`
- `MVC/repositories/school/index.js`

## 3) IELTS Path

```mermaid
flowchart LR
  IC[IELTS Controller] --> IDS[ieltsDataService.fetchData]
  IDS --> IR[ieltsRepositories.<entity>.list]
  IR --> IQB{queryExecutionBridge executor?}
  IQB -- Yes --> IEX[Registered IELTS executor]
  IQB -- No --> IF[Repository local fallback]
  IEX --> IC
  IF --> IC
```

### IELTS module list (exact `IELTS_ENTITY_REGISTRY`)
- `task2Samples` -> `ieltsRepositories.task2Samples`
- `microAssessments` -> `ieltsRepositories.microAssessments`
- `prompts` -> `ieltsRepositories.prompts`
- `scoringHistory` -> `ieltsRepositories.scoringHistory`

Primary files:
- `MVC/services/ielts/ieltsDataService.js`
- `MVC/repositories/ielts/index.js`

## Shared Query Bridge Layer

```mermaid
flowchart TD
  B[queryExecutorBootstrap.registerCoreEntityQueryExecutors] --> Q[queryExecutionBridge registry]
  Q --> E1[users executor]
  Q --> E2[persons executor]
  Q --> E3[organizations executor]
  Q --> E4[... core entities ...]
  Q --> E5[school.* executors]
  Q --> E6[ielts.* executors]
```

Primary files:
- `MVC/models/queryExecutionBridge.js`
- `MVC/models/queryExecutorBootstrap.js`
- `app.js` (calls `registerCoreEntityQueryExecutors()`)

## End-to-end example (Core: persons list)

```mermaid
sequenceDiagram
  participant U as User
  participant C as Controller
  participant DS as dataService
  participant PR as personRepository
  participant PM as personModel.queryPersons
  participant QB as queryExecutionBridge

  U->>C: GET /persons?q=amin
  C->>DS: fetchData('persons', query, req.user)
  DS->>PR: list({query, scope})
  PR->>PM: queryPersons(plan)
  PM->>QB: getEntityQueryExecutor('persons')
  QB-->>PM: executor (if registered)
  PM-->>PR: filtered rows
  PR-->>DS: rows
  DS-->>C: rows
  C-->>U: render/JSON
```

## Quick orientation rule
- Core controllers should prefer `dataService`.
- School controllers should prefer `schoolDataService`.
- IELTS controllers should prefer `ieltsDataService`.
- Direct model calls in controllers are legacy or intentionally specialized paths.
