# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository state

The MVP is implemented per the locked design docs in `docs/`:

- `docs/AI_Revenue_Recovery_System_Architecture.md` — locked system architecture (Phase 2): components, data ownership, state machine, sequences, invariants.
- `docs/AI_Revenue_Recovery_Technical_Design_Phase3.md` — locked technical design (Phase 3): tech stack, repo layout, DB schema, API/event contracts, module implementations, test strategy, build plan.

pnpm workspace: `apps/api` (Express backend, 11 modules under `apps/api/src/`), `apps/web` (Vite + React control surface), `packages/shared` (types shared across api/web).

### Commands

```
docker compose up -d          # local Postgres (recovery / recovery user+db)
cp apps/api/.env.example apps/api/.env   # fill in GEMINI_API_KEY to enable the live Agent call
pnpm install
pnpm db:migrate                # apply Drizzle migrations (apps/api/src/db/migrations)
pnpm dev:api                   # apps/api on :4000 (tsx watch)
pnpm dev:web                   # apps/web on :5173 (Vite, proxies /api -> :4000)
pnpm test                      # apps/api unit + integration tests (Vitest, needs recovery_test DB — see below)
pnpm typecheck                 # shared + api + web
pnpm build                     # shared + api + web
```

Tests run against a separate `recovery_test` database (`apps/api/.env.test`) so `pnpm test` never touches dev data:

```
docker exec <postgres-container> createdb -U recovery recovery_test
DATABASE_URL=postgres://recovery:recovery@localhost:5432/recovery_test pnpm --filter @recovery/api db:migrate
```

Without `GEMINI_API_KEY` set, the Agent call always fails and every evaluation cycle uses the deterministic
`fallbackProposal` (logged as `AGENT_UNAVAILABLE` in the audit trail) — the rest of the system (Policy, Orchestrator,
Execution, Audit) still runs for real. This is intentional and is what the integration test suite runs against.

## What this project is

An **AI Revenue Recovery System**: given failed subscription payments (Razorpay-shaped events from a simulator, not a live provider), an LLM-backed Agent proposes one recovery action at a time (wait, retry, request outreach, etc.), a Policy Engine validates it against category-specific guardrails, and an Orchestrator executes and tracks the case through to a terminal outcome (recovered / escalated / exhausted / stopped). Everything is captured in an append-only audit trail that a Recovery Case read model projects from.

This is a 2-week, one-developer MVP — a **modular monolith**, not microservices. Both design docs treat scope aggressively: anything not needed for the demo is explicitly called out as deliberately not built.

## Architectural invariants (do not violate these when writing code)

These are listed in full in `docs/AI_Revenue_Recovery_System_Architecture.md` §15.G — treat them as hard constraints when implementing any module:

1. **Agent proposes; it never authorizes or executes.** The Agent is a single stateless function call (`proposeNextOperation`) — no loop, no tools, no memory across calls, no direct writes.
2. **Policy is the only authority on what's allowed; it never picks an alternative.** It returns `{allowed, reason}` only — rejection-handling/fallback logic lives in the Orchestrator, not Policy.
3. **Orchestrator is the only authority on workflow execution and Recovery Case status transitions.** No other module writes `recovery_cases.status`.
4. **Audit Trail is the append-only source of truth; Recovery Case is always a derived projection of it**, updated in the same DB transaction as the audit append (`append_audit_event()` → `project()`, one chokepoint).
5. **The Simulator is the only component that knows it isn't talking to a real provider** — everything else depends on an abstract `ProviderPort` interface, making the provider boundary swappable without touching Orchestrator/Policy/Agent/Audit.
6. **At most one open Recovery Case per subscription** — enforced at the DB level via a partial unique index (`recovery_cases (subscription_id) WHERE status NOT IN (terminal)`), not just application logic. A second failure on an open case appends to it (`FAILURE_APPENDED`), sharing its budget/deadline.
7. **Every state-changing operation is idempotent**, keyed by `action_id` (executions) or `event_id` (ingestion).
8. **Every autonomous workflow path terminates** in one of `RECOVERED / ESCALATED / EXHAUSTED / STOPPED`.
9. **No action reaches the Simulator without passing Policy first.**
10. **`ESCALATE`/`STOP` are always on every category's allow-list**, appended at policy-lookup time rather than stored per-category.
11. **The Agent never sees card credentials or raw customer contact details** — only opaque IDs, normalized categories, amounts, timestamps, and recovery history.
12. Per-case concurrency is handled by a **row-level lock** (`SELECT ... FOR UPDATE`) held for one full evaluation cycle — not optimistic versioning, not a distributed lock.

