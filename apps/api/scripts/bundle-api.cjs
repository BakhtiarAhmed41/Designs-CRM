const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..');
const distDir = path.join(apiRoot, 'dist');
const entry = path.join(distDir, 'main.js');
const tmpOut = path.join(distDir, 'main.bundle.js');

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
    logLevel: 'error',
    legalComments: 'none',
    external: [
      'class-validator',
      'class-transformer',
      '@nestjs/microservices',
      '@nestjs/microservices/microservices-module',
    ],
  })
  .then(() => {
    fs.rmSync(entry, { force: true });
    fs.renameSync(tmpOut, entry);
    fs.writeFileSync(
      path.join(distDir, 'package.json'),
      JSON.stringify({ type: 'commonjs' }),
    );
    console.log('Hostinger bundle ready: dist/main.js');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
