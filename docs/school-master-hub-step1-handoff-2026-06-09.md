# School Master Hub Step 1 Handoff (People-First AJAX Dashboard)

## Context
- Requested feature: new package-owned School Master Hub page that consolidates people/academics into one screen and loads panels via AJAX (no full reload).
- Scope from current request: **Step 1 = People-first only** (Students default + Teachers/Staff tabs), but include option strip for future groups (Programs, Terms, Subjects, etc.).
- Location: `Website-Core-Package` only unless explicitly mirrored later to core-only.

## Current status before handoff
- No code was changed in this session yet.
- `git status --short` in `Website-Core-Package` is clean.
- Existing School people controllers already have reusable list logic:
  - `packages/school/MVC/controllers/school/studentController.js`
  - `packages/school/MVC/controllers/school/teacherController.js`
  - `packages/school/MVC/controllers/school/staffController.js`
- School main routes currently mount:
  - `/students`, `/teachers`, `/staff`, and many others in `packages/school/MVC/routes/schoolMainRoute.js`.
  - No `/master-hub` route yet.
- Access middleware already supports `requireAccessAny` in core (`MVC/middleware/accessMiddleware.js`), but school package dependency wrappers don’t expose it yet:
  - `packages/school/MVC/services/school/schoolCoreContracts.js`
  - `packages/school/MVC/services/school/schoolRouteCoreDependencies.js`

## What to implement (Step 1)

### 1) Dependency exports for OR-style access
Files:
- `packages/school/MVC/services/school/schoolCoreContracts.js`
- `packages/school/MVC/services/school/schoolRouteCoreDependencies.js`

Tasks:
1. Export `requireAccessAny` from core access middleware through `schoolCoreContracts`.
2. Re-export it from `schoolRouteCoreDependencies` so route modules can consume it.

### 2) Add Master Hub controller
File: `packages/school/MVC/controllers/school/schoolMasterHubController.js`

Expose:
- `showMasterHubPage(req, res)`:
  - renders shell view with defaults:
    - `group = people`
    - `personType = students`
  - also reads incoming `req.query` for fallback when reopening via back/URL.
- `loadMasterHubPanelAjax(req, res)`:
  - returns JSON contract:
    - `status`, `module`, `moduleTitle`, `tableHtml`, `pagination`, `filters`, `meta`
  - server renders table fragment for each module and returns HTML to inject on client.

### 3) Add Master Hub service
File: `packages/school/MVC/services/school/schoolMasterHubService.js`

Responsibilities:
- `resolveAccessibleModules(req.user)` based on people section access.
- `getPeoplePanelRows(personType, query, req)` where `personType` one of:
  - `students`, `teachers`, `staff`.
- Reuse existing data layer patterns:
  - fetch persons + section data + enrich rows similarly to existing list controllers.
  - paginate and search behavior should align with current pages.

### 4) Add Master Hub route
File: `packages/school/MVC/routes/schoolMasterHubRoutes.js`

Routes:
- `GET /school/master-hub` → shell page
- `GET /school/master-hub/api/panel` → AJAX HTML contract
- Access gating:
  - `requireAuth`
  - `requireAccessAny([SCHOOL_STUDENTS, SCHOOL_TEACHERS, SCHOOL_STAFF], OPERATIONS.READ_ALL)`
  - `trackActionState(SCHOOL_STUDENTS, OPERATIONS.READ_ALL)` (or equivalent safe default)

### 5) Wire into main school router
File: `packages/school/MVC/routes/schoolMainRoute.js`

Add:
- `router.use('/master-hub', require('./schoolMasterHubRoutes'));`
- Keep ordering before the final `'/'` route.

### 6) Add views
New files:
- `packages/school/MVC/views/school/masterHub.ejs`
- `packages/school/MVC/views/school/masterHub/personTabs.ejs`
- `packages/school/MVC/views/school/masterHub/panelResponse.ejs` (or equivalent fragment wrapper)
- Optional helper row partials (if cleaner for maintainability):
  - `masterHub/peopleStudentsRows.ejs`
  - `masterHub/peopleTeachersRows.ejs`
  - `masterHub/peopleStaffRows.ejs`

UI behavior:
- Top option strip: `People`, `Programs`, `Terms`, `Subjects` (future-ready).
- People sub-tabs: `Students` (default), `Teachers`, `Staff`.
- Ajax content container with ID (ex: `masterHubContentContainer`).
- Search/status area + loading state + empty state.
- Include script `schoolMasterHub.js`.

### 7) Add client script
File: `packages/school/public/scripts/schoolMasterHub.js`

Features:
- Click top option / person tab → call `/school/master-hub/api/panel?...`.
- Debounced search input and page change handling.
- Replace content container with returned `tableHtml`.
- Re-run row-action initialization after inject (if needed by table).
- Keep URL in sync via `history.replaceState`:
  - `?group=people&personType=students|teachers|staff`.

### 8) Manifest / navigation
File: `packages/school/package.manifest.json`

Add dashboard/menu entry:
- label: `School Master Hub`
- href: `/school/master-hub`

### 9) Tests
New file:
- `test/school-master-hub-step1.test.js`

Include checks for:
- shell render defaults to People/Students.
- `/api/panel` returns `students`, `teachers`, `staff` payload contract.
- unauthorized user receives expected denial response.

### 10) Syntax validation
- `node --check packages/school/MVC/routes/schoolMasterHubRoutes.js`
- `node --check packages/school/MVC/controllers/school/schoolMasterHubController.js`
- `node --check packages/school/MVC/services/school/schoolMasterHubService.js`

## Planned implementation order (recommended)
1. Expose `requireAccessAny` wrappers.
2. Implement service + controller.
3. Add route + wire main router.
4. Build shell/partial views + script.
5. Update manifest.
6. Add tests + run checks.
7. Run manual smoke:
   - `/school/master-hub` loads Students by default
   - switch Teachers/Staff tabs without reload
   - search/pagination updates in place.

## Open design notes
- Use `searchDefaultKeyword` logic and existing `buildDataServiceQuery` behavior to keep UX consistent.
- Keep `/students`, `/teachers`, `/staff` full pages unchanged in Step 1.
- This page should be "extensible": future groups can be added by extending:
  - module registry in controller/service
  - top option strip + tab rendering
  - API contract and partials.

## Commit note
- This handoff report is documentation-first and intentionally contains no code changes.
- Next code session can start directly from the above 10-step list.
