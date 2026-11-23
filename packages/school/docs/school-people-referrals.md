# School People — Referrals

Referrals is a **People** subsection (`SCHOOL_REFERRALS`, `/school/referrals`) for registering **referral contacts** in the active organization.

## Data

| Item | Value |
|------|--------|
| Entity key | `referrals` |
| Mongo collection | `schoolReferrals` |
| JSON seed | `data/school/referrals.json` |
| Person role | `school_referral` |
| System ID prefix | `REF-` |

Each row links one **person** (`personId`) to one org (`orgId`). Optional **`organizationIds[]`** hold referring-organization keys from the shared catalog in [`config/schoolReferringOrganizations.js`](../config/schoolReferringOrganizations.js) (CBI, Lifemark, Millard Health, Veritus, Work Safe BC, WCB Alberta). Selections are stored **only on the referral record**, not on `person.organizations`.

## UI

- **List** — person name, status, organization labels, notes excerpt, archive action.
- **Form (single tab)** — existing person picker **or** inline new person (identity, contact blocks, person notes). New people are always saved with an **active** person profile (no separate toggle). New person **date of birth** defaults to `2000-01-01` when left blank. **Active referral** is an on/off switch (`Active` vs `Archived`), plus referral notes and multi-select **Organizations** (hardcoded catalog).

## Access

Section id **332233** (`SCHOOL_REFERRALS`) appears under **School → People**. After manifest changes, run:

```bash
node scripts/seed-school-referrals-section.js
```

Or re-run the school package seeders (includes `school-referrals-section`) from System Settings → Package Manager when Mongo is the active backend.

## Archive / recover

Archiving sets referral `Archived` and removes `school_referral` from the person’s org membership. Recovery restores `Active` and re-assigns the role, with the same duplicate-person guard as create.

## Student referral links

Students store **`referralLinks[]`** on the student record (referral contact, organization from the catalog, date, program, comment). Manage them on the student form **Step 2: Student** tab or from **School Student Management** (referrals card and quick-action button). Referral and program selection use the **Generic Picker**; you can add a new referral contact inline from the referral-link modal without leaving the student screen. APIs: `GET/PUT /school/students/api/:id/referral-links` and picker `GET /school/students/api/referral-link-options`.