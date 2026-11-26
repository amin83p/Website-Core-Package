# Word of Day Operation and Scope Capabilities

Access Profile reference | 25 November 2026

## Agent usage

Consult this document when:

- Implementing or changing `SCHOOL_WORD_OF_DAY` (section id **445588**) access checks
- Wiring route gates, UI capability flags, or public/school dashboard Word of Day integration
- Deciding which operation (READ, READ_ALL, CREATE, UPDATE, RESOLVE, DELETE, CONFIGURE) gates each action

**Critical rules:**

1. **APPROVE** in the original Word design maps to platform operation **RESOLVE** (same pattern as student cases).
2. **Bypass admins (Family A)** — see [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Matrix rows apply to non-bypass users unless a bypass override is stated. Runtime: `adminFlags.*` from `isAdminForRequestAsync` via `wordOfDayOperationPolicyService.applyOperationPolicy`. **Family B** UPDATE `SCP_ADMIN` is `effectiveTier === 'admin'`, not bypass.
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
| **List** (`/school/word-of-day`) | **READ** (non-USER) opens page shell; **READ_ALL** loads entries. Archived view via `?view=archived` when scope allows. Entry detail opens in-modal via `GET .../api/:id/detail` (`?openEntry=` on list). **Review Words** (toolbar) opens a modal; **RESOLVE** runs `POST /school/word-of-day/api/review-search` with filters. Legacy `GET /review` redirects to `?openReview=1`. `GET /detail/:id` redirects to list with `?openEntry=`. |
| **New / Edit form** | **CREATE** / **UPDATE** per operation tables. **Save draft** preserves status; **Save & submit** sets `submitted` when `canSubmitEntryViaSave` allows (see admin reference for Family A vs Family B UPDATE). |
| **School settings — Word of Day panel** | **CONFIGURE** at ORGANIZATION or ADMIN scope. |

---

## Photo and audio attachments

- **Upload:** `POST /school/word-of-day/api/media/upload` (CREATE or UPDATE access). Files use backend upload settings key `school.wordOfDay` (template `school/word-of-day/{entryId}/{kind}`) under the active org scope, then canonical `/uploads/…` URLs via `schoolFileService`.
- **Stored on entry:** `photo` and `audio` objects (`url`, `fileName`, `mimeType`, `sizeBytes`) in Word of Day repository data.
- **Read path:** API/list responses enrich media refs for the entry modal (`GET .../api/:id/detail`).
- **Replace / remove:** After a successful **UPDATE**, prior upload refs are deleted from storage when photo or audio changes or is cleared; deleting an entry removes both media files.

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
| UPDATE | ADMIN | All words, all statuses. May reassign author via user picker on edit (Family B). Bypass admins (Family A) with UPDATE also get author picker. |

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

## Public detail page, widget navigation, and reactions

- **Compact widget** (home banner + school sub-dashboard): links to `/word-of-the-day/{dateKey}` with optional `?org=` when the pick is not from the global public source org. No `SCHOOL_WORD_OF_DAY` permission is required to open the public page.
- **Public page** (`GET /word-of-the-day`, `GET /word-of-the-day/:dateKey`): shows the **approved** daily pick for the resolved org (meaning, examples, photo, audio, video link). Styled like other public pages (`pte-public-root`).
- **Reactions** (`POST /word-of-the-day/api/reaction`, `GET /word-of-the-day/api/:entryId/summary`): one like or dislike per voter per entry — logged-in users keyed by user id; guests keyed by `req.ip` plus user-agent metadata. Votes are stored in `data/school/wordOfDayReactions.json` (mongo mirror collection `schoolWordOfDayReactions`). Reaction POST is allowed only when the entry matches the daily pick for the given org and date.
- **Dislike feedback (optional)**: clicking **Dislike** on the public page opens a polite optional comment prompt. Comments are **not shown on the public page with the voter’s name**; the server stores `voterDisplayName` on each reaction row for staff use only. Non-empty dislike comments are denormalized onto the word entry as `publicFeedback.dislikeComments` (with voter name, ids, timestamps). Counts live in `publicFeedback.stats`.
- **Staff public feedback** (`GET /school/word-of-day/api/:id/public-feedback`): likes, dislikes, dislike comments, and page visits (3+ seconds). Opened from the list row **three-dot menu → Public feedback** in a dedicated modal (not embedded in the entry detail modal).
- **Page visits** (`POST /word-of-the-day/api/page-visit`): after 3 seconds on the public detail page, one qualified visit per browser session is recorded (guest or signed-in display name for staff only).

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