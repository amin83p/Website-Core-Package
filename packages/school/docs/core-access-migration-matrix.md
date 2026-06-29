# School Core Access Migration Matrix

This matrix tracks school-package communication paths that touch core-backed identity data and the migration target used for school-section-safe access.

## Legend

- `DONE`: migrated in this implementation
- `BRIDGED`: covered by school dataService person-bridge in `schoolCoreContracts`
- `LOCAL`: picker uses local preloaded data (no remote fetch)

## Endpoint and contract layer

| Area | Source | Target | Status |
|---|---|---|---|
| Shared identity endpoint | `/school/identity/api/persons` | School section-gated identity facade with role filters | DONE |
| Shared identity endpoint | `/school/identity/api/users` | School section-gated users facade | DONE |
| Taggable users endpoint | `/school/identity/api/taggable-users` | School section-gated user lookup for tagging flows | DONE |
| Eligible person responses | Task/Timesheet/PayRate/Activity/Schedule pickers | Uniform `status + data/results/items + pagination` payload | DONE |

## Picker flows in school views

| Module / View | Previous endpoint pattern | Target endpoint pattern | Status |
|---|---|---|---|
| Report assignment | Remote session/person endpoints | `sourceMode: 'local'` with preloaded class data | LOCAL |
| Schedule my view | `teacher/student/staff` default presets | `/school/identity/api/persons?allowedSchoolRoles=<role>` | DONE |
| Schedule global comparison | Teacher preset default | `/school/identity/api/persons?allowedSchoolRoles=teacher` | DONE |
| Report person list | teacher/staff/student default presets | `/school/identity/api/persons?allowedSchoolRoles=<role>` | DONE |
| Leave request form requester picker | teacher/staff default presets | `/school/identity/api/persons?allowedSchoolRoles=<role>` | DONE |
| Existing scoped pickers (task/timesheet/payrate/activity/schedule person picker) | School feature endpoints | Keep school feature endpoints | DONE |

## Backend identity fetch paths

| Module | Previous pattern | Target | Status |
|---|---|---|---|
| Schedule controller | `dataService.fetchData/getDataById('persons', ..., req.user)` | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Attendance controller | Direct core persons fetch | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Class controller (session manager + actor display) | Direct core persons fetch/get by id | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Report view service | Direct core persons list for name map | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Report service | Direct core persons list for prefill snapshot | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Exam controller | Direct core persons list/get by id | `schoolIdentityLookupService.listSchoolPersonRecords` | DONE |
| Long-tail school modules using core dataService persons | Direct `fetchData/getDataById('persons', ..., req.user)` | School-level person bridge in `schoolCoreContracts` wrapper for `MVC/services/dataService` | BRIDGED |

## Guardrails and anti-regression

| Guardrail | Description | Status |
|---|---|---|
| Person preset school fallback | On `/school/*`, `person` preset defaults to `/school/identity/api/persons` | DONE |
| `/persons` hardening in school pages | On `/school/*`, configs resolving to `/persons` are rewritten to `/school/identity/api/persons` | DONE |
| Endpoint inference robustness | Preset inference ignores query strings and hashes | DONE |

## Validation targets

1. School-only users with section access can load school pickers without core `PERSONS` access.
2. Person picker endpoints return a consistent contract (`data/results/items/pagination`).
3. No school view relies on global `/persons`.
4. Report assignment uses local picker mode for sessions/students.
