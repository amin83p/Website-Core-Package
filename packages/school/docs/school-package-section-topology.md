# School Package Section Topology

## Intended hierarchy

- **SCHOOL** (`122740`) is the school root navigator. Direct children include hubs such as **SCHOOL_MASTER_ACADEMIA_HUB** (`445577`) and **SCHOOL_CALENDAR** (`445581`).
- **SCHOOL_ACADEMIA** (`139382`) is the academic navigator. **SCHOOL_SAMPLE_DATA** (`445561`) belongs here, not under the school root.

The section name `SCHOOL_SAMPLE_DATA` is unchanged for routes and access checks. Only the parent subsection link moved.

## Create vs sync behavior

`packageRegistryInstallerService` applies manifest section declarations as follows:

| Phase | Behavior |
|---|---|
| **Create** (section not in backend yet) | Manifest defaults are written, including subsection links |
| **Startup / install / enable / reload-runtime** (`sectionSyncMode: create-only`) | Existing sections are **not** updated; only missing sections are created |
| **Sync Declarations** (`sectionSyncMode: full`) | Existing sections sync non-topology fields from manifest; topology (`subsections`, `related`) is still preserved |
| **Package Manager → Section Sync** | Compare runtime vs manifest per section; apply selected direction (manifest → app or app → manifest), including topology when enabled |

Other section fields (description, `homeURL`, active, operations, dashboard flags, and so on) are no longer overwritten on app restart.

## Admin UI is the runtime source of truth

After a section exists, edit it in **Section Management**. App restart will not revert those edits.

Use **System Settings → Package Manager → Section Sync** when you want to align runtime data and the package manifest deliberately.

## Mongo persistence workflow

1. Edit the **parent** section in Section Management (not only the child).
2. Drag the child into the parent's **Subsections** list and click **Save**.
3. Confirm the parent document in Mongo (`sections` collection) contains the new `{ id: "..." }` entry in `subsections`.
4. Restart the app and re-check the same Mongo document before opening the UI.

Expected behavior:

- Mongo keeps saved section fields and topology.
- Startup package sync creates missing package sections only.
- Startup package sync does **not** overwrite existing section rows.
- **Sync Declarations** can still force a full manifest push for sections when explicitly chosen.
- **Section Sync** is the preferred in-app tool for comparing and copying section data either way.

## Mongo troubleshooting

| Symptom | Likely cause | What to check |
|---|---|---|
| Child disappears after restart | Parent `subsections` not saved | Re-open parent in Section Management and confirm child is listed |
| UI shows old topology but Mongo looks correct | Cached navigation or wrong org/profile | Hard refresh; verify active org and access profile |
| Edits never appear in Mongo | Backend fell back to JSON | Startup logs for `json-fallback`; confirm `DATA_BACKEND=mongo` and Mongo connectivity |
| Manifest file still shows old links | Expected until you sync | Use Package Manager **Section Sync → Apply App → Manifest** when Mongo is correct |
| `homeURL` returns after restart | Old startup sync behavior | Confirm app is on current build; startup should preserve existing rows |

Startup logs:

- `PACKAGE_INSTALLER / REGISTRY_SYNC` — package registry sync finished.
- `PACKAGE_INSTALLER / SECTION_DRIFT` — manifest differs from runtime for existing sections, but rows were preserved (informational only).
- `PACKAGE_INSTALLER / SECTION_TOPOLOGY_DRIFT` — legacy topology-only drift log (still emitted when topology differs).

Manifest audit is optional and only needed when you want CLI-based manifest updates:

```bash
npm run school:manifest:audit
npm run school:manifest:audit:apply
```

Prefer **Package Manager → Section Sync** for in-app manifest/runtime alignment.

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
- `test/package-registry-installer-service.test.js` — create-only startup sync, full sync override, topology drift reporting
- `test/package-section-sync-service.test.js` — section sync preview and apply flows
