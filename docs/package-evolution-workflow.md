# Package evolution workflow

Package evolution records how each installable package (CORE, SCHOOL, PTE, …) changes over time. Records are linked to git commits and enriched with team, purpose, budget, and technical metadata.

## Daily workflow

1. Commit your changes (one or more commits).
2. Run `npm run evolution:scan` (optionally `-- --out stubs.json` or `-- --mark` after you finish importing).
3. Share the stub JSON with Cursor and add complementary details (purpose, team, approval, budget, duration, bug/update/new).
4. Save the enriched payload as JSON with an `items` array.
5. Run `npm run evolution:import -- --file enriched.json --publish` or use **System Settings → Package Evolution** to import.
6. Admins open **Account menu → Package evolution** to browse the timeline for packages they administer.

## Stub fields (from scan)

- `commitSha`, `commitShortHash`, `committedAt`
- `packageName` (derived from changed paths)
- `technical.files` and suggested `technical.collections`
- `status: "draft"` until you publish on import

## Enriched item shape

Each object in `items` should include:

- `packageName`, `commitSha`, `committedAt`, `changeType` (`bug` | `update` | `new`)
- `title`, `description`, `purpose`
- `team.members[]`, `team.approval`
- `budget`, `taskDuration`
- `technical` (file/collection names only)
- `status` (`published` for timeline visibility)

Upserts match on commit SHA + package + title.

## Access

- **Timeline** (`/package-evolution`): users with package admin access (system/super admin or matching `adminCategories`).
- **Manage** (`/systemSettings/package-evolution`): requires `SYSTEM_PACKAGE_EVOLUTION` section access (seed with `npm run evolution:section:seed`).

## CLI reference

```bash
npm run evolution:scan
node scripts/package-evolution.js scan --since <sha> --out stubs.json --mark
npm run evolution:import -- --file enriched.json
node scripts/package-evolution.js collections-hint --file changed-paths.json
```