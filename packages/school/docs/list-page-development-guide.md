# School List Page Development Guide

Use this guide when building or extending **server-rendered list pages** in the School package. The **Skills list** (`packages/school/MVC/views/school/skill/skillList.ejs`) is the baseline reference. For **dedicated filter panels** (beyond quick search), follow the **Rolling Enrollment** filter card pattern.

---

## Reference implementations

| Area | Primary reference | Path |
|------|-------------------|------|
| Standard list page | Skills | `packages/school/MVC/views/school/skill/skillList.ejs` |
| List controller | Skills | `packages/school/MVC/controllers/school/skillController.js` (`listSkills`) |
| Routes + access | Skills | `packages/school/MVC/routes/skillRoutes.js` |
| Page shell / toolbar | Shared partial | `MVC/views/partials/tablePages-start.ejs` |
| Quick search bar | Shared partial | `MVC/views/partials/tablePages-search.ejs` |
| Pagination | Shared partial | `MVC/views/partials/pagination.ejs` |
| Page close | Shared partial | `MVC/views/partials/tablePages-end.ejs` |
| Filter card (collapse) | Rolling Enrollment | `packages/school/MVC/views/school/class/rollingEnrollment.ejs` |
| Filter service | Rolling Enrollment | `packages/school/MVC/services/school/rollingEnrollmentPeriodFilterService.js` |
| Table UX (sort, settings, DB search) | Shared script | `public/scripts/modal-table.js` |
| Export modal | Shared | `MVC/views/partials/modal_FileExport.ejs`, `public/scripts/modal_FileExport.js` |
| Print | Shared | `public/scripts/print.js`, `public/scripts/printDocumentBuilder.js` |
| Layout modals/scripts | Shared layout | `MVC/views/layouts/layout.ejs` |

---

## End-to-end checklist

When adding a new list page, plan and implement each layer:

### 1. Access & routing

- [ ] Add section constant in `packages/school/config/accessConstants.js` if new domain.
- [ ] Register routes in the package router (e.g. `skillRoutes.js`).
- [ ] Apply `requireAuth` on the router.
- [ ] Gate list GET with `requireAccess(SECTION, OPERATIONS.READ_ALL)` (or the correct read operation).
- [ ] Use `trackActionState` when the page mutates workflow state on entry (Skills uses it; Rolling Enrollment export uses `READ_ALL` only).
- [ ] Wire router in the school package manifest / host route aggregator.

### 2. Controller (`list*` handler)

- [ ] Resolve org context (`getActiveOrgIdOrThrow`, `canCreateOrgScopedItem` when create is org-scoped).
- [ ] Load rows from service / `schoolDataService` (not raw repository calls from the view).
- [ ] Build query via `buildDataServiceQuery(req.query, …)` when using shared query params.
- [ ] Clear search default keyword if applicable (`searchDefaultKeyword` from settings).
- [ ] Apply server filters (generic search: `applyGenericFilter`; dedicated filters: domain filter service).
- [ ] Sort deterministically before pagination.
- [ ] Paginate with `paginate(rows, query.page, query.limit)`.
- [ ] Support AJAX list response: `if (isAjax(req)) return res.json({ status, results, pagination })`.
- [ ] Render view with all locals the EJS expects (see **Controller render locals** below).
- [ ] On error: JSON for AJAX, `error` view for HTML.

### 3. View (EJS)

- [ ] `tablePages-start` with title, toolbar flags, navigation buttons.
- [ ] Optional **filter card** (Rolling Enrollment pattern) when filters are more than quick search.
- [ ] `tablePages-search` with meaningful placeholder.
- [ ] Optional contextual **warning** alerts (org required, workflow blocked)—not decorative info banners.
- [ ] Table wrapper + `#first-table` markup.
- [ ] `pagination` partial when server-paginated.
- [ ] `tablePages-end`.
- [ ] Page-specific modals/scripts only if needed.

### 4. Client behavior

