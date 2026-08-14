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

## Mongo persistence workflow

1. Edit the **parent** section in Section Management (not only the child).
2. Drag the child into the parent's **Subsections** list and click **Save**.
3. Confirm the parent document in Mongo (`sections` collection) contains the new `{ id: "..." }` entry in `subsections`.
4. Restart the app and re-check the same Mongo document before opening the UI.

Expected behavior:

- Mongo keeps the saved `subsections` / `related` arrays.
- Startup package sync may update other section fields from the manifest (description, active, operations, etc.).
- Startup package sync does **not** overwrite runtime topology for existing sections.

## Mongo troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Child disappears after restart | Parent `subsections` not saved | Re-open parent in Section Management and confirm child is listed |
| UI shows old topology but Mongo looks correct | Cached navigation or wrong org/profile | Hard refresh; verify active org and access profile |
| Edits never appear in Mongo | Backend fell back to JSON | Startup logs for `json-fallback`; confirm `DATA_BACKEND=mongo` and Mongo connectivity |
| Manifest file still shows old links | Expected | Manifest is package baseline; runtime topology lives in Mongo |

Startup logs:

- `PACKAGE_INSTALLER / REGISTRY_SYNC` — package registry sync finished.
- `PACKAGE_INSTALLER / SECTION_TOPOLOGY_DRIFT` — manifest topology differs from Mongo, but runtime links were preserved (informational only).

Manifest audit is optional and only needed when you want to copy Mongo topology back into `package.manifest.json` for reproducible installs:

```bash
npm run school:manifest:audit
npm run school:manifest:audit:apply
```

Do **not** run `school:manifest:audit:apply` unless Mongo already has the desired topology.

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
- `test/package-registry-installer-service.test.js` — subsection preservation on package sync, repeated mongo sync simulation, topology drift reporting
