# Core vs Package Boundary Report (Step 1)

## Summary
This report captures the current architecture boundary for package separation work and serves as the Step 1 source of truth.

Goal for this phase:
- Inventory and classify current system ownership.
- Document temporary domain coupling ("leaks") with code evidence.
- Prepare a clean handoff into Step 2 (package manifest contract) without changing runtime behavior.

This document is inventory-only. No behavior changes are introduced by this step.

---

## Taxonomy

### 1) Core-owned
Core-owned capabilities are framework responsibilities that should remain in core:

- Authentication, login, session handling.
- Users, persons, organizations, memberships.
- Role registry and role CRUD surface (`/roles`).
- Access control primitives: accesses, sections, symbols, scopes, access policies.
- Action state lifecycle and admin verification.
- Activity Quota system (explicitly core-owned).
- Settings, branding, website policy, org policy.
- Dashboard framework and shared menu framework.
- File manager + upload/storage infrastructure.
- JSON/Mongo backend abstraction and repository backend selector.
- Shared logs/audit and table settings.
- Import/export and migration framework.

### 2) Package-owned
Package-owned scope should include package-specific domain implementation:

- Domain routes/controllers/services/models/repositories/views.
- Domain public assets.
- Domain data and seed/migration scripts.
- Domain registry declarations (roles, sections, symbols, accesses).
- Domain upload folder declarations.
- Domain menu/dashboard entries.
- Domain quota definitions consumed by the core Activity Quota engine.

### 3) Shared core services consumed by packages
These are shared framework services package code should consume rather than re-implement:

- Access middleware and policy evaluation.
- Action state services and trackers.
- Person/user/org APIs and repositories.
- File/storage services and upload folder settings.
- Activity Quota ledgers/rules/packages.
- Shared query executor framework.
- Shared branding/menu composition services.

### 4) Current domain leaks (temporary)
The current codebase still contains hardcoded domain coupling in core surfaces. These are transitional and expected to be addressed in later steps.

---

## Domain Mapping (Current State)

### PTE
- Current state: logically domain-specific, partially grouped under `MVC/*/pte`, but still coupled into core through route mounts, constants, upload wiring, person join behavior, menus, and action-state tracking.
- Target ownership: package-owned implementation + manifest-driven registration.

### SCHOOL
- Current state: domain modules exist and are partly folderized; still coupled via core route mount, section constants, upload settings, and query executor bootstrap registration.
- Target ownership: package-owned implementation + manifest-driven registration.

### IELTS
- Current state: domain modules exist and are coupled via core route mount, constants, upload categories, and direct query executor registration.
- Target ownership: package-owned implementation + manifest-driven registration.

### BENCHPATH
- Current state: route mount and section constants are hardcoded in core; packageization boundary not yet enforced.
- Target ownership: package-owned implementation + manifest-driven registration.

### CREDIT
- Current state: route mount and section constants are hardcoded in core; packageization boundary not yet enforced.
- Target ownership: package-owned implementation + manifest-driven registration.

### Activity Quota (explicit decision)
- Current state: first-class core subsystem with its own sections/routes/services/models.
- Decision: remains core-owned; packages may register quota definitions or consume quota services.

---

## Evidence-Backed Coupling Inventory

The following inventory records the known coupling points with concrete repo references:

1. Hardcoded domain route mounts in core app bootstrap:
   - `app.js:285`, `app.js:287`, `app.js:289`, `app.js:291`, `app.js:293`
   - `/pte`, `/ielts`, `/benchpath`, `/credit`, `/school` are mounted directly.

2. Domain sections/constants embedded in shared access constants:
   - `config/accessConstants.js:47-89` (SCHOOL)
   - `config/accessConstants.js:101-124` (PTE)
   - `config/accessConstants.js:127-131` (IELTS)
   - `config/accessConstants.js:134-147` (BENCHPATH)
   - `config/accessConstants.js:91-98` confirms Activity Quota as its own core section family.

3. Upload folder setting definitions include domain-specific keys in shared core service:
   - `MVC/services/uploadFolderSettingsService.js:36-40` (school.*)
   - `MVC/services/uploadFolderSettingsService.js:42-49` (pte.*)
   - `MVC/services/uploadFolderSettingsService.js:34` (`core.ielts`)