- [ ] `includeModal_Table: true` → loads `modal-table.js` (sort, column settings, client search, DB search modal).
- [ ] `print: true` → print toolbar + scripts.
- [ ] `btn_export: true` → export modal; add `exportExcelUrl` when server Excel export exists.
- [ ] `tableName` → per-user column settings key (e.g. `School_Skills`).
- [ ] `newUrl` + `newLabel` → New + Import buttons; also sets `#urlRef` for delete URL building.
- [ ] Row actions: `data-floating-row-actions="true"` on wrapper when using overflow action menus.

### 5. Tests

- [ ] Static asserts on route, controller exports, critical view strings.
- [ ] Service tests for filter/export logic when non-trivial.
- [ ] Run `node --test packages/school/test/<your-test>.test.js`.

---

## Controller render locals (typical)

Skills `listSkills` is the template:

```javascript
res.render('school/skill/skillList', {
  title: 'Skills',
  tableName: 'School_Skills',           // stable key for column settings
  data,                                 // rows for current page
  newUrl: 'school/skills',              // no leading slash; drives #urlRef, New, Import, export base
  newLabel: canCreate ? 'New Skill' : null,  // null hides New + Import
  canCreateSkills,                      // page-specific capability flags
  searchableFields,                     // for DB advanced search modal (via modal-table)
  includeModal: true,
  includeModal_Table: true,
  includeModal_FileImport: false,       // true when batch import modal is used
  print: true,
  pagination,
  filters: req.query,                   // preserve query string in pagination links
  user: req.user,
  actionStateId: req.actionStateId
});
```

Globals often available from middleware (do not omit in templates that use them):

- `schoolSectionDashboardHref` — dashboard back link in `headerManageBtns`.

For filter pages, also pass:

- `hasRollingFiltersApplied` / equivalent boolean to expand filter card on load.
- Filter option arrays (`enrollmentGroupOptions`, etc.).
- `filters: req.query` mirrored into view-local names if needed.

---

## View structure (recommended order)

### A. `tablePages-start`

Opens `.sections-page`, injects hidden context for print/delete/settings, renders heading and toolbar.

```ejs
<%- include('partials/tablePages-start', {
  title: 'Skills',
  newUrl: 'school/skills',
  newLabel: canCreateSkills ? 'New Skill' : null,
  user,
  tableName: 'School_Skills',
  btn_export: true,
  print: true,
  exportExcelUrl: '/school/classes/CLS_1/rolling-enrollment/export.xlsx', // optional
  headerManageBtns: [
    '<a href="' + schoolSectionDashboardHref + '" class="school-navigator-dashboard btn btn-filled btn-secondary btn-md mb-2"><i class="bi bi-speedometer2 me-1"></i> School Dashboard</a>'
  ],
  manageBtns: [],                        // right-side toolbar (e.g. Edit Class, Cycle Rollover)
  optionalBtnsBeforePrint: [],          // buttons before Print (e.g. New Enrollment)
  optionalLeadingBtns: [],              // before New button
  optionalBtns: [],                      // after Table settings
  belowHeadingInclude: '',             // optional partial path under H1
  exportDataBaseUrl: ''                  // override export POST base; default is newUrl
}) %>
```

**Toolbar buttons (when enabled):**

| Control | Condition | Behavior |
|---------|-----------|----------|
| New | `newLabel` set + `newUrl`/`newHref` | Link to `/{newUrl}/new` |
| Import | `newLabel` + `newUrl` | Opens batch import modal (`#openBatchModalBtn`) |
| Print | `print: true` | Opens print settings modal → `print.js` |
| Export | `btn_export: true` | Opens shared export modal |
| Table | `tableName` set | Column visibility/order/width settings |

**Hidden elements created by `tablePages-start`:**

- `#urlRef` — `data-id` = `newUrl` (used by global delete handler).
- `#user-id`, `#tableName`, `#activeOrgIdRef`, print metadata refs.
- `#actionStateIdRef` when `actionStateId` is passed.

### B. Filter card (Rolling Enrollment pattern)

Use when the page needs **structured GET filters** (dropdowns, enums) separate from quick search. Place **after** `tablePages-start`, **before** `tablePages-search`.

Key behaviors:

1. Collapsible card; **expanded when filters are active** on load.
2. `method="get"` form; submits to list route (same path as page).
3. Reset link clears query (base path only).
4. Apply submits named fields → `req.query` → controller filter service.
5. Controller exposes `hasXFiltersApplied(query)` for expand state.

