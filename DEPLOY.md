# Deploying Designs-CRM

## Vercel frontend + Hostinger backend: upload persistence

The API saves uploaded bytes to local disk via `LocalStorageService`; MySQL stores
file keys, not the image bytes. Vercel only hosts the frontend. Keeping the database
across deploys does not keep the files. A fresh Hostinger release or Docker container
can discard the old application directory, including git-ignored upload folders.
The bundle script preserves legacy `dist/uploads` and `publish/uploads` during an
in-place build only; it cannot preserve files removed by the hosting platform.

### Diagnose before deploying again

1. Open a broken image's request in browser DevTools > Network. The request should
   reach the Hostinger API at `/api/files/download`, not the Vercel SPA.
2. `File not found` means the API cannot locate the saved bytes. Use the request's
   `key` and check the backend disk and previous release/backup for that exact path.
   `Invalid or expired link` means the signature expired or its secret changed;
   reload the page to request fresh links and keep `STORAGE_URL_SECRET` stable.
   An HTML response from Vercel means the API URL is misconfigured.
3. After deploying this version, backend startup logs show `Upload storage directory:`
   and warn when production storage is relative to or inside the application.
   An absolute path alone is not proof of persistence: its backing disk must survive
   deployment replacement too.

### Hostinger managed Node.js hosting with GitHub auto-deploy

Hostinger documents that edits to deployed application files do not persist:
https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/

Confirm with Hostinger whether your plan offers a writable, persistent directory
outside the application release. If it does, use its supplied **absolute path** as
`UPLOAD_DIR` in the backend environment variables. Do not invent a `/var/lib` path
on managed hosting; it may not be available or persistent. If no persistent directory
is available, move uploads to external object storage (requires implementing a
storage adapter; the current API only supports local disk), or run this API on a VPS
with the persistent directory described below. Moving from `dist/uploads` to
`apps/api/uploads` within the same replaced release is insufficient.

### Hostinger VPS / PM2

Before the next deployment, back up and copy existing uploads to a location outside
the Git checkout. Run as the actual account that owns the API process (or have the
administrator create the directory and grant that account write access):

```bash
mkdir -p /var/lib/designs-crm/uploads
# Example for the default old location; preserve the complete key subdirectories.
# Also recover any files found in old dist/uploads, publish/uploads, or old releases.
# Resolve duplicate keys before combining sources; do not overwrite different files.
cp -an /var/www/designs-crm/apps/api/uploads/. /var/lib/designs-crm/uploads/
```

Set backend `UPLOAD_DIR=/var/lib/designs-crm/uploads` and a stable
`STORAGE_URL_SECRET` in its environment. Restart PM2 with `--update-env` if changing
process environment variables. Keep this directory outside every checkout cleanup,
release replacement and `rsync --delete` target; back it up alongside MySQL.
Preserve keys and subdirectories, so database records do not need to change.

For Docker on a VPS, set `UPLOAD_DIR=/data/uploads` and mount a named volume or host
directory at `/data/uploads` on **every** new container. Files in a container's writable
layer disappear when that container is replaced.

### Vercel settings and verification

Set `VITE_API_BASE_URL=https://<hostinger-api-domain>/api` in the Vercel project's
production environment and redeploy the frontend. Set `WEB_ORIGIN` on the backend
to the frontend origin. `VITE_API_BASE_URL` is compiled into the frontend, so setting
it only in the backend environment does not configure Vercel.

Upload a test image, record its key, deploy a harmless code change, reload the page
to get a fresh signed URL, and verify the original image bytes are still served.
Already-deleted files must be recovered from a file backup/old release or uploaded
again; database rows and URL fixes cannot recreate missing image bytes.

## Hostinger VPS setup

Stack: **Vite React SPA** (static) + **NestJS API** (Node/PM2) + **MySQL** (managed via phpMyAdmin). No ORM, no Supabase.

## 1. Prerequisites on the VPS
- Node.js 22+ and npm
- MySQL (create a database + user via phpMyAdmin)
- Nginx
- PM2: `npm i -g pm2`

## 2. Get the code
```bash
git clone <your-repo> /var/www/designs-crm
cd /var/www/designs-crm
npm ci
```

## 3. Configure environment
Create `apps/api/.env` (see `apps/api/.env.example`):
```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_mysql_user
DB_PASSWORD=your_mysql_password
DB_NAME=designs_crm
WEB_ORIGIN=https://your-domain.com
JWT_ACCESS_SECRET=<32+ random chars>
JWT_REFRESH_SECRET=<32+ random chars>
COOKIE_SECURE=true
UPLOAD_DIR=/var/lib/designs-crm/uploads
STORAGE_URL_SECRET=<32+ random chars>
VITE_API_BASE_URL=https://your-domain.com/api
```

## 4. Database schema
The API applies `apps/api/db/schema.sql` and any unused files in `apps/api/db/migrations` **automatically on startup**. You do not need a separate migrate step after deploy.

Optional first-time setup:
```bash
npm run db:migrate     # same runner, if you want to prepare the DB before start
npm run db:seed        # optional: SEED_ADMIN + Sara portal sample
```
…or paste `apps/api/db/schema.sql` into **phpMyAdmin** (SQL tab) against your database.

## 5. Build
```bash
npm run -w @designs-crm/api build     # -> apps/api/dist
npm run -w @designs-crm/web build     # -> apps/web/dist (static SPA)
```

## 6. Run the API with PM2
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup      # follow the printed command to enable on boot
```
The API listens on `PORT` (default 3001) bound to localhost; Nginx proxies to it.

## 7. Nginx
Copy `deploy/nginx.conf.example` to `/etc/nginx/sites-available/designs-crm`, edit
`server_name` and the `root` path, then:
```bash
ln -s /etc/nginx/sites-available/designs-crm /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your-domain.com     # HTTPS (recommended; set COOKIE_SECURE=true)
```

## 8. Updating
```bash
git pull
npm ci
npm run -w @designs-crm/api build
npm run -w @designs-crm/web build
pm2 restart designs-crm-api   # migrations run automatically on API start
```

## Notes
- Uploaded files live on disk under `UPLOAD_DIR`. Relative paths resolve from the API package root; the default is `apps/api/uploads`. Production must use persistent storage outside the deployment directory (or a Docker volume). The build preserves legacy `dist/uploads` and `publish/uploads` during an in-place rebuild, but replacing the whole release still loses them. Back uploads up; they are git-ignored.
- Downloads use short-lived HMAC-signed URLs (`/api/files/download`), signed with `STORAGE_URL_SECRET` (falls back to `JWT_ACCESS_SECRET`).
- With the SPA and API on the same domain via Nginx, auth cookies are first-party; keep `COOKIE_SECURE=true` under HTTPS.
