# Upload Path Behavior (Local vs Remote Backends)

All durable upload/read/delete operations go through **`MVC/services/uploadStorageService.js`**. Packages (including school) must not import gateway clients, upload mode helpers, or legacy asset storage modules directly.

## Configuration

| Source | Keys |
|--------|------|
| **App Defaults** | `app.uploadStorageBackend` (`local`, `railway_proxy`, `azure_blob`), `app.uploadsPath`, `app.azureBlobContainer`, `app.azureBlobPrefix`, `app.uploadRemoteReadMode` (`redirect` or `proxy`), `uploadFolders.*` |
| **`.env` (override)** | `UPLOAD_MODE` (when set, overrides App Defaults), `RAILWAY_GATEWAY_BASE_URL`, `FILE_GATEWAY_SHARED_KEY`, `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT` + `AZURE_STORAGE_ACCOUNT_KEY`, optional `AZURE_STORAGE_CONTAINER`, `UPLOAD_REMOTE_READ_MODE`, `UPLOAD_STORAGE_STRICT_BOOT` (default `true`) |

Public URLs are always `/uploads/...`; physical storage depends on backend:

- **`local`** — files on disk under `app.uploadsPath` (must exist and be writable).
- **`railway_proxy`** — backend **`railway_gateway`**: signed HTTP gateway to the Railway volume. No local disk fallback for durable reads.
- **`azure_blob`** — Azure Blob Storage in the configured container; blob keys mirror `/uploads/GLOBAL/...` and `/uploads/ORG_{orgId}/...` layout (optional `app.azureBlobPrefix`).
- **`s3`** — reserved; not implemented yet.

Multer still writes a **staging copy** under `app.uploadsPath` before mirroring to remote storage; that path must be writable when using `railway_proxy` or `azure_blob`.

## Boot validation

After settings load, `uploadStoragePolicyService.validateUploadStorageAtBoot()` runs. With strict boot (default), misconfiguration prevents startup with a clear error.

## Multer and File Manager

- **`uploadStorageService.persistMulterUploads`** mirrors staged files to the active remote driver and sets **`storedRef`** `/uploads/...` on each file.
- File Manager uses **`uploadStorageService.fileManager.*`** (backed by **`uploadRemoteDriverService`** in remote modes).
- HTTP **`GET /uploads/...`** in remote modes uses **`uploadStorageService.streamPublicUpload`** (Railway gateway redirect/proxy or Azure SAS redirect/proxy).

## Remote mode rules (no local cache)

When **`uploadStoragePolicyService.preferRemoteUploadReads()`** is true:

- Do **not** read durable upload bytes from `app.uploadsPath` before the remote backend.
- Persist only **`/uploads/...` URLs** in Mongo/JSON.
- **`allowLocalUploadFallback()`** is **false**.

## Switching backends

Changing App Defaults (or `UPLOAD_MODE`) does **not** migrate files. Copy blobs or use `scripts/maintenance/migrate-uploads-to-azure-blob.js` before cutover.

## Package usage

```js
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
const saved = await uploadStorage.saveBuffer({ scopeKey, relativeDir, fileName, buffer, mimeType });
// Persist saved.url in Mongo/JSON only
```