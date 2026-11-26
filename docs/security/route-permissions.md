# Route permissions and access guards

This document describes how mutating and admin list routes must be protected, and how CI audits enforce it.

## Required middleware chain

For routes behind authentication that expose admin lists, imports, or mutations:

1. `requireAuth`
2. `requireAccess(sectionId, operationId)` (or an approved custom guard — see below)
3. `trackActionState(sectionId, operationId, …)` for mutating flows
4. Controller handlers that delete catalog rows must call `deleteData(entity, id, req.user)` (or equivalent requesting user).

`SECTIONS.*` symbols in `config/accessConstants.js` (and package `accessConstants.js`) must resolve to a row in `data/sections.json` by **id** or catalog **name**. Example: `ACCESS_PROFILES: 'ACCESSES'` because the catalog name is `ACCESSES`, not `ACCESS_PROFILES`.

## Custom guards recognized by the linter

The audit in `scripts/security/audit-route-permissions.js` treats these as satisfying `requireAccess`:

- `requireAccess` / `requireAccessAny`
- Package route guard modules (e.g. `requireBookCoveringOperationAny`, `requireReportMatrixEditorAccess`, spread arrays like `...enrollStudentsRollingAccess` when they include `requireAccess`)
- `requireChatAccessAny`, `requireNotificationCenterOperation`, `requireEvolutionViewer`, and similar `require*Access` / `require*Operation` helpers

## Intentional exceptions (allowlist)

Some files are listed in `scripts/security/route-permission-allowlist.json` because protection is elsewhere:

| Area | Reason |
| --- | --- |
| `authRoutes`, `homeRoutes`, public person register/join | Unauthenticated or self-service |
| `dashboardRoutes` | Hub; section filtering in controller |
| `profileRoutes` | Own profile |
| `chatRoutes`, `packageEvolutionRoutes` | Custom guards at file level |
| `newsRoutes` public feed | Public read; admin paths are guarded |
| IELTS / Benchpath main route files | Legacy package shells; triaged in allowlist pending dedicated guard pass |
| `schoolRoutes.js` hub redirect | Navigation only |

New exceptions must be documented in the allowlist JSON and reviewed in PR.

## CI / local checks

```bash
npm run security:audit:routes
npm run security:audit:sections
node --test test/route-permission-audit.test.js test/section-constants-resolve.test.js test/access-routes-security.test.js
```

`--packages` on the route audit script enforces package trees; tests run full enforcement including allowlisted package shells.

## Manual smoke (restricted vs granted user)

After changing routes for a section, verify with a user **without** grants and one **with** grants:

| URL | Expected without grant |
| --- | --- |
| `/accesses` | 403 |
| `/contracts` | 403 |
| `/news/manage` | 403 |
| Website policy admin (mounted path) | 403 |

Granted users should reach list/create/edit flows and receive operation tokens where applicable.