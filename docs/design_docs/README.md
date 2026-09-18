# Design Documents

Canonical design references for access, architecture, and cross-cutting platform behavior. These documents are the source of truth for humans and for agents/skills when planning or implementing features.

## Naming convention

| Pattern | Example |
| --- | --- |
| `{topic}-reference-YYYY-MM-DD.md` | `admin-access-types-reference-2026-09-05.md` |
| Matching Word output | `admin-access-types-reference-2026-09-05.docx` |

- **Markdown (`.md`)** — editable source of truth; preferred for agents and version control.
- **Word (`.docx`)** — formatted output for human review; regenerated from markdown.

## Folder layout

```
docs/design_docs/
  README.md                          ← this file
  admin-access-types-reference-*.md
  admin-access-types-reference-*.docx
  templates/
    design-doc-base.docx             ← style shell (headings, Table Grid)
scripts/design_docs/
  generate_design_doc_docx.py        ← MD → DOCX generator
```

## Regenerating a docx

From the repository root:

```bash
python scripts/design_docs/generate_design_doc_docx.py docs/design_docs/admin-access-types-reference-2026-09-05.md docs/design_docs/admin-access-types-reference-2026-09-05.docx
```

Optional template override:

```bash
python scripts/design_docs/generate_design_doc_docx.py INPUT.md OUTPUT.docx --template docs/design_docs/templates/design-doc-base.docx
```

## Adding a new design document

1. Create `{topic}-reference-YYYY-MM-DD.md` in this folder using standard markdown headings and pipe tables.
2. Run the generator to produce the matching `.docx`.
3. Link to the new doc from section-specific docs (operation-scope matrices, architecture reports) instead of duplicating content.

## Current documents

| Document | Purpose |
| --- | --- |
| [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) | Bypass admins vs Access Profile ADMIN scope; developer API for admin checks |
| [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md) | `SCHOOL_ATTENDANCES` and `SCHOOL_ATTENDANCE_REPORT` operation/scope matrix (target spec for app implementation) |
| [student-picker-search-matrix-2026-09-17.md](student-picker-search-matrix-2026-09-17.md) | Student picker/search surfaces, claim-aware field contract, regression tests, manual QA checklist |
| [student-case-operation-scope-capabilities-2026-09-06.md](student-case-operation-scope-capabilities-2026-09-06.md) | `SCHOOL_SESSION_STUDENT_CASES` operation/scope matrix (**promoted**); READ vs READ_ALL, locked-case lifecycle, ADMIN override |
| [notification-center-operation-scope-capabilities-2026-09-16.md](notification-center-operation-scope-capabilities-2026-09-16.md) | `SCHOOL_NOTIFICATION_CENTER` operation/scope matrix (target spec); rules, runs, compose, outbox |

## MongoDB catalog (runtime source of truth)

When `DATA_BACKEND=mongo` (production default), section and operation catalog changes must be applied in **MongoDB** collections `operations` and `sections`. Do **not** rely on edits to `data/operations.json` or `data/sections.json` for deployment.

For attendance UPLOAD/PRINT operation bindings:

```bash
node scripts/seed-school-attendances-section.js
```

Dry-run (no writes):

```bash
node scripts/seed-school-attendances-section.js --dry-run
```

The script resolves `UPLOAD` and `PRINT` by operation **name** (uses existing Mongo ids when present) and binds them on `SCHOOL_ATTENDANCES` only. Attendance file uploads require `SCHOOL_ATTENDANCES` UPLOAD.

After seeding, verify access **profiles** in Mongo still grant the new operations at the intended scopes (section binding alone does not grant user access). See [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md).

Profile check helper:

```bash
node scripts/school/verify-attendance-access-profiles.js
```

For student-case operation bindings on `SCHOOL_SESSION_STUDENT_CASES` (section id `778771`):

```bash
node scripts/seed-school-student-cases-section.js
```

Dry-run:

```bash
node scripts/seed-school-student-cases-section.js --dry-run
```

The script resolves `READ`, `READ_ALL`, `CREATE`, `UPDATE`, `RESOLVE`, `DELETE`, and `CONFIGURE` by operation **name** and binds them on `SCHOOL_SESSION_STUDENT_CASES` only. Student-case capabilities do **not** fall back to `SCHOOL_SESSIONS`.

After seeding, verify access profiles:

```bash
node scripts/school/verify-student-case-access-profiles.js
```

See [student-case-operation-scope-capabilities-2026-09-06.md](student-case-operation-scope-capabilities-2026-09-06.md).
