MongoDB / Railway seed: SCHOOL_GRADEBOOK (Grades Matrix)
========================================================

Collections used by this app (see jsonToMongoMigrationService):
  - sections
  - symbols
  - accesses

Files:
  - school-gradebook-section.document.json   → insert into `sections` (id: 778769)
  - school-gradebook-symbol.document.json      → insert into `symbols` (id: SYM_SYSTEM_037A)
  - school-gradebook-access-grant.fragment.json → $push into accesses[].sections for teacher-style profiles
  - insert-school-gradebook.mongosh.js         → idempotent mongosh script (recommended)

After inserts:
  - Update the navigator parent section named "SCHOOL" (id 122740 in seed data): add
    { "id": "778769" } to `subsections` if not present. The mongosh script does this via $addToSet.
  - Grant access: add the access-grant fragment to each access profile that should open
    /school/grades-matrix (same idea as SCHOOL_ATTENDANCES / 778768).

If your Railway DB uses different ids for SCHOOL or access profiles, adjust filters in the script.

App code must define SECTIONS.SCHOOL_GRADEBOOK in config/accessConstants.js (already in repo).
