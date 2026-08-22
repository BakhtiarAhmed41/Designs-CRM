const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..');
const distDir = path.join(apiRoot, 'dist');
const entry = path.join(distDir, 'main.js');
const tmpOut = path.join(apiRoot, '.hostinger-main.js');

if (!fs.existsSync(entry)) {
  console.error('bundle-api: dist/main.js is missing');
  process.exit(1);
}

esbuild
  .build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: tmpOut,
    allowOverwrite: true,
    logLevel: 'info',
    // Optional Nest peers we do not use. Left external so the bundle still builds.
    external: [
      'class-validator',
      'class-transformer',
      '@nestjs/microservices',
      '@nestjs/microservices/microservices-module',
    ],
  })
  .then(() => {
    for (const name of fs.readdirSync(distDir)) {
      fs.rmSync(path.join(distDir, name), { recursive: true, force: true });
    }
    fs.renameSync(tmpOut, path.join(distDir, 'main.js'));
    const sizeMb = (fs.statSync(path.join(distDir, 'main.js')).size / 1024 / 1024).toFixed(1);
    console.log(`Hostinger bundle ready: dist/main.js (${sizeMb} MB)`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
