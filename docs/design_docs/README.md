# Design Documents

Canonical design references for **access profiles**, architecture, and cross-cutting platform behavior. Markdown in this folder is the source of truth for humans, agents, and implementation work.

**Machine-readable index:** [access-definition-catalog.json](access-definition-catalog.json) (validated by `npm run design-docs:validate-catalog`).

**In-app browsing:** Documentation Center (`/docs`) → folder `design_docs` → this README.

---

## Start here (Access Profile administrators)

1. Read the foundation doc: [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) (bypass admins vs Access Profile ADMIN scope).
2. Open the **section matrix** for the area you are configuring (table below).
3. After changing Mongo **section operation bindings**, run the listed seed script (if any), then **verify access profiles** still grant the right operations at the intended scopes. Section binding alone does not grant user access.

**Status legend**

| Status | Meaning |
| --- | --- |
| `target-spec` | Matrix describes intended behavior; runtime may still be catching up |
| `implemented` | Policy, routes, UI, and tests align with the matrix |

---

## Access definition catalog

| Section key(s) | Title | Markdown | Word | Status | Seed / verify |
| --- | --- | --- | --- | --- | --- |
| *(foundation)* | Bypass vs ADMIN | [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md) | [docx](admin-access-types-reference-2026-09-05.docx) | — | — |
| `SCHOOL_ATTENDANCES`, `SCHOOL_ATTENDANCE_REPORT` | Attendance | [matrix](attendance-operation-scope-capabilities-2026-09-06.md) | [docx](attendance-operation-scope-capabilities-2026-09-06.docx) | target-spec | `node scripts/seed-school-attendances-section.js` · `node scripts/school/verify-attendance-access-profiles.js` |
| `SCHOOL_SESSION_STUDENT_CASES` | Session student cases | [matrix](student-case-operation-scope-capabilities-2026-09-06.md) | [docx](student-case-operation-scope-capabilities-2026-09-06.docx) | implemented | `node scripts/seed-school-student-cases-section.js` · `node scripts/school/verify-student-case-access-profiles.js` |
| `SCHOOL_NOTIFICATION_CENTER` | Notification centre | [matrix](notification-center-operation-scope-capabilities-2026-09-16.md) | [docx](notification-center-operation-scope-capabilities-2026-09-16.docx) | target-spec | Mongo section **445586** — no dedicated seed script yet (see matrix doc) |
| `SCHOOL_CLASSES` | Classes | [matrix](classes-operation-scope-capabilities-2026-09-24.md) | [docx](classes-operation-scope-capabilities-2026-09-24.docx) | implemented | Mongo section **442039** — no dedicated seed script yet (see matrix doc) |

### Cross-cutting (not a section matrix)

| Topic | Audience | Markdown |
| --- | --- | --- |
| Student picker / search surfaces | Developers & QA | [student-picker-search-matrix-2026-09-17.md](student-picker-search-matrix-2026-09-17.md) |

### Other references (not access definition)

| Document | Purpose |
| --- | --- |
| [ielts-micro-assessment-committee-reference-2026-09-06.md](ielts-micro-assessment-committee-reference-2026-09-06.md) | Committee / dissertation evidence |
| [ielts-micro-assessment-plain-language-faq-2026-09-06.md](ielts-micro-assessment-plain-language-faq-2026-09-06.md) | Plain-language FAQ for committee questions |

### Superseded revisions

| Archived markdown | Replaced by |
| --- | --- |
| [archive/notification-center-operation-scope-capabilities-2026-09-15.md](archive/notification-center-operation-scope-capabilities-2026-09-15.md) | [notification-center-operation-scope-capabilities-2026-09-16.md](notification-center-operation-scope-capabilities-2026-09-16.md) |

Older copies outside this folder (for example [../attendance-operation-scope-capabilities-2026-09-04.md](../attendance-operation-scope-capabilities-2026-09-04.md)) are marked superseded and should not be used for profile work.