```ejs
<div class="card border-0 shadow-sm mb-3">
  <div class="card-header bg-white d-flex align-items-center justify-content-between py-2 px-3">
    <div class="fw-bold text-dark"><i class="bi bi-funnel me-2"></i>Filter Enrollment Periods</div>
    <button
      id="rollingFilterToggleBtn"
      type="button"
      class="btn btn-outline-secondary btn-sm px-2"
      data-bs-toggle="collapse"
      data-bs-target="#rollingFilterCollapse"
      aria-expanded="<%= hasFiltersApplied ? 'true' : 'false' %>"
      aria-controls="rollingFilterCollapse">
      <i class="bi <%= hasFiltersApplied ? 'bi-chevron-up' : 'bi-chevron-down' %>"></i>
    </button>
  </div>
  <div class="collapse<%= hasFiltersApplied ? ' show' : '' %>" id="rollingFilterCollapse">
    <form class="card-body p-3" method="get" action="<%= filterActionUrl %>">
      <div class="row g-3 align-items-end">
        <!-- filter fields: col-lg-* col-md-* -->
        <div class="col-12 d-flex justify-content-lg-end gap-2 pt-2">
          <a href="<%= filterActionUrl %>" class="btn btn-outline-secondary btn-md">Reset</a>
          <button type="submit" class="btn btn-filled btn-primary btn-md">
            <i class="bi bi-funnel me-1"></i> Apply
          </button>
        </div>
      </div>
    </form>
  </div>
</div>
```

**Backend filter service pattern:**

- Export `filterRows(rows, query, options)` and `hasFiltersApplied(query)`.
- Keep filter param names stable (they appear in URLs, export, and pagination).
- Apply filters **before** generic `q` search when both exist.
- Pass `orgToday` from `resolveOrgTodayFromRequest(req)` for date-relative filters.

### C. `tablePages-search`

Quick search UI (client-side filter on visible rows + entry point for server DB search).

```ejs
<%- include('partials/tablePages-search', {
  placeholder: 'Search skills by code or label...'
}) %>
```

Includes:

- `#searchInput` — client-side filter as you type.
- `#searchField` — populated by `modal-table.js` from visible columns (after settings load).
- **DB Search** — `.js-open-advanced-search` opens advanced search modal.
- **Reload** — resets to list path (clears query when href is list URL).
- **Fit to Screen** — `#tableFitToggle` toggles table layout (`main.js`).

Server-side advanced search uses query params: `q`, `type` (`contains` | `starts_with` | `exact_match`), optional `searchFields`.

### D. Contextual alerts (optional)

Use for **actionable** state (org required, workflow blocked). Do **not** add static informational banners that only describe the module unless product explicitly wants them.

Skills example (org guard):

```ejs
<% if (typeof canCreateSkills !== 'undefined' && canCreateSkills === false) { %>
  <div class="alert alert-warning border d-flex gap-3 align-items-start">
    <i class="bi bi-exclamation-triangle-fill fs-5"></i>
    <div>
      <div class="fw-semibold">Organization required</div>
      <div class="small">You are in <strong>SYSTEM / GLOBAL MODE</strong>. Switch to a real organization…</div>
    </div>
  </div>
<% } %>
```

### E. Table

**Required conventions:**

| Requirement | Value / pattern |
|-------------|-----------------|
| Wrapper | `<div class="table-scroll-wrapper" data-floating-row-actions="true">` when using row action menus |
| Table id | `id="first-table"` (print, export page scrape, modal-table) |
| Table class | `class="table-responsive size-md"` |
| Sortable headers | `class="draggable"` + `data-column="fieldKey"` + optional `<span class="sort-icon"></span>` |
| Actions column | Last column, `class="text-end pe-4"`, no `data-column` (excluded from export scrape) |
| First data column | Often `class="ps-4"` on header/cells |
| Empty state | Single row, `colspan` = column count, centered muted text |
| Server pagination | Render all rows for **current page** only in tbody |
| Client-rendered lists | Empty tbody + JS render (Rolling Enrollment); ensure export/print still work or use server export |

