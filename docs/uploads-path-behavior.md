# Upload Path Behavior (Local vs Railway)

- File writes and reads for uploaded assets use `System Settings -> app.uploadsPath`.
- Public URLs remain `/uploads/...`; only physical storage path changes.
- On Railway, persistent storage is used only when `app.uploadsPath` points to the mounted volume path (for example, `/app/uploads`).
- On local development machines, uploads are written to local disk using the configured path (typically `uploads` at project root).
- `UPLOAD_MODE=railway_proxy` lets local uploads/deletes mirror to Railway through internal gateway endpoints.
- Proxy mode requires:
  - `RAILWAY_GATEWAY_BASE_URL`
  - `FILE_GATEWAY_SHARED_KEY`
