# Student picker search matrix

Reference | 17 September 2026

## Purpose

Documents how each **student selection / search** surface resolves queries after claim-aware student list search (`studentListSearchService`). Use this when adding pickers or changing search fields.

**Canonical field list (server + GenericPicker):** [`packages/school/config/studentPickerSearchFields.js`](../../packages/school/config/studentPickerSearchFields.js) — mirrored in [`public/scripts/genericPickerPresets.js`](../../public/scripts/genericPickerPresets.js) (enforced by [`test/student-picker-search-audit.test.js`](../../test/student-picker-search-audit.test.js)).

---

## Search helpers

| Helper | Location | Behavior |
| --- | --- | --- |
| `studentMatchesListSearch` | `studentListSearchService.js` | In-memory match for `listStudents`; explicit `searchFields` or haystack when empty |
| `buildStudentListSearchHaystack` | `studentListSearchService.js` | Lowercase tokens: id, names, email, claims, etc. |
| `matchesSearch` + `searchText` | `schoolEntityPickerService.js` | Substring match on haystack from `buildStudentListSearchHaystack` for class-scoped students |
| `matchesSearch` (batch) | `termRegistrationController.js` `buildBatchStudentRows` | Registration row id, name, fee fields only |
| Client filter | `sessionStudentCaseModalClient.js` | Substring match on roster `searchText` (from `buildSessionStudentCaseRosterEntries`) with name/personId fallback |

---

## Picker matrix

| Surface | UI entry | HTTP / data | Search helper | First / last name | customStudentId | Claim number |
| --- | --- | --- | --- | --- | --- | --- |
| Student directory | List filters | `GET /school/students` | `studentMatchesListSearch` + merged DB fields | Yes | Yes | Yes (field picker + haystack) |
| GenericPicker student preset | ~20 school pages | `GET /school/students?q=&searchFields=` (canonical) | `studentMatchesListSearch` | Yes | Yes | Yes |
| Rolling enrollment | Pick student | GenericPicker preset | Same | Yes | Yes | Yes |
| Student attendance report (flat) | Add students | GenericPicker preset | Same | Yes | Yes | Yes |
| Student attendance report (by class) | Browse by class | `GET /school/entity-picker/api/options` | Haystack on student row | Yes | Yes | Yes |
| Semi-monthly report | Student picker | GenericPicker + SchoolEntityPicker | Both paths above | Yes | Yes | Yes |
| Report / master hubs | Student filters | GenericPicker preset | Same | Yes | Yes | Yes |
| Program registration batch, term reg, withdrawal, ledger, overall report | Student pickers | GenericPicker preset | Same | Yes | Yes | Yes |
| Global schedule compare | Students role | GenericPicker preset | Same | Yes | Yes | Yes |
| Term registration batch wizard | Student step | `GET .../register-terms-batch/students` | `buildBatchStudentRows` | Name column only | No | No |
| Session student case modal | Assign students | Session roster (`sessionStudentCaseRoster` + review API) | `buildSessionStudentCaseRosterEntries` + client `searchText` | Yes | Yes | Yes |
| Program registration admin list | Table search | In-service `rowMatchesQuery` | Registration/student columns | Partial | No | No |
| Person / eligible-person pickers | Tasks, activities, forms | `/school/*/api/eligible-persons` | Not student list API | N/A | N/A | N/A |

---

## Regression guards

- [`test/student-list-claim-search.test.js`](../../test/student-list-claim-search.test.js) — claim haystack, canonical fields, wiring
- [`test/student-picker-search-audit.test.js`](../../test/student-picker-search-audit.test.js) — config ↔ preset sync, no legacy `searchFields` on `GenericPickerPresets.student`, inventory counts

Console warnings (fix client overrides if seen):

- `[school/students] Legacy student picker searchFields`
- `[GenericPicker] Legacy student searchFields`

---

## Manual QA checklist

Run after changing student search or picker presets. For each surface, search should return the expected student.

### Rolling enrollment (`/school/classes/.../rolling-enrollment`)

- [ ] First name (partial)
- [ ] Last name (partial)
- [ ] System student id
- [ ] customStudentId (if configured on test student)
- [ ] Claim number on profile

### Student attendance report — flat picker

- [ ] Same five checks via GenericPicker

### Student attendance report — browse by class (SchoolEntityPicker)

- [ ] Navigate dept → class → student level; repeat name, id, claim checks

### Semi-monthly report

- [ ] GenericPicker student selection: name + id + claim

### Report hub or master academia hub — student filter

- [ ] One hub student GenericPicker: name + id

### Term registration batch wizard — student step

- [ ] Student name and student id (claim not required for this wizard)

### Session manager — student case modal (assign students)

- [ ] First / last name (partial)
- [ ] System student id and customStudentId
- [ ] Claim number on profile

**Pass criteria:** No empty results when the student exists in scope; no console legacy picker warnings on GenericPicker flows.
