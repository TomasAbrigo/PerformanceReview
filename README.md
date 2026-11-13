# Performance Review

Herramienta interna de evaluaciones de desempeño que reemplaza el módulo de performance de BambooHR. Los datos se ingestan desde Bamboo conservando sus IDs de origen.

**Stack:** Next.js (App Router, TypeScript estricto, Tailwind v4, shadcn/ui) · next-intl (`es` por defecto, `en`) · Supabase local · Drizzle ORM (postgres-js) · Vitest · Playwright.

> Solo desarrollo local. No hay deploy configurado.

## Requisitos

- Node 24 y pnpm
- Docker corriendo
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Cómo correrlo

```bash
pnpm install
cp .env.example .env.local   # completar la anon key con la salida de `supabase status`
supabase start               # levanta Postgres, Auth, Studio, etc. en Docker
pnpm db:migrate              # aplica las migraciones de Drizzle (carpeta drizzle/)
pnpm dev                     # http://localhost:3000 -> redirige a /es
```

Para apagar la base: `supabase stop`. Para recrearla desde cero: `pnpm db:reset` y luego `pnpm db:migrate`.

## Tests y calidad

```bash
pnpm test:unit   # Vitest (jsdom) — *.test.ts(x)
pnpm test:db     # Vitest (node) contra DATABASE_URL — *.db.test.ts (requiere supabase start)
pnpm test:e2e    # Playwright (levanta next dev en :3100); la primera vez: pnpm exec playwright install chromium
pnpm test        # unit + db
pnpm typecheck
pnpm lint
pnpm format      # Prettier
```

## Base de datos

- Esquema de Drizzle: `src/db/schema/*.ts`. Migraciones generadas en `drizzle/` (`pnpm db:generate`, `pnpm db:migrate`).
- `supabase/migrations/` queda reservado para SQL específico de Supabase (RLS, extensiones, funciones).
- `pnpm db:studio` abre Drizzle Studio.

## Puertos (Supabase local)

Se usan puertos propios para no chocar con otros proyectos locales.

| Servicio         | Puerto |
| ---------------- | ------ |
| API              | 55321  |
| Postgres         | 55322  |
| Studio           | 55323  |
| Inbucket         | 55324  |
| Shadow DB        | 55320  |
| Analytics        | 55327  |
| Pooler (apagado) | 55329  |
| Next.js (dev)    | 3000   |
| Next.js (e2e)    | 3100   |

Conexión local: `postgresql://postgres:postgres@127.0.0.1:55322/postgres`.

## Idiomas

Rutas bajo `/[locale]` (`/es`, `/en`). Los textos viven en `src/messages/{es,en}.json`; ambos archivos deben tener las mismas claves (hay un test que lo verifica).
