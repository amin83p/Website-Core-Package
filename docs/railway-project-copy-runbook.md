# Railway Project Copy Runbook

Use this runbook when you want to copy the current Railway project into a new Railway project with:

- the same application code,
- similar MongoDB data,
- the same uploaded files from the Railway volume,
- a different public domain.

This is a production-style copy procedure. Do it during a quiet window so MongoDB and uploads do not change while the copy is running.

## 1. Decide the Copy Shape

Create these names before you start:

```text
SOURCE_PROJECT = current Railway project
TARGET_PROJECT = new Railway project
SOURCE_DOMAIN  = existing domain, for example https://aminpaknejad.com
TARGET_DOMAIN  = new domain, for example https://new-domain.com
SOURCE_DB       = source MongoDB database
TARGET_DB       = target MongoDB database
SOURCE_UPLOADS  = source upload volume path, usually /app/uploads on Railway
TARGET_UPLOADS  = target upload volume path, usually /app/uploads on Railway
```

Recommended isolation:

- Use a separate MongoDB database or MongoDB service for the target project.
- Use a separate Railway volume for the target project.
- Use separate Railway variables for target-specific URLs and secrets.
- Do not point the target app to the production MongoDB or production volume unless you intentionally want shared live data.

## 2. Prepare the Source Project

1. Pick a maintenance window.
2. Stop heavy user activity if possible.
3. Avoid uploading files during the copy.
4. Note the deployed Git branch/commit of the source service.
5. Note the source service start command/build settings.
6. Note the source volume mount path.
7. Note the source MongoDB variables:

```text
MONGODB_URI or MONGO_URI
MONGODB_DB or MONGO_DB, if used separately
DATA_BACKEND
```

8. Note upload-related settings:

```text
System Settings -> app.uploadsPath
UPLOAD_MODE
RAILWAY_GATEWAY_BASE_URL
FILE_GATEWAY_SHARED_KEY
FILE_GATEWAY_MAX_FILE_MB
APP_UPLOAD_MAX_FILE_MB
```

9. Note domain/email/auth variables that must change in the target:

```text
PUBLIC_APP_URL
WEBSITE_BASE_URL
APP_URL
BASE_URL
RESEND_API_KEY
RESEND_FROM_EMAIL
EMAIL_FROM
MICROSOFT_AUTH_ENABLED
MICROSOFT_TENANT_ID
MICROSOFT_AUTHORITY_TENANT
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_REDIRECT_URI
MICROSOFT_ALLOWED_DOMAIN
MICROSOFT_ENFORCE_TENANT
SESSION_SECRET
JWT_SECRET
```

Keep secrets out of Git. Do not copy `.env` into commits.

## 3. Create the Target Railway Project

1. In Railway, create a new project.
2. Add a new app service from the same GitHub repository.
3. Select the same branch or exact commit used by the source project.
4. Add a new MongoDB service, or configure a new external MongoDB database.
5. Add a new Railway volume to the target app service.
6. Mount the volume at the same path used by the app, usually:

```text
/app/uploads
```

7. If the source app uses `System Settings -> app.uploadsPath`, make sure the target setting points to the target volume path, usually `/app/uploads`.
8. Deploy once with a temporary target MongoDB, even if it has no data yet, just to confirm the app boots.

## 4. Copy Railway Variables

Copy variables from the source service to the target service, but update values that depend on the new project or domain.

Copy as-is if still valid:

```text
DATA_BACKEND=MONGO
SESSION_SECRET
JWT_SECRET
RESEND_API_KEY
MICROSOFT_TENANT_ID
MICROSOFT_AUTHORITY_TENANT
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_ALLOWED_DOMAIN
MICROSOFT_ENFORCE_TENANT
FILE_GATEWAY_SHARED_KEY
APP_UPLOAD_MAX_FILE_MB
FILE_GATEWAY_MAX_FILE_MB
```

Change for the target:

```text
MONGODB_URI or MONGO_URI              -> target MongoDB URI
MONGODB_DB or MONGO_DB                -> target database name, if separate
PUBLIC_APP_URL / WEBSITE_BASE_URL     -> TARGET_DOMAIN
APP_URL / BASE_URL                    -> TARGET_DOMAIN
MICROSOFT_REDIRECT_URI                -> TARGET_DOMAIN/auth/microsoft/callback
RAILWAY_GATEWAY_BASE_URL              -> target internal/public app URL if railway_proxy is used
RESEND_FROM_EMAIL / EMAIL_FROM        -> verified sender for the target domain, if changing sender domain
```

