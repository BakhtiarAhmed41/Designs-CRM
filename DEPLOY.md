# Deploying Designs-CRM to a Hostinger VPS

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
UPLOAD_DIR=/var/www/designs-crm/uploads
STORAGE_URL_SECRET=<32+ random chars>
```
Create `apps/web/.env.local`:
```
VITE_API_BASE_URL=https://your-domain.com/api
```

## 4. Database schema
Either run the migration runner:
```bash
npm run db:migrate     # applies apps/api/db/schema.sql (idempotent)
npm run db:seed        # optional: sample team/customers/orders
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
npm run db:migrate      # applies any new .sql files in apps/api/db/migrations
pm2 restart designs-crm-api
```

## Notes
- Uploaded files live on disk under `UPLOAD_DIR` (default `apps/api/uploads`). Back this directory up; it is git-ignored.
- Downloads use short-lived HMAC-signed URLs (`/api/files/download`), signed with `STORAGE_URL_SECRET` (falls back to `JWT_ACCESS_SECRET`).
- With the SPA and API on the same domain via Nginx, auth cookies are first-party; keep `COOKIE_SECURE=true` under HTTPS.
