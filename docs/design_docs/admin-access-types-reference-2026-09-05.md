# Admin Access Types Reference

Access Profile reference | 5 September 2026

## Agent usage

Consult this document when:

- Adding or changing access checks, route gates, or admin override behavior
- Writing or updating section operation-scope docs (attendance, chat, sessions, etc.)
- Deciding whether a user follows operation/scope matrix rows or bypasses them

**Critical rules:**

1. **Family A (bypass admins)** — When `isRequestAdmin` is true, section operation/scope matrices do **not** apply unless a section doc states a separate business rule.
2. **Family B (ADMIN scope)** — The **ADMIN** column in section docs means Access Profile scope `ADMIN` / `SCP_ADMIN` only. It is **not** the same as bypass section or global admins.
3. **Which function to call** — Use `evaluateAccess` for route gates; use `isAdminForRequestAsync` for explicit override flags. See Developer API reference below.

Implementation files: `MVC/services/adminAuthorityService.js`, `MVC/services/security/accessControl.js`, `MVC/services/security/effectiveAccessResolverService.js`.

---

## 1. Purpose and status

This is the canonical reference for all admin-like privileges in the central access system. It applies app-wide. Section-specific behavior (attendance field tiers, chat participant rules, session editor scope) stays in section design docs.

**Status:** Working reference aligned to current code in `adminAuthorityService.js` and `accessControl.js`.

---

## 2. Two admin families

### Family A — Bypass admins

- Recognized by `adminAuthorityService`; when `isRequestAdmin` is true, `accessControl.evaluateAccess` grants the request without evaluating normal profile operation rows.
- Section operation matrices **do not apply** to these users unless a section doc explicitly states a separate business rule (for example, chat participant checks).

### Family B — Access Profile ADMIN scope (`SCP_ADMIN` / scope mode `admin`)

- This is what **ADMIN** in a scope column means in section operation-scope documents.
- **Not** the same as bypass section/global admins.
- User receives the **ADMIN scope tier** for that operation only (cumulative "+" extras in section matrices).
- Document separately from bypass admins.

---

## 3. Bypass admin types

Columns: **Name | How recognized | Org boundary | Effect on access check | Typical use | Code signals**

| Name | How recognized | Org boundary | Effect on access check | Typical use | Code signals |
| --- | --- | --- | --- | --- | --- |
| Built-in Super Users | Virtual Root account, `accessLevel >= 10`, or `SYSTEM_CONTEXT` | None (system-wide) | All access checks skipped; `isRequestAdmin` true everywhere | Platform operators, emergency access | `isSuperAdmin()` → `SUPER_ADMIN` |
| Admin Global (Full System Admin) | Active profile `fullAdmin: true` | Profile without `orgId` applies globally; org-bound profile limited to that org | Access checks skipped within applicable org scope | Organization owners, IT admins | `isSystemAdmin` → `FULL_SYSTEM_ADMIN_PROFILE` |
| Admin Global in Organization | `fullAdmin: true` on org-scoped profile | Selected organization only | Bypass within org data scope only | Org-level administrators | `FULL_SYSTEM_ADMIN_PROFILE` + org profile match |
| Scoped Admin to Category | Profile `adminCategories` contains section category (e.g. `SCHOOL`, `GENERAL`) | Org-scoped profile limits to org | Bypass for sections in that category | Category managers | `CATEGORY_ADMIN:{category}` |
| Scoped Admin to Category in Organization | Category admin + org-bound profile | Selected organization + category | Same as category admin, org-limited | Org category leads | `CATEGORY_ADMIN:{category}` + org match |
| Admin Access to This Section | Section `adminAccess: true` or section `accessType: full_access` on profile | Org-scoped profile limits to org | Bypass for all operations in that section | Section maintainers | `SECTION_ADMIN:{sectionId}` |
| Admin Access to This Section in Organization | Org policy targeted section `full_access` for user (`targetUserIds`) | Selected organization, targeted user | Bypass for section within org when user is targeted | Org-assigned section admins | `ORG_POLICY_SECTION_FULL_ACCESS:{sectionId}` |
| Operation Admin (config flag) | Operation `adminAccess: true`, `accessType: full_access`, or ADMIN scope on operation row | Respects policy bans and org targeting | Bypass for that section+operation only | Operation-specific overrides | `OPERATION_ADMIN:{sectionId}:{operationId}` |

