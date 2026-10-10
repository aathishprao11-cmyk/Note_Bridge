# Team workflow (two laptops, GitHub)

Two people build this through GitHub. Each laptop owns a set of folders and never edits the other's.

## Ownership

### Laptop A (Engine) owns

- `packages/core/**`
- `eval/**`
- `samples/**`
- `apps/server/src/db/**`
- `apps/server/src/jobs/**`
- `apps/server/src/routes/**` (all routes, including alignment)
- `apps/server/src/app.ts`, `apps/server/src/seed.ts`
- `packages/features/problem-finder/**`
- `packages/features/handwriting-repair/**`

### Laptop B (Experience) owns

- `apps/web/**`
- `apps/server/src/agent/**`
- `apps/server/src/sandbox/**`
- `packages/features/*` except `problem-finder` and `handwriting-repair`

### Shared files (change rarely, announce first)

- root `package.json`
- `pnpm-lock.yaml`
- tsconfig files (`tsconfig.base.json` and per-package `tsconfig.json`)
- `.env.example`
- `packages/core/src/api-contract.ts`
- `packages/core/src/types.ts`
- `.github/CODEOWNERS`

`api-contract.ts` and `types.ts` sit inside `packages/core/**`, which Laptop A owns. Because they are
shared, Laptop B asks for changes through `docs/CONTRACT_REQUESTS.md` and Laptop A applies them (or
both agree in a PR). Everything in `docs/**` and `.github/**` not listed above: either laptop may
edit, and says so in the commit message.

## Rules

1. **Never edit a file the other person owns.** If you need a change there, write it in
   `docs/CONTRACT_REQUESTS.md` and let the owner make it.
2. **Always run `git pull --rebase origin main`** before starting work and before pushing.
3. Commit messages use Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).
4. Run `pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` before pushing.
5. Never commit `.env` or any key. Real keys live only in each person's local `.env` (git-ignored).
6. A feature package never imports another feature package. It talks to core through `PluginContext`.
7. When you change a shared file, say so in the commit message and tell the other person.

### Migrations

Migrations are append-only and numbered; never edit an applied migration, add a new one.
`apps/server/src/db/**` is Laptop A's, so Laptop B asks for schema changes in
`docs/CONTRACT_REQUESTS.md`.

### Lockfile conflicts

If `pnpm-lock.yaml` conflicts while rebasing: take `origin/main`'s version
(`git checkout origin/main -- pnpm-lock.yaml`), run `pnpm install`, and commit the result.

## Building against the frozen contract (Laptop B)

You do not need the engine to build every screen:

```bash
pnpm install
pnpm seed            # loads the demo course into ./data/gyan.db (idempotent; --reset to restore)
pnpm dev             # server :3001, web :5173
```

- Request/response shapes: `packages/core/src/api-contract.ts` (zod) and `docs/API.md`.
- Entity types: `packages/core/src/types.ts`. Import both from `@gyan/core`.
- Demo data: `packages/core/src/fixtures/*.json` (do not edit; ask in `CONTRACT_REQUESTS.md`).
- Stub routes read the seeded database and validate every response against the contract, so what
  you see is exactly what the real engine will return. `PATCH /api/edges/:id` really saves edits.

## First-time setup on the other laptop

```bash
git clone https://github.com/aathishprao11-cmyk/Note_Bridge.git
cd Note_Bridge
node -v            # 22 or newer
npm i -g pnpm      # or: corepack enable
pnpm install
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
pnpm test
pnpm seed
pnpm dev                 # server :3001, web :5173
```

With no key in `.env`, everything runs on `LLM_PROVIDER=mock`. Tests and CI always use the mock
LLM and mock embeddings, so nothing downloads a model.
