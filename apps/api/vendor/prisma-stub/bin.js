#!/usr/bin/env node
'use strict';

// Belmo/Coolify still injects `npx prisma generate` even though this API uses mysql2.
const [command, ...rest] = process.argv.slice(2);

if (command === 'generate') {
  console.log('[prisma-stub] Skipping prisma generate (app uses mysql2, not Prisma).');
  process.exit(0);
}

console.error(
  `[prisma-stub] Unsupported command: ${[command, ...rest].filter(Boolean).join(' ') || '(none)'}`,
);
process.exit(1);
