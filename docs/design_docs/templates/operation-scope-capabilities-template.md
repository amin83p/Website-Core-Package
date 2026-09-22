# {Section display name} Operation and Scope Capabilities

Access Profile reference | {DD Month YYYY}

## Agent usage

Consult this document when:

- Implementing or changing `{SECTION_KEY}` access checks
- Wiring route gates, UI capability flags, or {feature} integration
- Deciding which operation ({READ, UPDATE, ...}) gates each action

**Critical rules:**

1. This doc defines **{section} behavior only** — not which classes/sessions appear (see `SCHOOL_CLASSES` / `SCHOOL_SESSIONS` or other sections as applicable).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](../admin-access-types-reference-2026-09-05.md). Operation/scope rows apply to **non-bypass users only** unless a separate bypass rule is stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) only — incremental `"+"` extras, not bypass admins.
4. {Add section-specific rules here.}

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](../admin-access-types-reference-2026-09-05.md) — bypass vs ADMIN scope; developer API
- {Other design_docs links}

**Status:** `target-spec` | `implemented` — {one-line summary of runtime alignment}.

---

## Scope of this document for {SECTION_KEY}

This document defines **{section} access only** — what a user may do within `{SECTION_KEY}` once central access has approved the requested operation and scope.

{Boundary paragraph: what this doc does *not* define.}

---

## {SECTION_KEY} section pages and surfaces

| Page / Where | What user can do and see |
| --- | --- |
| **{Page name}** (`{route}`) | {Capability summary; name gating operation in bold.} |

---

## Access profile definitions — {SECTION_KEY}

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION | {…} |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | ORGANIZATION | {…} |

{Repeat subsections per operation used by the section: CREATE, UPDATE, DELETE, CONFIGURE, UPLOAD, EXPORT, PRINT, RESOLVE, etc.}

---

## Implementation references

| Concern | Location |
| --- | --- |
| Routes | `{path}` |
| Access service | `{path}` |
| Tests | `{path}` |
| Section catalog | MongoDB `sections` collection (`{SECTION_KEY}`) |

---

## MongoDB catalog and access profiles

When `DATA_BACKEND=mongo`, bind operations on section **`{numericId}` / `{SECTION_KEY}`**:

```bash
node scripts/seed-{section}-section.js
node scripts/school/verify-{section}-access-profiles.js
```

Dry-run:

```bash
node scripts/seed-{section}-section.js --dry-run
```

**Access profiles:** Section binding alone does not grant user access. Update profiles after seeding.

Regenerate Word output from this markdown (source of truth):

```bash
python scripts/design_docs/generate_design_doc_docx.py docs/design_docs/{section-slug}-operation-scope-capabilities-YYYY-MM-DD.md docs/design_docs/{section-slug}-operation-scope-capabilities-YYYY-MM-DD.docx
```

After publishing a new revision:

1. Add or update the row in [access-definition-catalog.json](../access-definition-catalog.json).
2. Move the previous markdown to [archive/](../archive/) and list it under `superseded` in the catalog.
3. Update [README.md](../README.md) access definition table.