## Core architecture (11 modules, one deployable)

Per `docs/AI_Revenue_Recovery_Technical_Design_Phase3.md` §3/§4, each Phase 2 component maps 1:1 to a directory under `apps/api/src/`:

`intake/` (dedup + normalize routing) → `normalizer/` (pure error→category mapping) → `context/` (fresh `AgentContext` assembly, never cached) → `agent/` (single Gemini call) → `policy/` (pure guardrail validation) → `orchestrator/` (state machine authority: `evaluate()`, `sweepDueActions()`, `sweepExhaustion()`) → `execution/` (dispatch approved ops) → `interaction/` (outreach / payment-method-update / customer-action sends — merged because they share one budget/cooldown) → `simulator/` (the only `ProviderPort` implementation) → `audit/` (append-only writer + `project.ts` projector sub-routine — intentionally not an independent module) → `evaluation/` (read-only metrics, cannot write anywhere).

The planned repo layout is a pnpm workspace: `apps/api` (backend above), `apps/web` (React control surface — Vite + TanStack Query polling, Tailwind), `packages/shared` (types shared across api/web/simulator). The frontend only imports `packages/shared` and the API route layer's response shapes — never `orchestrator/` or `db/` directly.

## Recovery state machine

11 states: `FAILED, EVALUATING, WAITING, RETRYING, OUTREACH_PENDING, PAYMENT_METHOD_UPDATE_PENDING, CUSTOMER_ACTION_PENDING, RECOVERED, ESCALATED, EXHAUSTED, STOPPED`. Full transition table and diagram: `docs/AI_Revenue_Recovery_System_Architecture.md` §4. Key points to remember when touching orchestration code:

- `payment.success` always short-circuits to `RECOVERED` regardless of what's currently pending.
- A complaint forces `ESCALATED` immediately, checked before the Agent is even asked.
- Retry/outreach budgets (2 retries, 3 outreach) remove the corresponding primitive from the allow-list once exhausted, but `ESCALATE`/`STOP` remain available.
- The Day-14 sweep proactively force-transitions any non-terminal case past its deadline to `EXHAUSTED`; any pending `due_actions` for that case become no-ops.

## Data model notes

Full schema: `docs/AI_Revenue_Recovery_Technical_Design_Phase3.md` §5 (8 tables: `subscriptions`, `payments`, `recovery_cases`, `recovery_actions`, `audit_events`, `outreach`, `due_actions`, `ingested_events`). Points that matter for correctness:

- `payments` rows are immutable — a retry always inserts a new row, never updates.
- `audit_events` is append-only enforced at both the application layer (single writer function) and the DB grant layer (no `UPDATE`/`DELETE` grant for the app role).
- `due_actions` is purely ephemeral scheduling state; the durable record is the `ACTION_SCHEDULED` audit event, not this table.
- Subscription History is deliberately **not** a stored table — compute-on-read from `payments` + `recovery_cases`.
- Monetary amounts are integers in minor units (paise); all timestamps are `timestamptz`.

## Technology choices (already decided — do not re-litigate without reason)

Node.js/TypeScript, Express (thin, ~7 endpoints), PostgreSQL via Docker Compose, Drizzle ORM (chosen specifically because it treats raw `FOR UPDATE` SQL as first-class — Prisma was rejected for fighting this), Zod (API validation + Agent structured-output validation), plain `@google/genai` SDK call against `gemini-2.5-flash` with schema-constrained JSON output (explicitly **no agent framework** — LangGraph was evaluated and rejected because the Agent is a single bounded call with no loop/tools/state, and adopting a graph framework would fight invariant #1/#3 above), `setInterval` pollers for scheduling (no `node-cron`, no workflow engine), Vitest + Supertest, Vite + React + TanStack Query (polling, not WebSockets) + Tailwind, pnpm workspaces (no Turborepo/Nx). Full rationale table: `docs/AI_Revenue_Recovery_Technical_Design_Phase3.md` §1–§2.

Explicitly rejected as scope creep (§15.M of the Phase 3 doc): LangGraph, Kafka/any message broker, Kubernetes, Temporal/Airflow, microservices, Prisma, SQLite, node-cron, Next.js, WebSockets/SSE, Turborepo/Nx, real auth system, TypeORM/Sequelize, GraphQL, Redis.
