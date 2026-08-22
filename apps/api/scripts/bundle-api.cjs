const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const apiRoot = path.join(__dirname, '..');
const tscOut = path.join(apiRoot, '.tsc-out');
const publishDir = path.join(apiRoot, 'publish');
const tscEntry = path.join(tscOut, 'main.js');
const publishEntry = path.join(publishDir, 'main.js');

fs.rmSync(tscOut, { recursive: true, force: true });
fs.rmSync(publishDir, { recursive: true, force: true });
fs.mkdirSync(publishDir, { recursive: true });

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

esbuild
  .build({
    entryPoints: [tscEntry],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: publishEntry,
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
    fs.rmSync(tscOut, { recursive: true, force: true });
    fs.writeFileSync(
      path.join(publishDir, 'package.json'),
      JSON.stringify({ type: 'commonjs' }),
    );
    console.log('Hostinger bundle ready: publish/main.js');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
