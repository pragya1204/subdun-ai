# subdun-ai

AI Revenue Recovery System — given failed subscription payments (Razorpay-shaped events from a
simulator, not a live provider), an LLM-backed Agent proposes one recovery action at a time
(wait, retry, request outreach, etc.), a Policy Engine validates it against category-specific
guardrails, and an Orchestrator executes and tracks the case through to a terminal outcome
(recovered / escalated / exhausted / stopped).

Design docs: [docs/AI_Revenue_Recovery_System_Architecture.md](docs/AI_Revenue_Recovery_System_Architecture.md)
(system architecture) and [docs/AI_Revenue_Recovery_Technical_Design_Phase3.md](docs/AI_Revenue_Recovery_Technical_Design_Phase3.md)
(technical design).

## Stack

pnpm workspace with three packages:

- `apps/api` — Express backend (11 modules under `apps/api/src/`)
- `apps/web` — Vite + React control surface
- `packages/shared` — types shared across api/web

## Prerequisites

- Node.js >= 20
- pnpm
- Docker (for local Postgres)

## Setup

1. Start local Postgres:

   ```bash
   docker compose up -d
   ```

2. Copy the API env file and fill in `GEMINI_API_KEY`:

   ```bash
   cp apps/api/.env.example apps/api/.env
   ```

3. Install dependencies:

   ```bash
   pnpm install
   ```

4. Apply database migrations:

   ```bash
   pnpm db:migrate
   ```

Without `GEMINI_API_KEY` set, the Agent call always fails and every evaluation cycle falls back
to the deterministic `fallbackProposal` (logged as `AGENT_UNAVAILABLE` in the audit trail) — the
rest of the system (Policy, Orchestrator, Execution, Audit) still runs for real.

## Running

```bash
pnpm dev:api    # apps/api on :4000 (tsx watch)
pnpm dev:web    # apps/web on :5173 (Vite, proxies /api -> :4000)
```

## Testing

Tests run against a separate `recovery_test` database (`apps/api/.env.test`) so `pnpm test`
never touches dev data. Create it once and migrate it:

```bash
docker exec <postgres-container> createdb -U recovery recovery_test
DATABASE_URL=postgres://recovery:recovery@localhost:5432/recovery_test pnpm --filter @recovery/api db:migrate
```

Then run the suite:

```bash
pnpm test
```

## Other commands

```bash
pnpm typecheck    # shared + api + web
pnpm build        # shared + api + web
pnpm db:generate  # generate Drizzle migrations from schema changes
```
