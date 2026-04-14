# Designs CRM (Phase 1)

Monorepo:
- `apps/web`: Next.js (TypeScript)
- `apps/api`: NestJS + Prisma (Supabase Postgres)

## Prereqs
- Node.js + npm
- Supabase Postgres connection string

## Setup
1. Copy env templates:
   - `apps/api/.env.example` → `apps/api/.env`
   - `apps/web/.env.local.example` → `apps/web/.env.local`
2. Install deps (workspace root):
   - `npm install`
3. Run migrations (from root):
   - `npm run prisma:migrate:dev`
4. Start API + Web:
   - API: `npm run dev:api`
   - Web: `npm run dev:web`

