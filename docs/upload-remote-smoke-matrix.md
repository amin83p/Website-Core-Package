# Remote upload smoke matrix

Use with `UPLOAD_MODE=railway_proxy`, `RAILWAY_GATEWAY_BASE_URL`, and `FILE_GATEWAY_SHARED_KEY` set on the app and gateway host.

For **Azure Blob**, set `UPLOAD_MODE=azure_blob` (or App Defaults), `AZURE_STORAGE_CONNECTION_STRING`, and `app.azureBlobContainer` (or `AZURE_STORAGE_CONTAINER`). Run `node scripts/core/smoke-upload-remote-readiness.js`.

**Automated tests:** `npm run test:upload-storage` stubs `app.uploadStorageBackend` to `local` via [`test/helpers/uploadModeTestIsolation.js`](../test/helpers/uploadModeTestIsolation.js) so local-mode cases are not affected by `data/systemSettings.json`. **Live Azure / Railway checks** remain manual per the matrix below.

Run automated readiness checks first (loads project `.env` like `app.js`):

```bash
npm run smoke:upload:remote
npm run test:upload-storage
```

## Manual checks (deployed or staging)

| Flow | Pass criteria |
|------|----------------|
| News image upload + article view | Body images load via `/uploads/...`; stale local decoy under staging root is not served |
| File manager upload + download | Upload succeeds; download redirects or proxies to gateway |
| Chat attachment | Send file; secure download works; delete conversation removes remote folder |
| Contact / symbol / task upload | Metadata stores `/uploads/...` only |
| System settings public page media | Upload + media picker lists volume files |
| Global logo in layout | `/uploads/GLOBAL/logo/...` loads |
| PTE student media library | Folder list from volume |
| PTE practice scoring (audio/image) | Scoring completes using volume artifacts |

Optional negative test: place a wrong file at the local staging path for a known URL; browser and scoring should still use volume content.
