/**
 * PM2 process config for the Hostinger VPS.
 * Runs the compiled NestJS API. The Vite SPA is served as static files by
 * Nginx (see deploy/nginx.conf.example), which also reverse-proxies /api.
 *
 * Usage on the VPS:
 *   npm ci
 *   npm run -w @designs-crm/api build
 *   pm2 start ecosystem.config.cjs   # API runs pending DB migrations on boot
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'designs-crm-api',
      cwd: './apps/api',
      script: 'dist/main.js',
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