---

## Naming convention

| Pattern | Example |
| --- | --- |
| `{topic}-reference-YYYY-MM-DD.md` | `admin-access-types-reference-2026-09-05.md` |
| `{section-slug}-operation-scope-capabilities-YYYY-MM-DD.md` | `attendance-operation-scope-capabilities-2026-09-06.md` |
| Matching Word output | Same basename as the markdown file (kebab-case, **no spaces**) |

- **Markdown (`.md`)** — editable source of truth; preferred for agents and version control.
- **Word (`.docx`)** — formatted output for human review; regenerated from markdown.

New section matrices: copy [templates/operation-scope-capabilities-template.md](templates/operation-scope-capabilities-template.md).

---

## Folder layout

```
docs/design_docs/
  README.md
  access-definition-catalog.json
  admin-access-types-reference-*.md / .docx
  *-operation-scope-capabilities-*.md / .docx
  archive/                    ← superseded markdown only
  templates/
    design-doc-base.docx
    operation-scope-capabilities-template.md
scripts/design_docs/
  generate_design_doc_docx.py
  generate_design_doc_docx.mjs
  validate-access-catalog.mjs
```

---

## Revision workflow (access matrices)

1. Edit the markdown matrix (or add a new dated file if you need to keep history).
2. Update [access-definition-catalog.json](access-definition-catalog.json) and the table in this README.
3. Move the previous markdown to `archive/` and add a `superseded` entry in the catalog.
4. Regenerate the matching `.docx` (commands below).
5. Apply Mongo section bindings (seed script) and re-check access profiles (verify script).
6. Run `npm run design-docs:validate-catalog` (also covered by `npm test`).

---

## Regenerating a docx

From the repository root:

```bash
python scripts/design_docs/generate_design_doc_docx.py docs/design_docs/admin-access-types-reference-2026-09-05.md docs/design_docs/admin-access-types-reference-2026-09-05.docx
```

Optional template override:

```bash
python scripts/design_docs/generate_design_doc_docx.py INPUT.md OUTPUT.docx --template docs/design_docs/templates/design-doc-base.docx
```

Node fallback (requires `docx` package):

```bash
node scripts/design_docs/generate_design_doc_docx.mjs INPUT.md OUTPUT.docx
```

Validate catalog paths:

```bash
npm run design-docs:validate-catalog
```

---

## MongoDB catalog (runtime source of truth)

When `DATA_BACKEND=mongo` (production default), section and operation catalog changes must be applied in **MongoDB** collections `operations` and `sections`. Do **not** rely on edits to `data/operations.json` or `data/sections.json` for deployment.

### Attendance (`SCHOOL_ATTENDANCES`)

```bash
node scripts/seed-school-attendances-section.js
node scripts/school/verify-attendance-access-profiles.js
```

Dry-run (no writes):

```bash
node scripts/seed-school-attendances-section.js --dry-run
```

The script resolves `UPLOAD` and `PRINT` by operation **name** and binds them on `SCHOOL_ATTENDANCES` only. See [attendance-operation-scope-capabilities-2026-09-06.md](attendance-operation-scope-capabilities-2026-09-06.md).

### Session student cases (`SCHOOL_SESSION_STUDENT_CASES`, section id `778771`)

```bash
node scripts/seed-school-student-cases-section.js
node scripts/school/verify-student-case-access-profiles.js
```

Dry-run:

```bash
node scripts/seed-school-student-cases-section.js --dry-run
```

See [student-case-operation-scope-capabilities-2026-09-06.md](student-case-operation-scope-capabilities-2026-09-06.md).

### Notification centre (`SCHOOL_NOTIFICATION_CENTER`, section id `445586`)

No repository seed script yet. Apply operation bindings in Mongo per [notification-center-operation-scope-capabilities-2026-09-16.md](notification-center-operation-scope-capabilities-2026-09-16.md), then update access profiles to match the matrix.