If you are testing only, consider disabling outbound email first:

```text
RESEND_API_KEY=
```

or use a test sender/domain until you confirm the clone is safe.

## 5. Copy MongoDB Data

Install MongoDB Database Tools on your workstation or use a temporary migration container that can reach both MongoDB URIs.

### Option A: source and target URI use the same database name

```powershell
$env:SOURCE_MONGODB_URI="mongodb+srv://SOURCE_USER:SOURCE_PASS@SOURCE_HOST/app"
$env:TARGET_MONGODB_URI="mongodb+srv://TARGET_USER:TARGET_PASS@TARGET_HOST/app"

mongodump --uri="$env:SOURCE_MONGODB_URI" --archive="railway-source-mongo.archive.gz" --gzip
mongorestore --uri="$env:TARGET_MONGODB_URI" --archive="railway-source-mongo.archive.gz" --gzip --drop
```

### Option B: source and target database names are different

Use namespace mapping:

```powershell
$env:SOURCE_MONGODB_URI="mongodb+srv://SOURCE_USER:SOURCE_PASS@SOURCE_HOST/sourceDb"
$env:TARGET_MONGODB_URI="mongodb+srv://TARGET_USER:TARGET_PASS@TARGET_HOST/targetDb"

mongodump --uri="$env:SOURCE_MONGODB_URI" --archive="railway-source-mongo.archive.gz" --gzip
mongorestore `
  --uri="$env:TARGET_MONGODB_URI" `
  --archive="railway-source-mongo.archive.gz" `
  --gzip `
  --drop `
  --nsFrom="sourceDb.*" `
  --nsTo="targetDb.*"
```

After restore, start the target app once so Mongo indexes are created/verified by the app boot process.

## 6. Optional: Clear Volatile Runtime Data

If the target is a staging/test copy, you usually do not want copied login sessions, reset codes, or active action-state tokens.

Recommended collections to clear only in the target database:

```text
sessions
passwordResetCodes
actionStates
```

Optional, depending on whether you want target reports to include copied email/activity history:

```text
emailLedger
activity logs collections
```

Do not clear business records unless you intentionally want a clean target.

## 7. Copy Railway Volume Uploads

Railway volume backups are useful for same-project recovery, but for a new project you need to move the upload files into the target volume.

The app expects public upload URLs like:

```text
/uploads/...
```

and physical files under:

```text
System Settings -> app.uploadsPath
```

On Railway this should usually be:

```text
/app/uploads
```

### Preferred cross-project method: tar archive

Use Railway shell/SSH or a temporary one-off migration service to create an archive from the source volume.

On the source service shell:

```bash
cd /app
tar -czf /tmp/uploads-copy.tgz uploads
ls -lh /tmp/uploads-copy.tgz
```

Download `/tmp/uploads-copy.tgz` from the source environment using your approved operational method.

Upload the archive to the target service, then on the target service shell:

```bash
cd /app
mkdir -p uploads
tar -xzf /tmp/uploads-copy.tgz -C /app
find uploads -type f | wc -l
```

If your Railway shell supports streaming remote commands, you can stream directly:

```bash
# From your workstation, source project selected:
railway ssh --service SOURCE_SERVICE "cd /app && tar -czf - uploads" > uploads-copy.tgz

# Then target project selected:
cat uploads-copy.tgz | railway ssh --service TARGET_SERVICE "cd /app && tar -xzf -"
```

If direct streaming is not supported in your Railway CLI version, use the manual archive transfer method.

### Fallback method: copy from a local upload mirror

If your local machine already has the complete `uploads` folder:

```powershell
Compress-Archive -Path ".\uploads\*" -DestinationPath ".\uploads-copy.zip" -Force
```

Then upload/extract it into the target Railway volume at `/app/uploads`.

### Verification

After copying files:

1. Open a question with saved media.
2. Click `View File`.
3. Open an attempt with uploaded audio.
4. Confirm audio/image URLs load from `/uploads/...`.
5. Confirm scorer can read uploaded audio artifacts.

## 8. Update Domain Settings