**Limits that can suspend bypass paths:**

- User policy or org policy `full_ban` on section or operation
- Org policy section not targeting the user (`targetUserIds`)
- Inactive profile, inactive policy, or profile not applicable to active org
- Website governance `full_ban`
- Section or operation globally disabled

---

## 4. ADMIN scope tier (Family B)

**Definition:** An operation row in an Access Profile with scope `ADMIN`, `SCP_ADMIN`, or scope mode `admin`.

**Detection:** `effectiveAccessResolverService.isAdminScope(scopeId)` or `isAdminScopeSync(scopeId)`.

**Documentation rule:** Section operation tables use **ADMIN scope rows** only for Family B users. Bypass admins (Family A) receive full privilege and do not need ADMIN scope rows.

**Relationship to bypass in code:** `resolveAdminAuthorityAsync` may set `isOperationAdminForRequest` when effective access has ADMIN scope (`EFFECTIVE_ADMIN_SCOPE:SCP_ADMIN`). In section docs, treat scope ADMIN as the incremental tier for non-bypass users, not as global admin.

**What Family B ADMIN scope users get:** Only the extras documented in the section doc's ADMIN column for that operation. Lower scope tiers are assumed cumulative.

---

## 5. Resolution flow

```
Request → evaluateAccess
  → resolveAdminAuthorityAsync
  → if isRequestAdmin (Family A) → grant (note grantSource)
  → else → profile/policy operation + scope rows apply
  → if scope is ADMIN (Family B) → apply section doc ADMIN tier extras
```

**Grant source labels** (from `accessControl.js` when `isRequestAdmin`):

| Condition | grantSource |
| --- | --- |
| Super admin | Super Admin |
| Full system admin profile | Full System Admin Profile |
| Category admin for section | Category Admin ({category}) |
| Section admin access | Section Admin Access |
| Operation admin | Operation Admin Access |

Non-bypass grants use `Profile/Policy Operation` or `Section Access`.

**Authority reason codes** (from `resolveAdminAuthority` / `resolveAdminAuthorityAsync`):

| Reason | Meaning |
| --- | --- |
| SUPER_ADMIN | Built-in super user |
| FULL_SYSTEM_ADMIN_PROFILE | Profile fullAdmin |
| CATEGORY_ADMIN:{category} | Category-scoped admin |
| SECTION_ADMIN:{sectionId} | Section adminAccess / full_access |
| OPERATION_ADMIN:{sectionId}:{operationId} | Operation admin flag |
| POLICY_SECTION_FULL_ACCESS / FULL_BAN | User policy section override |
| ORG_POLICY_SECTION_FULL_ACCESS / FULL_BAN | Org policy section override |
| EFFECTIVE_SECTION_ADMIN | Merged effective access section admin |
| EFFECTIVE_OPERATION_ADMIN | Merged effective access operation admin |
| EFFECTIVE_ADMIN_SCOPE:{scopeId} | ADMIN scope on effective operation row |

---

## 6. Policy and organization limits

- **Profile org applicability:** `profileAppliesToOrg(profile, user, orgId)` — org-bound profiles only apply when `activeOrgId` matches.
- **Org policy:** `getActiveOrgPolicy(user, orgId)` — org-wide policy layer.
- **User policy:** Can set section/operation `full_ban` or `full_access`, suspending or overriding profile grants.
- **Org policy targeting:** Sections with `targetUserIds` apply only to listed users; other users do not receive org-policy bypass even if policy exists.
- **Effective access merge:** `resolveEffectiveAccess` merges profile, user policy, and org policy; bans take precedence over admin bypass in `evaluateAccess`.

