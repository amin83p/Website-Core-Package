# School Package Section Topology

## Intended hierarchy

- **SCHOOL** (`122740`) is the school root navigator. Direct children include hubs such as **SCHOOL_MASTER_ACADEMIA_HUB** (`445577`) and **SCHOOL_CALENDAR** (`445581`).
- **SCHOOL_ACADEMIA** (`139382`) is the academic navigator. **SCHOOL_SAMPLE_DATA** (`445561`) belongs here, not under the school root.

The section name `SCHOOL_SAMPLE_DATA` is unchanged for routes and access checks. Only the parent subsection link moved.

## Create vs sync behavior

`packageRegistryInstallerService` applies manifest section declarations as follows:

| Phase | `subsections` / `related` behavior |
|---|---|
| **Create** (section not in backend yet) | Manifest defaults are written, including subsection links |
| **Update** (section already exists) | Subsection and related topology are **not** overwritten; admin UI edits are preserved |

Other section fields (description, active, operations, dashboard flags, and so on) still sync from the manifest on update.

## Admin UI is the runtime source of truth

After a section exists, rearrange subsections in **Section Management**. Package sync and app startup will not revert those links.

## Manifest audit script caution

`npm run school:manifest:audit:apply` rewrites `packages/school/package.manifest.json` from the active backend. Use it only when MongoDB/JSON backend section rows already reflect the desired topology. Otherwise it can copy stale parent links back into the manifest.

Dry-run first:

```bash
npm run school:manifest:audit
```

## Seed script policy

`npm run school:master-academia-hub:seed` should:

- Upsert the hub section and symbol
- **Append** the hub id under **SCHOOL** only if missing
- **Never** replace the full parent `subsections` array
- Remove duplicate hub documents that share the same section name

This matches the installer policy: seeds add declared links without resetting administrator-configured topology.

## Regression coverage

- `packages/school/test/school-package-section-topology.test.js` — manifest hierarchy invariants
- `test/package-registry-installer-service.test.js` — subsection preservation on package sync
