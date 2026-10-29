# Upload Path Behavior (Local vs Railway Gateway)

All durable upload/read/delete operations go through **`MVC/services/uploadStorageService.js`**. Packages (including school) must not import gateway clients, upload mode helpers, or legacy asset storage modules directly.

## Configuration

| Source | Keys |
|--------|------|
| `.env` | `UPLOAD_MODE` (`local` or `railway_proxy`; `s3` reserved), `RAILWAY_GATEWAY_BASE_URL`, `FILE_GATEWAY_SHARED_KEY`, `UPLOAD_REMOTE_READ_MODE` (`redirect` default, or `proxy`), optional `UPLOAD_STORAGE_STRICT_BOOT` (default `true`) |
| System Settings | `app.uploadsPath`, `uploadFolders.*` |

Public URLs are always `/uploads/...`; physical storage depends on backend:

- **`local`** — files on disk under `app.uploadsPath` (must exist and be writable; no silent fallback to project `uploads/` when misconfigured).
- **`railway_proxy`** — backend is **`railway_gateway`**: reads/writes go through the signed gateway to the Railway volume. **No local disk fallback** when the gateway URL or shared key is missing or requests fail.
- Multer still writes a **staging copy** under `app.uploadsPath` before mirroring to the gateway; that path must be writable in both modes (boot validation checks it for `railway_proxy` as well).

## Boot validation

After settings load, `uploadStoragePolicyService.validateUploadStorageAtBoot()` runs. With strict boot (default), misconfiguration prevents startup with a clear error. Set `UPLOAD_STORAGE_STRICT_BOOT=false` only for local development when you intentionally run with incomplete gateway env.

## Multer and File Manager

- Multer still stages to the configured upload root; **`uploadStorageService.persistMulterUploads`** mirrors to the gateway in `railway_proxy` and sets **`storedRef`** on each file (also used by **`getStoredFilePath`** / **`getStoredFileUrl`**).
- CSV and text imports read uploaded files via **`uploadStorageService.readUploadedFileAsUtf8`** so gateway-backed uploads work after staging is removed.
- File Manager storage operations use **`uploadStorageService.fileManager.*`** (list, upload, move, rename, delete, create folder).
- HTTP **`GET /uploads/...`** in gateway mode never serves stale files from project `uploads/` or misconfigured roots first; it uses **`uploadStorageService.streamPublicUpload`** (redirect to public gateway URL by default).

## Remote mode rules (no local cache)

When **`uploadStoragePolicyService.preferRemoteUploadReads()`** is true (`railway_proxy` today; S3 later):

- Do **not** read upload bytes from `app.uploadsPath`, project `uploads/`, or `resolveExistingUploadDiskPath` before the gateway.
- Persist only **`/uploads/...` URLs** in Mongo/JSON (use **`coreUploadRefService.resolveMulterStoredRef`** or **`uploadStorageService.normalizeReference`** after upload).
- Do **not** store multer **`file.path`** disk paths as the durable reference.
- **`UPLOAD_REMOTE_READ_MODE=proxy`** buffers one response in memory (not disk); default **`redirect`** sends the browser to the gateway host.

Low-level gateway code may call **`allowLocalUploadFallback()`** before optional local reads; it is **false** in remote backends.

## Package usage

```js
const uploadStorage = requireCoreModule('MVC/services/uploadStorageService');
const saved = await uploadStorage.saveBuffer({ scopeKey, relativeDir, fileName, buffer, mimeType });
// Persist saved.url in Mongo/JSON only
```