---

## 7. How section docs should reference this doc

Replace duplicated "ADMINS And their privileges" blocks with:

> See [admin-access-types-reference-2026-09-05.md](admin-access-types-reference-2026-09-05.md). Operation/scope rows apply only to non-bypass users. ADMIN in the scope column means Family B (Access Profile ADMIN scope) only.

Section docs should:

- Document operation/scope matrix rows for non-bypass users only
- Use ADMIN column for Family B incremental extras only
- Link here for bypass admin behavior instead of copying full admin tables
- State section-specific business rules that still apply to bypass admins (if any)

---

## 8. Developer API reference

### 8.1 Service map

| Use case | Primary service | Path |
| --- | --- | --- |
| Route / middleware gate | `accessControl.evaluateAccess` | `MVC/services/security/accessControl.js` |
| Bypass admin check (section+operation) | `adminAuthorityService.isAdminForRequestAsync` | `MVC/services/adminAuthorityService.js` |
| Full authority payload + reason codes | `adminAuthorityService.resolveAdminAuthorityAsync` | same |
| Section-level admin (any operation) | `adminAuthorityService.isAdminForSectionAsync` | same |
| ADMIN scope detection (Family B) | `effectiveAccessResolverService.isAdminScope` | `MVC/services/security/effectiveAccessResolverService.js` |
| Merged profile/policy result | `effectiveAccessResolverService.resolveEffectiveAccess` | same |
| School package wrappers | `schoolAdminAccessService` | `packages/school/MVC/services/school/schoolAdminAccessService.js` |

**Rule of thumb:** Prefer `evaluateAccess` for route gates. Use `isAdminForRequestAsync` only when you need an explicit admin override on top of normal access (session lock bypass, completed-session edit window, admin-only UI affordances). Do not reimplement admin math in controllers.

### 8.2 Core functions

| Function | When to use | Inputs | Returns | Notes |
| --- | --- | --- | --- | --- |
| `evaluateAccess({ user, sectionId, operationId, ipAddress })` | Standard HTTP route gate, UI capability tied to operation | Hydrated `req.user`, section id, operation id, optional IP | `{ allowed, reason, limits, scopeId, adminContext, effectiveAccess, ... }` | If `adminContext.isRequestAdmin`, grants with `grantSource`. Non-admins need profile operation grant. |
| `isAdminForRequestAsync(user, sectionId, operationId, orgContext)` | Feature override checks | `user`, `sectionId`, `operationId`, optional `{ orgId, section: { id, category } }` | `boolean` — `isRequestAdmin` | Sync: `isAdminForRequest`. Prefer async in controllers. |
| `isAdminForSectionAsync(user, sectionId, orgContext)` | Section-level admin, not specific operation | Same orgContext shape | `boolean` — `isSectionAdmin \|\| isSuperAdmin` | Sync: `isAdminForSection`. |
| `resolveAdminAuthorityAsync({ user, sectionId, operationId, orgId, section, effectiveAccess })` | Debugging, audit, UI showing why user is admin | Full context object | Authority payload (see below) | Sync: `resolveAdminAuthority`. |
| `isSuperAdmin(user)` | System-wide bypass only | `user` | `boolean` | Rare in feature code; prefer scoped checks. |
| `isSystemAdmin(user, orgContext)` | Full admin profile check | `user`, optional orgContext | `boolean` | Includes super admin. |
| `isAdminScope(scopeId)` / `isAdminScopeSync(scopeId)` | Detect Family B ADMIN scope on operation row | Scope token from effective access | `boolean` | Not a bypass check by itself. |
| `resolveEffectiveAccess({ user, sectionId, operationId, orgId })` | Need merged operation scope and allowed flag | User + section + operation | Effective access object | Used internally by `evaluateAccess`. |
| `hasAnyAdminPrivilege(user, orgId)` | Coarse "any admin on profile" check | `user`, optional orgId | `boolean` | Does not replace request-level checks. |

