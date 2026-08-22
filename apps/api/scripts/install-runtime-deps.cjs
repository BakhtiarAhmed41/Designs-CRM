const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = path.join(__dirname, '..');
const onHostinger =
  cwd.includes('hbuilds') ||
  cwd.includes('hostinger') ||
  process.env.HOSTINGER === '1';

if (!onHostinger) {
  process.exit(0);
}

console.log('Hostinger: installing runtime packages next to the API build');
execSync(
  'npm install --omit=dev --no-workspaces --install-strategy=nested --ignore-scripts',
  {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_workspaces: 'false',
      npm_config_production: 'true',
    },
  },
);

const nestCore = path.join(cwd, 'node_modules', '@nestjs', 'core');
if (!fs.existsSync(nestCore)) {
  console.error('Runtime install failed: @nestjs/core is missing at', nestCore);
  process.exit(1);
}