**Sortable cell tips:**

- Use `data-sort-value` on `<td>` when display text ≠ sort value (dates, numbers, badges).
- `modal-table.js` sorts by `data-sort-value` first, then text.

**Row actions (Skills pattern):**

```ejs
<td class="table-actions text-end pe-4">
  <div class="row-actions-wrap">
    <button type="button" class="btn btn-secondary btn-sm btn-row-actions-toggle"
      data-row-actions-id="<%= item.id %>" title="Skill actions">
      <i class="bi bi-three-dots-vertical"></i>
    </button>
    <div class="row-actions-menu d-none" data-row-actions-id="<%= item.id %>">
      <a href="/school/skills/edit/<%= item.id %>" class="btn btn-outline-primary btn-sm">Edit</a>
      <button class="btn btn-outline-danger btn-sm delete-btn" data-id="<%= item.id %>">Delete</button>
    </div>
  </div>
</td>
```

Global handlers in `main.js`:

- **Delete** — `.delete-btn` + `#urlRef` → `GET /{urlRef}/delete/{id}` with `X-AJAX-Request`.
- **Row actions menu** — floating menu when wrapper has `data-floating-row-actions="true"`.

### F. Pagination

Only when the list is server-paginated:

```ejs
<%- include('partials/pagination', {
  pagination,
  filters,
  baseUrlPath: newUrl
}) %>
```

Preserves `filters` in page/limit links. Per-page selector and loading delay integrate with `showLoading()` when defined.

### G. `tablePages-end`

Closes `.card-container` and `.sections-page`. Always include once per page.

---

## Layout flags & shared modals

Set in controller `res.render` locals; consumed by `MVC/views/layouts/layout.ejs`:

| Local | Effect |
|-------|--------|
| `includeModal: true` | Generic message modal + `modal.js` |
| `includeModal_Table: true` | Table settings + advanced search modals + `modal-table.js` |
| `includeModal_FileImport: true` | Batch import modal + script |
| `print: true` | Print settings modal (in `tablePages-start`) + print scripts |

Always available on list pages:

- `modal_FileExport.ejs` + `modal_FileExport.js` (CSV/JSON; Excel when `data-excel-export-url` present).

`searchableFields` in render locals → injected into `#tableSearchConfigJson` inside `modal-table.ejs` for DB Search field picker.

---

## Export

### CSV / JSON (shared modal)

1. Set `btn_export: true` in `tablePages-start`.
2. Export button `data-base-url` defaults to `/{newUrl}`.
3. **Visible table** — scrapes `#first-table` (skips Actions column).
4. **Full database** — POST to `/{baseUrl}/export` with filters merged from `exportFilters` hidden input (requires admin verification when available).

**Implement POST `/export`** on the resource router when Full Database export is required. Skills currently exposes export UI but may need this route for DB export to succeed.

### Excel (optional, dedicated endpoint)

When server-generated `.xlsx` is needed:

1. Pass `exportExcelUrl: '/school/.../export.xlsx'` to `tablePages-start`.
2. Adds `data-excel-export-url` on Export button.
3. `modal_FileExport.js` shows **Excel Format** option and redirects with current query string (filters + search params).
4. Implement GET handler + ExcelJS service (see Rolling Enrollment / Attendance exports).

---

## Print

1. Pass `print: true` to `tablePages-start` and controller render locals.
2. User flow: Print button → settings modal (orientation, density, org header, custom note) → browser print.
3. Targets `#first-table` and `.page-heading` via `print.js`.
4. Styles: `public/styles/print-table.css`.

Admin users can toggle org name on print header; settings partially persist in browser storage.

---

## Org context & conditional create

Common pattern for org-scoped catalogs (Skills):

```javascript
const canCreate = await canCreateOrgScopedItem(req.user, { scopeLabel: 'skills' });
// newLabel: null hides New + Import
```

Block delete/create in SYSTEM/GLOBAL org when `!skillCatalogService.isRealOrganizationId(orgId)`.

Expose boolean to view for alerts and hiding row actions.

---

## Delete flow