**Authority payload shape** (`resolveAdminAuthorityAsync` return):

| Field | Type | Meaning |
| --- | --- | --- |
| `isSuperAdmin` | boolean | Built-in super user |
| `isSystemAdmin` | boolean | Profile fullAdmin |
| `isCategoryAdminForSection` | boolean | Category admin for section's category |
| `isGrantAdminAccessForSection` | boolean | Section adminAccess / full_access |
| `isOperationAdminForRequest` | boolean | Operation admin for request |
| `isSectionAdmin` | boolean | systemAdmin \|\| categoryAdmin \|\| grantAdmin |
| `isRequestAdmin` | boolean | superAdmin \|\| sectionAdmin \|\| operationAdmin |
| `reasons` | string[] | Diagnostic reason codes |
| `sectionId`, `operationId`, `category` | string \| null | Resolved targets |

### 8.3 Recommended call patterns

1. **Route middleware:** `requireAccess(SECTIONS.X, OPERATIONS.Y)` — internally uses `evaluateAccess`. No direct admin call needed.
2. **Controller override flag:** `await adminAuthorityService.isAdminForRequestAsync(req.user, SECTIONS.X, OPERATIONS.UPDATE, { section: { id: SECTIONS.X, category: 'SCHOOL' } })`.
3. **School module:** `await schoolAdminAccessService.isAttendancesAdminViewerAsync(user, OPERATIONS.READ_ALL)` — delegates to `isAdminForRequestAsync` with SCHOOL category in orgContext.
4. **Do not use:** Raw `user.accessLevel >= 10`, `profile.fullAdmin`, or `section.adminAccess` checks in feature code — always go through `adminAuthorityService`.

### 8.4 orgContext conventions

Standard shape:

```javascript
{
  orgId: user.activeOrgId,
  section: { id: sectionId, category: 'SCHOOL' | 'GENERAL' | ... }
}
```

Category matters for category-admin resolution. School facade builds this via `buildOrgContext(user, sectionId)`.

### 8.5 Expected behavior: bypass vs non-bypass

| Caller | Bypass admin (`isRequestAdmin`) | Non-bypass user |
| --- | --- | --- |
| `evaluateAccess` | `allowed: true`, grantSource names admin type | Requires profile operation grant + scope |
| `isAdminForRequestAsync` | `true` | `false` unless section/operation admin flags apply |
| Section operation matrix in docs | Ignored (full privilege) | Applies READ / READ_ALL / UPDATE tiers |
| ADMIN scope row in docs | Does not apply to bypass admins | Applies incremental "+" tier only (Family B) |

---

## 9. Implementation references

| File | Role |
| --- | --- |
| `MVC/services/adminAuthorityService.js` | Authority resolution, `isAdminForRequestAsync`, reason codes |
| `MVC/services/security/accessControl.js` | `evaluateAccess`, `isRequestAdmin` grant bypass, grantSource |
| `MVC/services/security/effectiveAccessResolverService.js` | Scope modes, `isAdminScope`, `resolveEffectiveAccess` |
| `packages/school/MVC/services/school/schoolAdminAccessService.js` | School wrappers with SCHOOL category defaults |
| `docs/chat-access-architecture-report-2026-09-03.md` | Chat-specific access rules (cross-link; do not duplicate here) |

---

## Related documents

| Document | Relationship |
| --- | --- |
| `docs/attendance-operation-scope-capabilities-2026-09-04.docx` | Section operation matrix; should link here for admin behavior |
| `docs/chat-operation-scope-capabilities-2026-09-03.docx` | Chat section matrix; chat participant rules are section-specific |
| `docs/manage-session-access-architecture-report-2026-09-04.md` | Manage Session access architecture |
