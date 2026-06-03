# School Package Template (Derived from Certified PTE)

## Goal
Use this as the implementation contract for extracting School into `packages/school` with no hardcoded core coupling.

## Required Boundaries
1. Package runtime files must not import core with deep `../../../../../MVC/...` traversal.
2. One package-local boundary file may map core dependencies, similar to:
   - `packages/pte/MVC/services/pte/pteCoreContracts.js`
3. Core runtime services must not include package-specific alias/hack behavior for School.
4. Manifest module references must be canonical package-local paths (no legacy shim tokens).
5. Views must be package-owned (`packages/school/MVC/views/...`) and include shared partials via stable include paths (`partials/...`).

## Suggested School Package Shape
- `packages/school/package.manifest.json`
- `packages/school/MVC/routes/*.js`
- `packages/school/MVC/controllers/**/*.js`
- `packages/school/MVC/services/**/*.js`
- `packages/school/MVC/repositories/**/*.js`
- `packages/school/MVC/models/**/*.js`
- `packages/school/MVC/views/school/**/*.ejs`
- `packages/school/public/**`

## Migration Sequence
1. Scaffold `packages/school` and manifest with metadata-only route entries first.
2. Add package-local adapters for core dependencies (single contract boundary).
3. Move routes/controllers/middleware with unchanged behavior.
4. Move services/repositories/models.
5. Move views/assets and normalize includes.
6. Remove root `MVC/views/school` duplicates after package views are authoritative.
7. Remove School-specific constants/branches from core surfaces.

## Certification Checks for School
- No package-specific alias logic in core runtime services.
- No deep core import traversal outside School core-contract boundary file.
- Manifest has no legacy shim paths.
- Route mount and startup recovery tests pass.
- Install/enable/disable/remove flows pass with package-manager tests.

## Non-Negotiable Rule
Core remains package-agnostic infrastructure; domain logic and domain declarations stay package-owned.
