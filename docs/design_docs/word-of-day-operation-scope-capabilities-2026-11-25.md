# Word of Day Operation and Scope Capabilities

Access Profile reference | 25 November 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_WORD_OF_DAY` (section id **445588**) access checks
- Wiring route gates, UI capability flags, or public/school dashboard Word of Day integration
- Deciding which operation (READ, READ_ALL, CREATE, UPDATE, RESOLVE, DELETE, CONFIGURE) gates each action

**Critical rules:**

1. **APPROVE** in the original Word design maps to platform operation **RESOLVE** (same pattern as student cases).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Matrix rows apply to non-bypass users unless a bypass override is stated.
3. **ADMIN in scope column** means Access Profile ADMIN scope (`SCP_ADMIN`, Family B) unless noted.
4. All actions are within the **active organization** only.
5. Daily public/school display picks **`approved`** words only (`on_hold` and `archived` are excluded from the rotation pool).

**Related documents:**

- [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md)
- Source Word export: `Word of the Day-2026-11-25.docx`

**Status:** **Implemented** — runtime aligns with this specification.

---

## Scope of this document for SCHOOL_WORD_OF_DAY

This document defines **Word of Day section access only** — what a user may do within `SCHOOL_WORD_OF_DAY` once central access has approved the requested operation and scope.

### Section pages

| Page | What user can do and see |
| --- | --- |
| **List** (`/school/word-of-day`) | **READ** (non-USER) opens page shell; **READ_ALL** loads entries. Archived view via `?view=archived` when scope allows. |
| **New / Edit form** | **CREATE** / **UPDATE** per operation tables. |
| **Detail** | **READ_ALL** to view; workflow buttons use **RESOLVE** / **DELETE**. |
| **School settings — Word of Day panel** | **CONFIGURE** at ORGANIZATION or ADMIN scope. |

---

## Word lifecycle

`saved` → `submitted` → `approved` / `rejected` → `reopened` (editable again) · `on_hold` · `archived` (archived list only)

Display analytics (`display.displayCount`, `displayDates`) are recorded when a word is shown on dashboard/home. Changing status back to `reopened`/`submitted` or **DELETE** when display count > 0 should warn the user.

---

## Access profile definitions — SCHOOL_WORD_OF_DAY

### READ

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ | USER | No Access. |
| READ | OWNER / DEPARTMENT / DIVISION / ORGANIZATION / ADMIN | Open list page shell; data requires READ_ALL. |

### READ_ALL

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| READ_ALL | USER | No Access. |
| READ_ALL | OWNER | Words they created in the active org (non-archived default list). |
| READ_ALL | DEPARTMENT / DIVISION | Words created in the **current calendar year** in the active org. |
| READ_ALL | ORGANIZATION | Org-wide word list (all years, non-archived default). |
| READ_ALL | ADMIN | No extras beyond ORGANIZATION (Family B). |

### CREATE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CREATE | USER | No Access. |
| CREATE | OWNER / DEPARTMENT / DIVISION / ORGANIZATION | Create words attributed to the actor. |
| CREATE | ADMIN | May pick another creator user id on save. |

### UPDATE

| Operation | Scope | Editable statuses |
| --- | --- | --- |
| UPDATE | USER | No Access. |
| UPDATE | OWNER | Own words: `saved`, `reopened`. |
| UPDATE | DEPARTMENT / DIVISION | Current-year words: `saved`, `reopened`, `submitted`. |
| UPDATE | ORGANIZATION | All years: `saved`, `reopened`, `submitted`. |
| UPDATE | ADMIN | All words, all statuses. |

### RESOLVE (design: APPROVE)

| Operation | Scope | Transitions |
| --- | --- | --- |
| RESOLVE | USER | No Access. |
| RESOLVE | OWNER | Own: `submitted` → `reopened`. |
| RESOLVE | DEPARTMENT / DIVISION | Current-year: `submitted` → `reopened`. |
| RESOLVE | ORGANIZATION | Org: `submitted` → `approved`/`rejected`/`reopened`; `approved` → `on_hold`/`archived`. |
| RESOLVE | ADMIN | Any status → any status. |

Display-history warning when moving to `reopened`/`submitted` or deleting displayed words.

### DELETE

| Operation | Scope | Allowed when |
| --- | --- | --- |
| DELETE | USER | No Access. |
| DELETE | OWNER | Own: `saved`, `reopened`. |
| DELETE | DEPARTMENT / DIVISION | Current-year: `saved`, `reopened`. |
| DELETE | ORGANIZATION | Org: `saved`, `reopened`, `submitted`. |
| DELETE | ADMIN | All words (warn if displayed). |

### CONFIGURE

| Operation | Scope | What user can do and see |
| --- | --- | --- |
| CONFIGURE | USER / OWNER / DEPARTMENT / DIVISION | No Access. |
| CONFIGURE | ORGANIZATION / ADMIN | School settings Word of Day display policy. |

---

## MongoDB catalog

Section **445588** / `SCHOOL_WORD_OF_DAY`. Operations bound by name: READ, READ_ALL, CREATE, UPDATE, RESOLVE, DELETE, CONFIGURE.

```bash
node scripts/seed-school-word-of-day-section.js
node scripts/school/verify-word-of-day-access-profiles.js
```

Package seeder (section metadata + symbol + baseline SCHOOL_STAFF grant):

```bash
npm run school:word-of-day-section:seed
```

Access profiles must grant scopes; section binding alone does not grant user access.