In Railway target project:

1. Add the new custom domain.
2. Update DNS records at your DNS provider.
3. Wait until Railway marks the domain as active.
4. Update target variables:

```text
PUBLIC_APP_URL=TARGET_DOMAIN
WEBSITE_BASE_URL=TARGET_DOMAIN
APP_URL=TARGET_DOMAIN
BASE_URL=TARGET_DOMAIN
MICROSOFT_REDIRECT_URI=TARGET_DOMAIN/auth/microsoft/callback
```

Use full URLs with protocol, for example:

```text
https://new-domain.com
```

## 9. Update Microsoft Entra

In Microsoft Entra app registration:

1. Go to Authentication.
2. Add a Web redirect URI:

```text
https://new-domain.com/auth/microsoft/callback
```

3. Keep the old redirect URI if the source project remains live.
4. Confirm Railway target variable:

```text
MICROSOFT_REDIRECT_URI=https://new-domain.com/auth/microsoft/callback
```

5. Test Microsoft login with an existing local user whose email matches the Microsoft account.

## 10. Update Resend

If the target uses a different sender domain:

1. Verify the new domain in Resend.
2. Update DNS records required by Resend.
3. Update templates in Email Management if sender templates use the old domain.
4. Confirm Railway target variables:

```text
RESEND_API_KEY=...
RESEND_FROM_EMAIL=support@new-domain.com
EMAIL_FROM=support@new-domain.com
```

If Email Management templates contain sender addresses, those template sender values override the generic sender in normal template-based sends.

## 11. App-Level Settings to Review After Mongo Restore

Because system settings are stored in MongoDB, copied settings may still reference the source environment.

Review these in the target app:

```text
System Settings -> app.uploadsPath
System Settings -> organization.pteJoinOrgId
System Settings -> organization.freeOrgId
Data Backend Settings
Email Management -> Email Templates
PTE AI API Providers
PTE Scoring Defaults
```

For the target Railway volume, confirm:

```text
app.uploadsPath=/app/uploads
```

## 12. Run Seed/Repair Scripts If Needed

If the target database was restored from source, sections and symbols should already exist.

Still, it is safe to run seed scripts if navigation items are missing:

```powershell
node scripts/seed-pte-sections.js
node scripts/seed-pte-symbols.js
node scripts/seed-activity-quota-sections.js
node scripts/seed-activity-quota-symbols.js
```

Also run any newer seed scripts introduced after the source snapshot was taken.

## 13. Smoke Test Checklist

Run these checks on the target domain:

- Login with username/password.
- Login with Microsoft.
- Open dashboard.
- Open PTE Questions Bank.
- Open a question with attached media.
- Search Questions Bank by transcript text.
- Search Questions Bank by media filename.
- Start PTE practice.
- Save a speaking response.
- Score a response that needs AI.
- Delete a practice attempt and confirm artifacts are removed from DB and upload volume.
- Send a password reset email.
- Open Email Ledger and confirm the email was logged.
- Confirm custom domain loads with HTTPS.

## 14. Cutover or Parallel Run

If the target project will replace the source:

1. Freeze source writes.
2. Repeat Mongo dump/restore.
3. Repeat upload volume copy.
4. Run smoke tests again.
5. Move DNS or public links to the target domain.
6. Keep the source project online but hidden for rollback until the target is stable.

If the target is a staging clone:

1. Keep the source project live.
2. Keep target email disabled or clearly marked as staging.
3. Do not share source and target MongoDB or upload volume.

## 15. Rollback

If the target fails:

1. Keep DNS pointed to the source domain.
2. Stop the target app service.
3. Do not delete the source project.
4. Keep the Mongo archive and upload archive until the target has passed smoke testing.

## References

- Railway project/services/deployments documentation: https://docs.railway.com/
- Railway variables documentation: https://docs.railway.com/guides/variables
- Railway volumes documentation: https://docs.railway.com/guides/volumes
- Railway custom domains documentation: https://docs.railway.com/guides/public-networking
- MongoDB Database Tools documentation: https://www.mongodb.com/docs/database-tools/
- MongoDB `mongodump` documentation: https://www.mongodb.com/docs/database-tools/mongodump/
- MongoDB `mongorestore` documentation: https://www.mongodb.com/docs/database-tools/mongorestore/