4. Upload middleware contains domain category branching:
   - `MVC/middleware/upload.js:71-72`, `84-89`, `94-111`
   - Includes school and pte category-specific resolution and PTE utility dependency.

5. Branding/menu defaults include hardcoded PTE public links:
   - `MVC/services/appBrandingService.js:79`, `92-95`

6. Query executor bootstrap imports package repositories directly:
   - `MVC/models/queryExecutorBootstrap.js:30-31`
   - `MVC/models/queryExecutorBootstrap.js:254-279` (school executors)
   - `MVC/models/queryExecutorBootstrap.js:282-285` (ielts executors)

7. Person controller includes PTE public join behavior:
   - `MVC/controllers/personController.js:400`, `984-1004`, `1024`, `1190-1198`

8. Role registry still infers package/domain from role key prefixes:
   - `MVC/services/person/roleRegistryService.js:121-127`, `148-202`, `261-315`

9. Action-state tracker contains PTE-specific tracked entity set:
   - `MVC/services/actionStateChangeTrackerService.js:14-15`, `55-59`

10. Domain data files exist in root-level `data/`:
   - `data/pte*` files (for example `pteApplicants.json`, `pteAttemptSessions.json`, `pteAiScoringSettings.json`)
   - Domain folders present: `data/pte`, `data/school`, `data/ielts`, `data/benchpath`, `data/credit`

11. Domain seed/migration scripts are root-level:
   - `scripts/seed-pte-*.js`, `scripts/seed-benchpath-*.js`, `scripts/migrate-pte-*.js`, `scripts/migrate-school-*.js`

12. Package-specific public asset is in shared root public scripts:
   - `public/scripts/ptePracticeCoachRules.js`

13. PTE repositories are in shared repository root (not isolated under `MVC/repositories/pte`):
   - root-level files such as `MVC/repositories/pteApplicantRepository.js`, `MVC/repositories/pteAttemptSessionRepository.js`, etc.
   - note: `MVC/repositories/pte/` path is currently absent in this repository.

---

## Boundary Classification Snapshot

### Core-owned now (and stays core)
- Access/auth/session framework.
- People and identity framework.
- Role/section/symbol/access policy registries.
- File manager + storage abstraction surfaces.
- Action state + admin verification framework.
- Activity Quota framework.
- Shared settings/branding/dashboard/menu framework.
- JSON/Mongo backend infrastructure.

### Should become package-owned over time
- PTE/SCHOOL/IELTS/BENCHPATH/CREDIT domain logic and declarations.
- Domain-specific public assets.
- Domain-specific repositories/data scripts.
- Domain-specific upload folder declarations and menu entries.

### Transitional/shared (allowed for now)
- Core services that domains consume (access checks, upload APIs, action state, quota, query framework).
- Temporary compatibility constants and route mounts until package loader/install flow is introduced.

---

## Migration Readiness Checklist for Step 2 (Manifest Contract)

Use this checklist to start Step 2 without rediscovery:

1. Define manifest schema that can declare:
   - id/name/version/mountPath
   - routes/views/assets
   - roles/sections/symbols/accesses
   - upload folders
   - menu/dashboard entries
   - quota definitions
   - seeders/migrations
   - dependencies

2. Ensure manifest validation guards:
   - duplicate package IDs
   - unsafe package IDs
   - invalid mount paths
   - missing required fields

3. Keep compatibility posture for Step 2:
   - do not remove existing hardcoded route mounts yet
   - do not move domain files yet
   - do not alter existing API payloads yet

4. Use this Step 1 coupling inventory as acceptance evidence:
   - every listed leak point should eventually map to a manifest-driven registration or a core service contract.

---

## Step 1 Acceptance Confirmation

- Inventory document created as source of truth.
- Taxonomy includes:
  - Core-owned
  - Package-owned
  - Shared core services consumed by packages
  - Current domain leaks (temporary)
- Domain mapping includes:
  - PTE, SCHOOL, IELTS, BENCHPATH, CREDIT
  - Activity Quota explicitly marked as core
- Coupling inventory includes concrete code references.
- Step 2 handoff checklist included.
- No runtime behavior changes made in this step.
