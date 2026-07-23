/**
 * PM2 process config for the Hostinger VPS.
 * Runs the compiled NestJS API. The Vite SPA is served as static files by
 * Nginx (see deploy/nginx.conf.example), which also reverse-proxies /api.
 *
 * Usage on the VPS:
 *   npm ci
 *   npm run -w @designs-crm/api build
 *   npm run db:migrate            # or import apps/api/db/schema.sql via phpMyAdmin
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'designs-crm-api',
      cwd: './apps/api',
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '400M',
      autorestart: true,
    },
  ],
};
