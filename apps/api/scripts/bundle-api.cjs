const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..');
const tscOut = path.join(apiRoot, '.tsc-out');
const distDir = path.join(apiRoot, 'dist');
const publishDir = path.join(apiRoot, 'publish');
const tscEntry = path.join(tscOut, 'main.js');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

function writeBundleDir(dir, bundledFile) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(bundledFile, path.join(dir, 'main.js'));
  const assetsSrc = path.join(apiRoot, 'assets');
  if (fs.existsSync(assetsSrc)) {
    copyDir(assetsSrc, path.join(dir, 'assets'));
  }
  const dbSrc = path.join(apiRoot, 'db');
  if (fs.existsSync(dbSrc)) {
    copyDir(dbSrc, path.join(dir, 'db'));
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ type: 'commonjs' }),
  );
}

fs.rmSync(tscOut, { recursive: true, force: true });
fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(publishDir, { recursive: true, force: true });
fs.mkdirSync(tscOut, { recursive: true });

const tscBin = require.resolve('typescript/bin/tsc');
execFileSync(
  process.execPath,
  [
    tscBin,
    '-p',
    'tsconfig.build.json',
    '--noCheck',
    '--outDir',
    '.tsc-out',
    '--incremental',
    'false',
  ],
  { cwd: apiRoot, stdio: 'inherit' },
);

if (!fs.existsSync(tscEntry)) {
  console.error('bundle-api: TypeScript did not emit .tsc-out/main.js');
  process.exit(1);
}

const tmpBundle = path.join(tscOut, 'bundle.js');

esbuild
  .build({
    entryPoints: [tscEntry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: tmpBundle,
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
    writeBundleDir(distDir, tmpBundle);
    writeBundleDir(publishDir, tmpBundle);
    fs.rmSync(tscOut, { recursive: true, force: true });
    console.log('Hostinger bundle ready: dist/main.js');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