1. `newUrl` on page → `#urlRef` dataset.
2. Delete button: `class="delete-btn" data-id="..."`.
3. Optional: `data-user` for nested delete paths.
4. Route: `GET` or `DELETE` on `/{resource}/delete/:id` (Skills uses GET with AJAX).
5. Use idempotency guard for destructive ops when concurrent clicks are a risk.
6. Return JSON `{ status, message, redirectTo }` for AJAX deletes.

---

## Search: client vs server

| Mechanism | Scope | When to use |
|-----------|-------|-------------|
| `#searchInput` + `modal-table.js` | Current DOM rows | Fast filter on visible page |
| DB Search modal | Full dataset via `q` query param | Large lists, server-side `applyGenericFilter` |
| Filter card GET form | Structured filters | Enum/status/group filters (Rolling Enrollment) |

**Order in controller:** load → domain filters → `applyGenericFilter` → sort → paginate.

Define `searchableFields` array in controller and pass to render for DB Search modal.

---

## `tableName` and column settings

- Use a stable string per list (`School_Skills`, `School_Class_RollingEnrollment`, etc.).
- Settings stored per user via `modal-table.js` (visibility, order, width, custom labels).
- `#firstTableSettingsBtn` opens customize modal.
- Changing `data-column` keys breaks saved settings—treat as migration if renaming.

---

## AJAX list endpoints

If the same data powers a JSON API:

```javascript
if (isAjax(req)) return res.json({ status: 'success', results: data, pagination });
```

Use the same filter/pagination pipeline as HTML render. Rolling Enrollment uses `listClassEnrollmentPeriods` separately but shares `buildRollingEnrollmentExportRows` for Excel.

---

## Manual QA checklist

1. Page loads with correct access gate (unauthorized user blocked).
2. Heading, dashboard/manage buttons, New/Import visibility match permissions.
3. Filter card: collapsed by default; expands when filters active; Reset clears; Apply updates URL and rows.
4. Quick search filters visible rows; DB Search updates URL and server results.
5. Column sort, drag-reorder, Table settings persist after reload.
6. Fit to Screen toggles layout.
7. Pagination and per-page limit preserve filters.
8. Row actions menu works on narrow rows (floating menu).
9. Delete confirms, handles errors, refreshes or redirects.
10. Print opens settings and produces sensible output (logo, orientation).
11. Export: CSV/JSON from visible table; Full DB when `/export` exists; Excel when `exportExcelUrl` set.
12. Empty state message when no rows.
13. SYSTEM/GLOBAL org warnings and hidden actions when applicable.

---

## File map for a new list feature

```
packages/school/
  MVC/
    routes/<entity>Routes.js          # GET list, optional GET export.xlsx, POST export
    controllers/school/<entity>Controller.js  # list*, export*, shared row builders
    services/school/<entity>FilterService.js  # optional dedicated filters
    services/school/<entity>ExcelExportService.js  # optional Excel
    views/school/<entity>/<entity>List.ejs
  test/<entity>-list.test.js
MVC/views/partials/
  tablePages-start.ejs              # only extend shared partials when pattern is global
  tablePages-search.ejs
  pagination.ejs
  tablePages-end.ejs
  modal_FileExport.ejs
public/scripts/
  modal-table.js
  modal_FileExport.js
  print.js
```

---

## Skills list — minimal EJS skeleton

```ejs
<%- include('partials/tablePages-start', { title, newUrl, newLabel, user, tableName, btn_export: true, print: true, headerManageBtns, manageBtns: [] }) %>

<%- include('partials/tablePages-search', { placeholder: 'Search skills by code or label...' }) %>

<% if (canCreateSkills === false) { %>
  <!-- org required warning only -->
<% } %>

<div class="table-scroll-wrapper" data-floating-row-actions="true">
  <table class="table-responsive size-md" id="first-table">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>
</div>

<%- include('partials/pagination', { pagination, filters, baseUrlPath: newUrl }) %>
<%- include('partials/tablePages-end') %>
```

Extend with a filter card (Rolling Enrollment), `exportExcelUrl`, page-specific modals, and client-side row rendering only when the product requires it—and keep server export/print paths consistent with what the user sees or document the difference.
