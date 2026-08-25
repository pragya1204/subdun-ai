# AI Revenue Recovery — Technical Design & Implementation Specification (Phase 3)

*Implements the approved Phase 2 architecture without changing it. One developer, two weeks. Every technology choice is justified against that constraint — nothing is picked for being popular.*

---

## 1. Technology Stack Selection

| Layer | Chosen | Responsibility | Why it fits this MVP | Simpler alternative considered | Why chosen is preferable | Required/Optional |
|---|---|---|---|---|---|---|
| Backend runtime | Node.js + TypeScript (`tsx` for dev) | Runs the Orchestrator/Agent/Policy/Simulator in one process | Matches the fixed TS constraint; `tsx` gives instant hot-reload with zero build step during dev | Deno / Bun | Node has the widest ecosystem overlap with every other pick below (Drizzle, Vitest, Express) — no reason to introduce a newer runtime for a 2-week build | Required |
| API framework | Express | Thin REST layer (~7 endpoints) | The API surface is intentionally tiny (§6) — a heavier framework buys nothing | Fastify, NestJS | NestJS's DI/module ceremony fights the "don't create unnecessary abstractions" instruction directly; Fastify's gains (schema-first validation, speed) don't matter at 7 endpoints | Required |
| Database | PostgreSQL | Durable store for all 8 tables (§5) | Natively provides `SELECT ... FOR UPDATE`, which is the exact per-case locking mechanism the Phase 2 architecture already names (§7) | SQLite | SQLite's single-writer behavior would *accidentally* approximate the required serialization instead of *deliberately implementing* it — for a system whose core selling point is auditable, explicit guardrails, the lock should be a real, testable line of code, not a side effect of the file format | Required |
| Local Postgres | Docker Compose (one file, one command) | `docker compose up` gives a disposable local DB | Zero manual install, matches whatever's deployed | Local Postgres install | Compose is one file checked into the repo; nothing to configure per-machine | Required |
| ORM / query layer | Drizzle | Typed schema, migrations, typed queries, first-class raw SQL | Raw `FOR UPDATE` transactions are core to this system, not an edge case — Drizzle treats raw SQL as a first-class citizen instead of an escape hatch | Prisma | Prisma's DX is excellent for CRUD-shaped apps, but its query builder actively resists the exact pattern (`SELECT ... FOR UPDATE` inside a hand-controlled transaction) this system depends on | Required |
| Schema validation | Zod | Validates API requests, event payloads, **and** Agent structured output | One library, three uses (API/events/Agent) — no reason to introduce a second validator | io-ts, Yup | Zod has the best TypeScript inference and is already the de facto standard for structured-LLM-output validation | Required |
| Agent framework | None (plain SDK call) | See §2 — full analysis below | — | — | — | Required |
| LLM provider | Google Gemini 2.5 Flash | Single structured decision per evaluation | Low latency and cost matter more than raw capability for a bounded, one-shot classification-and-recommendation task; Flash's controllable "thinking budget" can be set near zero for this task, keeping re-evaluation cycles cheap and fast | Gemini 2.5 Pro | Pro's extra reasoning depth isn't earned back on a task that's really "pick 1 of 7 primitives + a one-sentence reason" — Flash is sufficient and meaningfully cheaper/faster at MVP call volumes | Required |
| Structured output | Gemini native JSON-schema response (`responseMimeType: "application/json"` + `responseSchema`) + Zod `.parse()` as a second check | Guarantees schema-shaped Agent output | The `@google/genai` SDK accepts a JSON Schema (or a Zod schema converted to one) directly in the request config, so the model is constrained at generation time; Zod is a deterministic backstop that catches anything that still slips through | Free-form prompting for JSON + manual `JSON.parse` | Schema-constrained generation is far more reliable than prompting for JSON and hoping; Zod as a second gate costs nothing and gives Policy something it can trust | Required |
| Scheduling/timers | Plain `setInterval` in-process poller | Drives the `due_actions` sweep and the Day-14 sweep (§10) | The architecture already specifies "a lightweight poller" — `setInterval` *is* that, with zero dependencies | `node-cron` | Cron syntax buys nothing when the interval is always "every N seconds"; one fewer dependency | Required |
| Testing | Vitest | Unit + integration tests (§13) | TS-native, near-zero config, fast enough to run the full suite on every save | Jest | Jest needs extra TS transform config; Vitest is a drop-in with less setup | Required |
| API integration testing | Supertest | Hits the Express app in-process for integration tests | Standard pairing with Express; no server needs to actually bind a port during tests | Running a real server + fetch | Faster, no port conflicts, no flakiness from network timing | Required |
| Frontend build tool | Vite | Dev server + build for the React control surface | Fastest TS+React dev loop available; zero-config for this scale | Next.js | Next.js's routing/SSR/server-components machinery solves problems this single-page demo tool doesn't have | Required |
| Frontend data fetching | TanStack Query | Polling-based "live" updates on case list/detail | Polling every few seconds is sufficient to look live in a demo; TanStack Query makes polling + caching trivial | WebSockets/SSE | A push channel is real infrastructure for a problem polling solves adequately at this scale | Required |
| Styling | Tailwind CSS | Utility-class styling, no design system to maintain | Fastest way to make 4 screens look presentable with no component library learning curve | Component library (MUI/Chakra) | This is an internal control surface, not a customer product — a component library's theming/setup cost isn't earned back | Required |
| Monorepo tooling | pnpm workspaces | Share types between `apps/api`, `apps/web`, and the simulator | Built into pnpm — zero extra tool | Turborepo / Nx | Two apps and one shared package don't need a build-orchestration layer; that's solving a scaling problem this MVP doesn't have | Required |
| Deployment | One container (Express serves the built React static files too) → any single-container PaaS (e.g. Railway or Render) + managed Postgres | One deployable unit, one deploy target | Matches the modular-monolith decision all the way down to deployment topology | Separate frontend/backend hosts | Two deploy targets for a 2-week MVP is an unforced coordination cost | Optional (local demo is sufficient for the buildathon; deploy only if time remains) |

---

## 2. Agent Framework Decision (LangGraph vs. alternatives)

**The architectural rule that decides this:** the Orchestrator owns the workflow; the Agent owns exactly one bounded decision per call, with no memory, no loop, and no tools of its own.

| Approach | What it's designed for | Fit here |
|---|---|---|
| **LangGraph** | Multi-step, cyclic, stateful agent workflows — planning loops, tool-calling chains, multi-agent handoffs | **Poor fit.** This Agent has no loop, no tools, and no state across calls. Adopting LangGraph means bringing in a graph/state abstraction to model something that is, by design, a single function call. The real risk isn't performance — it's architectural: a graph framework naturally wants to *own* state and control flow, which is exactly the responsibility Phase 2 reserves for the Orchestrator. Every safeguard listed in the brief (must not own Recovery Case state, must not execute retries, must not bypass Policy) is a symptom of forcing a multi-step framework into a single-step role. |
| **Vercel AI SDK (`generateObject`)** | Single structured-output calls, provider-agnostic | Reasonable. `@ai-sdk/google` supports Gemini, so this is available if wanted. Thinner than a raw SDK call, still single-shot. |
| **Plain structured LLM call** (`@google/genai` SDK, schema-constrained JSON, Zod-validated) | Exactly one call in, one validated object out | **Best fit.** Zero framework surface area to misuse. The entire "Agent" is one exported async function. It is architecturally impossible for it to accidentally become a competing state machine, because there is no state or graph for it to hold. |

**Final recommendation: do not use LangGraph. Implement the Agent as a single function** — `proposeNextOperation(context: AgentContext): Promise<AgentProposal>` — using the `@google/genai` TypeScript SDK against `gemini-2.5-flash`, with the response constrained by a JSON schema (`responseSchema`), validated a second time with Zod before it's handed to Policy. Thinking should be set to a low/zero budget — this task needs a fast classification-and-pick, not extended reasoning, and every extra second here is latency added to every re-evaluation cycle. (Vercel AI SDK's `generateObject` via `@ai-sdk/google` is an acceptable lighter-boilerplate substitute for the same pattern if preferred; it changes nothing architecturally.)

If a future phase genuinely needs multi-step tool-calling (not part of this MVP), the four constraints from the brief still apply: any such framework would live *entirely inside* the Agent module, never touch Recovery Case writes, never call the Simulator directly, and never skip Policy.

---

## 3. Backend Technical Design

Each Phase 2 component becomes one TypeScript module. Directory paths are relative to `apps/api/src/`.

| Module | Directory | Public interface (signature) | Depends on | Owns | Reads | Writes |
|---|---|---|---|---|---|---|
| Provider/Event Intake | `intake/` | `ingestEvent(raw: ProviderEvent): Promise<{status: 'accepted'\|'duplicate'}>` | `normalizer`, `orchestrator` | `ingested_events` | — | `ingested_events`, triggers Orchestrator |
| Failure Normalizer | `normalizer/` | `normalize(fields: RawFailureFields): Category` | none | static category-map config | — | nothing (pure function) |
| Recovery Context Assembler | `context/` | `assembleContext(caseId: string): Promise<AgentContext>` | `db` (cases, payments, audit, subscriptions) | nothing | `recovery_cases`, `payments`, `subscriptions`, `audit_events` | nothing |
| Agent | `agent/` | `proposeNextOperation(ctx: AgentContext): Promise<AgentProposal>` | `@google/genai` SDK, Zod schema | nothing | nothing (context passed in) | nothing |
| Policy Engine | `policy/` | `validate(ctx: AgentContext, proposal: AgentProposal): PolicyResult` | category-policy config | nothing | `recovery_cases` (via ctx) | nothing |
| Orchestrator | `orchestrator/` | `evaluate(caseId: string): Promise<void>`, `sweepDueActions(): Promise<void>`, `sweepExhaustion(): Promise<void>` | `context`, `agent`, `policy`, `execution`, `audit` | `recovery_cases.status` (sole writer), `due_actions` | everything | `recovery_cases`, `due_actions`, calls `audit.append` |
| Action Execution | `execution/` | `execute(caseId: string, action: RecoveryAction): Promise<ExecutionResult>` | `simulatorAdapter`, `interaction` | `recovery_actions` | `recovery_actions` | `recovery_actions` (outcome fields only) |
| Customer Interaction | `interaction/` | `send(caseId: string, kind: 'OUTREACH'\|'REQUEST_PAYMENT_METHOD_UPDATE'\|'REQUEST_CUSTOMER_ACTION'): Promise<OutreachRecord>` | `simulatorAdapter` | `outreach` | `outreach` | `outreach` |
| Simulator Adapter | `simulator/` | `retryPayment(...): Promise<PaymentResult>`, `sendMessage(...): Promise<DeliveryResult>`, `runScenario(config: ScenarioConfig): Promise<void>` | scenario config store | scenario state | — | emits events back through `intake` |
| Audit Trail | `audit/` | `append(event: AuditEvent): Promise<void>` (the *only* write path; internally calls the projector in the same transaction) | `db` | `audit_events` | — | `audit_events`, triggers projection |
| Recovery Case Projector | `audit/project.ts` (sub-routine of Audit Trail, **not** an independently callable module — see Phase 2 §2 note) | `project(event: AuditEvent, tx): Promise<void>` | `db` | nothing independently | the event just appended | `recovery_cases` |
| Evaluation | `evaluation/` | `getMetrics(): Promise<Metrics>` | `db` (read-only) | nothing | `audit_events`, `recovery_cases` | nothing — ever |

No new abstractions beyond this table: 11 directories, one of which (`audit/project.ts`) is intentionally not its own top-level module, mirroring the Phase 2 note that the Projector has no independent life.

---

## 4. Repository Structure

```
/apps
  /api                        Express backend — the Recovery System
    /src
      /intake                 Provider/Event Intake
      /normalizer              Failure Normalizer
      /context                 Recovery Context Assembler
      /agent                   Agent (single structured LLM call)
      /policy                  Policy Engine + category config
      /orchestrator            Orchestrator: evaluate(), sweeps, locking
      /execution               Action Execution dispatcher
      /interaction             Customer Interaction (outreach/request-*)
      /simulator                Simulator Adapter + scenario runner
      /audit                   Audit Trail + Recovery Case projector
      /evaluation              Read-only metrics
      /db                      Drizzle schema, migrations, client, transaction helper
      /api                     Express routes (§6), thin — calls into modules above
      server.ts
    Dockerfile
  /web                         React control-surface (Vite)
    /src
      /pages                   CaseList, CaseDetail, ScenarioRunner, Metrics
      /components               Timeline, CategoryBadge, PolicyBadge, ...
      /api                      typed fetch client (imports shared types)

/packages
  /shared                      Types shared by api + web + simulator:
                                Category, Operation, TimingStrategy, CaseStatus,
                                AgentContext, AgentProposal, event payload shapes

docker-compose.yml              local Postgres
pnpm-workspace.yaml
```

**Why this preserves the architecture:** every Phase 2 box (§2 of the Phase 2 doc) maps to exactly one directory. There is no directory that spans two Phase 2 responsibilities, and no Phase 2 responsibility is split across two directories (the Projector is the one deliberate exception, and it's deliberate in the architecture itself). The frontend imports only `packages/shared` and the thin `apps/api/src/api` route layer's response shapes — it never reaches into `orchestrator/` or `db/` directly, keeping the frontend/backend boundary real even inside one repo.

---

## 5. Database Design

All timestamps `timestamptz`. All monetary amounts stored as integers in minor units (paise).

### `subscriptions`
| Column | Type | Notes |
|---|---|---|
| `id` | text | **PK** |
| `customer_id` | text | indexed |
| `plan_id` | text | |
| `amount` | integer | |
| `currency` | text | default `'INR'` |
| `billing_cycle` | text | |
| `next_billing_date` | date | mutable — advances each cycle |
| `status` | text | `active/paused/cancelled` — mutable |
| `payment_method_id` | text | mutable |
| `created_at` | timestamptz | immutable |
| `updated_at` | timestamptz | mutable |

### `payments`
| Column | Type | Notes |
|---|---|---|
| `id` | text | **PK** |
| `subscription_id` | text | **FK → subscriptions.id**, indexed |
| `amount` | integer | |
| `currency` | text | |
| `method` | text | default `'card'` |
| `status` | text | `success/failed` |
| `error_code`, `error_description`, `error_source`, `error_step`, `error_reason` | text, nullable | Razorpay-shaped fields, verbatim |
| `created_at` | timestamptz | |

Entirely **immutable** once inserted — a retry produces a new row, never an update. Index: `(subscription_id, created_at)`.

### `recovery_cases`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `subscription_id` | text | **FK → subscriptions.id** |
| `payment_id` | text | **FK → payments.id** — the *originating* failure (immutable; per-attempt payments live on `recovery_actions.payment_id`) |
| `category` | text | mutable — re-normalized if a later attempt returns a different error |
| `status` | text | one of the 11 states — mutable, **written only by the Orchestrator** |
| `retries_used` | integer | default 0, mutable |
| `outreach_used` | integer | default 0, mutable |
| `opted_out` | boolean | default false, mutable |
| `complaint` | boolean | default false, mutable |
| `started_at` | timestamptz | immutable |
| `deadline` | timestamptz | immutable (Day-14 from `started_at`) |
| `version` | integer | default 0, incremented on every write — cheap anomaly detector even though row-lock is the primary concurrency mechanism |
| `updated_at` | timestamptz | mutable |

**Constraint enforcing "at most one open case per subscription" at the database level, not just in application code:**
```sql
CREATE UNIQUE INDEX one_open_case_per_subscription
  ON recovery_cases (subscription_id)
  WHERE status NOT IN ('RECOVERED','ESCALATED','EXHAUSTED','STOPPED');
```
Index also on `(status, deadline)` for the Day-14 sweep query.

### `recovery_actions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `recovery_case_id` | uuid | **FK**, indexed |
| `operation` | text | one of the 7 primitives, immutable |
| `timing_strategy` | text, nullable | immutable |
| `scheduled_at` | timestamptz, nullable | immutable |
| `status` | text | `scheduled → executed`, one controlled mutation |
| `payment_id` | text, nullable | **FK → payments.id**, populated post-execution for `RETRY_PAYMENT` |
| `reason` | text | immutable (Agent's stated rationale) |
| `created_at` | timestamptz | immutable |
| `executed_at` | timestamptz, nullable | mutable |

Idempotency: before executing, look up the row by `id`; if `status = 'executed'` already, skip and return the stored outcome.

### `audit_events`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `recovery_case_id` | uuid | **FK**, indexed |
| `subscription_id` | text | denormalized, indexed |
| `payment_id` | text, nullable | |
| `event_type` | text | see enum below |
| `payload` | jsonb | structured detail |
| `created_at` | timestamptz | |

**Append-only, enforced two ways:** (1) no application code path ever issues `UPDATE`/`DELETE` against this table, (2) the DB role the app connects as has no `UPDATE`/`DELETE` grant on it — app-logic-only enforcement is bypassable, a DB grant isn't.

`event_type` enum: `FAILURE_RECEIVED, FAILURE_APPENDED, AGENT_DECISION, POLICY_CHECK, ACTION_SCHEDULED, ACTION_EXECUTED, EXECUTION_FAILED, PAYMENT_OUTCOME, OUTREACH_SENT, REQUEST_SENT, OUTREACH_RESULT, CUSTOMER_SIGNAL, ESCALATED, STOPPED, EXHAUSTED, RECOVERED, MANUAL_OVERRIDE`.

Index: `(recovery_case_id, created_at)` for ordered replay.

### `outreach`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `recovery_case_id` | uuid | **FK**, indexed |
| `kind` | text | `OUTREACH / REQUEST_PAYMENT_METHOD_UPDATE / REQUEST_CUSTOMER_ACTION` |
| `channel` | text | `sms / email` |
| `template` | text | |
| `sent_at` | timestamptz | immutable |
| `status` | text | mutable: `sent → delivered/failed` |
| `customer_response`, `responded_at` | nullable | mutable |

### `due_actions`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid | **PK** |
| `recovery_case_id` | uuid | **FK**, indexed |
| `due_at` | timestamptz | **indexed** — the poller's scan key |
| `reason` | text | |
| `created_at` | timestamptz | |

Purely ephemeral scheduling state — the durable record is the `ACTION_SCHEDULED` audit event, not this table. Rows are **deleted** (not soft-consumed) once the poller acts on them.

### `ingested_events`
| Column | Type | Notes |
|---|---|---|
| `event_id` | text | **PK** — the dedup key itself |
| `recovery_case_id` | uuid, nullable | |
| `event_type` | text | |
| `payload` | jsonb | raw payload, kept for debugging |
| `received_at` | timestamptz | |

Dedup is `INSERT ... ON CONFLICT (event_id) DO NOTHING` — a duplicate is a true no-op at the SQL level, not an application `if` check.

No 9th table introduced — Subscription History remains **compute-on-read** (a query joining `payments` + `recovery_cases` for a given `subscription_id`), per the Phase 2 open design decision.

**Transactional Recovery Case projection — the concrete pattern used everywhere in the Orchestrator:**
```sql
BEGIN;
  SELECT * FROM recovery_cases WHERE id = $1 FOR UPDATE;   -- acquire the per-case lock
  -- business logic runs against this locked snapshot --
  INSERT INTO audit_events (...) VALUES (...);              -- append (source of truth)
  UPDATE recovery_cases                                     -- project (read model)
    SET status = $2, retries_used = $3, outreach_used = $4,
        version = version + 1, updated_at = now()
    WHERE id = $1;
COMMIT;
```
If anything after the `SELECT ... FOR UPDATE` throws, the whole transaction rolls back — **nothing** changed, and the next evaluation cycle simply tries again. This is the literal implementation of Phase 2's "audit append + project = one transaction" invariant.

---

## 6. API Contracts

Auth: a single bearer token shared by the Simulator, the frontend, and ops for the MVP — **not** a real auth system. Marked explicitly as demo-only; a real auth layer is out of scope (§15.M).

| # | Method & Path | Request | Response | Errors | Idempotency |
|---|---|---|---|---|---|
| 1 | `POST /api/events` | `{event_id, event_type, payload}` (provider-shaped) | `202 {status: 'accepted'\|'duplicate'}` | `400` invalid shape | `event_id` uniqueness — replays are no-ops |
| 2 | `GET /api/recovery-cases?status=&category=` | query params | `200 [{id, subscription_id, category, status, retries_used, outreach_used, started_at, deadline}]` | `400` bad filter | N/A (read) |
| 3 | `GET /api/recovery-cases/:id` | — | `200 {case: {...}, timeline: AuditEvent[]}` | `404` unknown id | N/A (read) |
| 4 | `POST /api/recovery-cases/:id/manual-override` | `{outcome: 'RECOVERED'\|'STOPPED', human_id, note}` | `200 {case: {...}}` | `404`; `409` if case isn't `ESCALATED` | Reusing the same override on an already-overridden case is a no-op |
| 5 | `POST /api/recovery-cases/:id/reevaluate` | `{}` | `202 {status: 'queued'}` | `404`; `409` if case is terminal | Concurrent calls collapse to one evaluation via the per-case lock |
| 6 | `POST /api/simulator/scenarios` | `ScenarioConfig` (§11) | `201 {subscription_id, payment_id, recovery_case_id}` | `400` invalid scenario | Each call creates a new subscription+failure — not idempotent by design (it's a test-data generator) |
| 7 | `GET /api/evaluation/metrics` | — | `200 {recovery_rate, revenue_recovered, time_to_recovery_avg, escalation_rate, ...optional}` | — | N/A (read) |

Endpoint 5 exists purely for demo convenience (force a case forward instead of waiting on the poller) — marked **optional** if time is short.

---

## 7. Event Contracts

Provider-shaped fields (never invented, copied verbatim from the spec) vs. internal fields (added by our own processing) are kept visually separate below.

**`payment.failed`** (provider-shaped, from Simulator)
```json
{
  "event_id": "evt_001",
  "event_type": "payment.failed",
  "payload": {
    "payment_id": "pay_001", "subscription_id": "sub_001",
    "amount": 999, "currency": "INR", "method": "card", "status": "failed",
    "error_code": "insufficient_funds", "error_description": "Insufficient funds",
    "error_source": "issuer_bank", "error_step": "payment_authorization",
    "error_reason": "insufficient_funds", "created_at": "..."
  }
}
```
*Internal fields added after normalization (not part of the event itself):* `normalized_category`, `recovery_case_id`.

**`payment.success`** — same provider-shaped payload with `status: "success"`, no error_* fields.

**Subscription state events** (`subscription.updated`) — provider-shaped: `{subscription_id, status, next_billing_date, payment_method_id}`.

**`payment_method_updated`** — provider-shaped: `{subscription_id, payment_method_id, updated: true|false}`.

**`customer_action_completed`** — provider-shaped: `{subscription_id, recovery_case_id, completed: true|false}`. (This event necessarily carries `recovery_case_id` because, unlike a payment method, "the action" only has meaning in the context of a specific case — this is the one internal-shaped field the provider event must carry, and it mirrors how `payment_method_updated` is scoped by `subscription_id` alone since a payment method isn't case-specific.)

**Outreach delivery/response** — provider-shaped (simulated channel): `{outreach_id, status: "delivered"|"failed", customer_response: string|null}`.

**`opt_out`** — provider-shaped: `{subscription_id, recovery_case_id}`.

**`complaint`** — provider-shaped: `{subscription_id, recovery_case_id, note}`.

**`cancellation`** — provider-shaped: `{subscription_id}`.

No additional Razorpay-shaped fields are introduced anywhere in this list beyond what spec §17.2 already defines.

---

## 8. Agent Implementation

```ts
// agent/index.ts
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const AGENT_PROPOSAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    operation: { type: "string", enum: OPERATIONS },
    timing_strategy: { type: "string", enum: TIMING_STRATEGIES, nullable: true },
    reason: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["operation", "reason", "confidence"],
};

async function proposeNextOperation(ctx: AgentContext): Promise<AgentProposal> {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: JSON.stringify(ctx),
    config: {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      responseMimeType: "application/json",
      responseSchema: AGENT_PROPOSAL_JSON_SCHEMA,   // constrains generation, not just a hint
      thinkingConfig: { thinkingBudget: 0 },        // bounded pick-one-of-seven task — no extended reasoning needed
    },
  });
  const raw = JSON.parse(response.text);
  return AgentProposalSchema.parse(raw);            // Zod — throws on anything malformed, defense-in-depth
}
```

- **Context construction:** exactly the object in Phase 2 §5 — assembled fresh per call by `context/`, never cached.
- **Prompt structure:** system instructions are static (below); the user turn is the serialized `AgentContext` — no conversation history, no prior turns, one shot.
- **System instructions (structure, not full text):** state the seven primitives and five timing strategies, state that `allowed_primitives`/`allowed_timing_strategies` in the context are a hard constraint, instruct the model to always propose from within them, and instruct it to keep `reason` to one sentence (audit rationale, not chain-of-thought, per spec §18).
- **Allowed operation enum:** `WAIT | RETRY_PAYMENT | OUTREACH | REQUEST_PAYMENT_METHOD_UPDATE | REQUEST_CUSTOMER_ACTION | ESCALATE | STOP`.
- **Allowed timing enum:** `WAIT_6H | WAIT_24H | WAIT_72H | NEXT_PAYDAY | IMMEDIATE`.
- **Model failure handling:** SDK error/timeout → caught in `orchestrator/evaluate()`, logged as `AGENT_UNAVAILABLE`, falls back to the deterministic default (§10).
- **Invalid output handling:** Zod `.parse()` throws → same fallback path, logged as `INVALID_AGENT_OUTPUT`. (Schema-constrained generation makes this rare, but Zod stays as a hard backstop — never trust a network call to always behave.)
- **Timeout handling:** 30s client-side timeout on the Gemini call (illustrative; tune during build).
- **Logging/audit:** the full `{context, proposal}` pair is embedded verbatim in the `AGENT_DECISION` audit event — this is the system's only persisted record of what the Agent saw and said, satisfying reproducibility without a separate "agent context" table.

---

## 9. Policy Implementation

```ts
// policy/categoryConfig.ts
export const CATEGORY_POLICY: Record<Category, {primitives: Operation[]; timing: TimingStrategy[]}> = {
  SOFT_BALANCE:            { primitives: ["WAIT","RETRY_PAYMENT","OUTREACH"], timing: ["NEXT_PAYDAY"] },
  SOFT_LIMIT:               { primitives: ["WAIT","RETRY_PAYMENT","OUTREACH"], timing: ["WAIT_24H"] },
  SOFT_TRANSIENT:            { primitives: ["WAIT","RETRY_PAYMENT","OUTREACH"], timing: ["WAIT_6H","WAIT_24H","WAIT_72H"] },
  CUSTOMER_ACTION:           { primitives: ["OUTREACH","REQUEST_CUSTOMER_ACTION","WAIT","RETRY_PAYMENT"], timing: ["IMMEDIATE","WAIT_72H"] },
  PAYMENT_METHOD_INVALID:    { primitives: ["OUTREACH","REQUEST_PAYMENT_METHOD_UPDATE","WAIT","RETRY_PAYMENT"], timing: ["IMMEDIATE","WAIT_72H"] },
  FRAUD_RISK:                { primitives: [], timing: [] },
  UNKNOWN_DECLINE:           { primitives: ["OUTREACH"], timing: ["WAIT_72H"] },
};
// ESCALATE and STOP are appended to every category's allow-list at lookup time,
// not stored per-category — a single line of code implements the Phase 2 open decision.
```

```ts
// policy/index.ts
function validate(ctx: AgentContext, proposal: AgentProposal): PolicyResult {
  const checks: PolicyCheck[] = [
    terminalStateCheck, cancellationCheck, complaintCheck,
    categoryAllowListCheck, fraudRestrictionCheck,
    paymentMethodPrerequisiteCheck, customerActionPrerequisiteCheck,
    retryBudgetCheck, outreachBudgetCheck, optOutCheck, deadlineCheck,
  ];
  for (const check of checks) {
    const result = check(ctx, proposal);
    if (!result.allowed) return result;   // first failure wins — order matters, matches Phase 2 §6
  }
  return { allowed: true };
}
```

- **`PolicyResult` schema:** `{allowed: boolean; reason?: RejectionReason}`.
- **`RejectionReason` enum:** one entry per check function above (e.g. `RETRY_BUDGET_EXCEEDED`, `PAYMENT_METHOD_NOT_UPDATED`, `FRAUD_RETRY_FORBIDDEN`, ...).
- Policy is a pure function of `(ctx, proposal)` — no I/O, fully unit-testable without a database (§13).
- The LLM cannot override any of this: Policy never reads anything the Agent produced except `operation`/`timing_strategy`, and it never executes anything itself.

---

## 10. Orchestrator Implementation

```ts
// orchestrator/evaluate.ts
async function evaluate(caseId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const kase = await tx.query.recoveryCases.findFirst({
      where: eq(recoveryCases.id, caseId),
      for: "update",                       // per-case lock, held for this whole cycle
    });
    if (isTerminal(kase.status)) return;    // stale trigger on an already-closed case — no-op

    const ctx = await assembleContext(caseId, tx);
    let proposal: AgentProposal;
    try {
      proposal = await proposeNextOperation(ctx);
    } catch {
      proposal = FALLBACK_PROPOSAL(ctx);    // AGENT_UNAVAILABLE / INVALID_AGENT_OUTPUT path
    }

    const policyResult = validate(ctx, proposal);
    await appendAudit(tx, caseId, "AGENT_DECISION", proposal);
    await appendAudit(tx, caseId, "POLICY_CHECK", policyResult);

    if (!policyResult.allowed) {
      proposal = SAFE_DEFAULT(ctx);         // one deterministic retry with feedback, then fallback
    }

    const result = await execute(caseId, proposal, tx);
    await appendAudit(tx, caseId, "ACTION_EXECUTED", result);   // project() runs inside appendAudit
  });
}
```

- **Transaction boundary:** the entire evaluate cycle — lock, context, execute, audit, project — is one DB transaction. Anything that throws rolls the whole cycle back.
- **Locking strategy:** `SELECT ... FOR UPDATE` on the `recovery_cases` row, held for the cycle's duration (§5's recommended default over optimistic versioning).
- **Idempotency strategy:** `action_id` checked before every execute call (§8 of Phase 2); `event_id` checked before every ingest.
- **Scheduled re-evaluation:** `sweepDueActions()` runs on a `setInterval` (e.g. every 60s), selects `due_actions WHERE due_at <= now()`, calls `evaluate(caseId)` for each, deletes the row.
- **External event re-evaluation:** `intake.ingestEvent()` calls `evaluate(caseId)` directly and synchronously for customer-response-shaped events — no waiting on the poller.
- **Day-14 sweep:** `sweepExhaustion()`, a second `setInterval` (e.g. every 5 min), runs `UPDATE recovery_cases SET status='EXHAUSTED' ... WHERE status NOT IN (terminal) AND deadline <= now() RETURNING id`, then appends an `EXHAUSTED` audit event per returned row.
- **Terminal-state handling:** `evaluate()`'s first check after acquiring the lock is `isTerminal(kase.status)` — a no-op if true. This is what makes "scheduled action fires after terminal state" harmless.
- **Duplicate event handling:** DB-level `ON CONFLICT (event_id) DO NOTHING` — never reaches `evaluate()` a second time for the same event.
- **Stale scheduled action handling:** covered by the terminal-state check above; a `due_actions` row from before an `EXHAUSTED`/`RECOVERED`/`STOPPED` transition simply results in a no-op `evaluate()` call when it fires.

No distributed workflow engine — two `setInterval` loops and one row lock cover every requirement in this section.

---

## 11. Simulator Implementation

```ts
// simulator/scenario.ts
interface ScenarioConfig {
  failure_code: string;                                  // e.g. "insufficient_funds"
  failure_behavior: "always_fail" | "fail_then_succeed" | "always_succeed";
  customer_behavior: "responsive" | "unresponsive" | "opts_out" | "complains";
  payment_method_behavior: "updates" | "never_updates";
  customer_action_behavior: "completes" | "never_completes";
  would_native_retry_succeed: boolean;                    // evaluation ground-truth label only
}
```

- **Failure behavior:** `runScenario()` creates a `subscriptions` row and a `payments` row (`status: failed`) matching `failure_code`, then emits `payment.failed` through `intake`. Subsequent `retryPayment()` calls consult `failure_behavior` to decide success/failure deterministically (e.g. `fail_then_succeed` fails attempt 1, succeeds attempt 2).
- **Retry behavior:** each `retryPayment()` call inserts a new `payments` row — never mutates the original, matching the immutability rule in §5.
- **Customer behavior:** drives what `sendMessage()`'s later simulated callback reports — a `responsive` scenario schedules a `customer_response` a few seconds after send; `opts_out`/`complains` scenarios emit `opt_out`/`complaint` events instead.
- **Payment-method / customer-action behavior:** after a `REQUEST_*` send, the simulator schedules a `payment_method_updated`/`customer_action_completed` event with the configured boolean, on a short deterministic delay.
- **Outreach behavior:** `sendMessage()` always "delivers" successfully in MVP (no simulated channel failures needed for the demo) — kept intentionally simple.
- **Event generation:** every simulated occurrence is emitted back through `POST /api/events` (or an in-process call to `intake.ingestEvent` if simulator and API share a process, which they do in this modular monolith) — the simulator never talks to any other module directly.
- **Determinism for tests:** all delays are configurable (including `0` for tests), and outcomes are a pure function of `ScenarioConfig` + attempt count — no real randomness, so integration tests are reproducible.
- Explicitly **not** implemented: Razorpay's native T+1/T+2/T+3 retry loop, or any part of the real Razorpay API surface.

---

## 12. Frontend / React Design

A control surface, not a product. Four screens, TanStack Query polling every 3–5s for "live" updates.

| Screen | Shows | Source |
|---|---|---|
| **Case List** (`/`) | All recovery cases: subscription, category, status, retries/outreach used, deadline | `GET /api/recovery-cases` |
| **Case Detail** (`/cases/:id`) | The 11 required elements: failed subscription, category, failure code/reason, subscription history (computed inline from the same response), recovery state, latest Agent recommendation + reasoning, latest Policy decision, executed action, full audit timeline, recovery outcome, revenue recovered | `GET /api/recovery-cases/:id` |
| **Scenario Runner** (`/scenarios`) | A form over `ScenarioConfig` (§11) + a "Run" button; shows the created `recovery_case_id` with a link to its detail page | `POST /api/simulator/scenarios` |
| **Metrics** (`/metrics`) | The 4 MVP-required metrics as cards, optional ones below a "nice to have" divider | `GET /api/evaluation/metrics` |

Component sketch: `<CaseList>` / `<CaseDetail>` (composed of `<CategoryBadge>`, `<PolicyDecision>`, `<Timeline>`, `<OutcomeCard>`) / `<ScenarioForm>` / `<MetricsGrid>`. `<Timeline>` renders `audit_events` in order — this single component is what makes the agentic loop *visible*, since every `AGENT_DECISION` → `POLICY_CHECK` → `ACTION_EXECUTED` triple is right there in sequence.

Deliberately **not** built: authentication UI, multi-tenant account switching, notification preferences, anything resembling a customer-facing dashboard.

---

## 13. Testing Strategy

| Category | Tests | Tool |
|---|---|---|
| **Unit — Normalization** | Each representative error code maps to its documented category; ambiguous/unknown input → `UNKNOWN_DECLINE` | Vitest |
| **Unit — Policy** | Every guardrail in isolation (retry budget, outreach budget, deadline, opt-out blocks outreach but not retry, fraud blocks retry, category allow-list, `ESCALATE`/`STOP` always pass) | Vitest, no DB |
| **Unit — Timing strategies** | Each strategy converts to the correct timestamp given a fixed "now" and subscription | Vitest |
| **Unit — State transitions** | Every edge in the §4 transition table, as a pure reducer test | Vitest |
| **Integration — Core flow** | `payment.failed` → case created; Agent→Policy→Orchestrator happy path; retry→success; retry→retry-limit→forced ESCALATE/STOP path; payment-method update→retry; customer action→retry; outreach budget exhaustion; Day-14 exhaustion; complaint→immediate escalation | Vitest + Supertest against a test Postgres (Docker) |
| **Concurrency/idempotency** | Duplicate `event_id` produces one case, not two; duplicate `action_id` execute is a no-op; `payment.success` racing a scheduled `WAIT` resolves to `RECOVERED`; two concurrent `evaluate()` calls on the same case serialize (second waits for the row lock, doesn't corrupt state) | Vitest, real transactions against test DB |
| **Agent evaluation** | A fixed set of scripted scenarios (one per category) run through the real Agent call; assert the returned `operation` is in that category's allowed-primitive set (not that it matches one exact answer — the Agent has latitude within its bounds); compare recovery outcome against the `would_native_retry_succeed` baseline flag | Vitest, live LLM call (slower, run less frequently / behind a flag) |

---

## 14. Two-Week Implementation Plan

**MUST HAVE (core thesis: failure → diagnosis → history-aware decision → policy → execution → outcome → audit → revenue)**
- Days 1–2: DB schema + migrations, Drizzle setup, Docker Compose, `packages/shared` types
- Days 3–4: Failure Normalizer, Simulator Adapter (failure + retry behavior only), Provider/Event Intake, `payment.failed` → `FAILED` case creation end-to-end
- Days 5–6: Recovery Context Assembler, Agent (single structured call), Policy Engine — get one full `EVALUATING → WAIT → RETRY → RECOVERED` cycle working (sequence B from Phase 2 §11)
- Days 7–8: Orchestrator's `evaluate()` fully wired (locking, transaction boundary, audit+project), `due_actions` poller, Day-14 sweep
- Day 9: Retry/outreach budget exhaustion paths, fraud/unknown-decline categories, `ESCALATE`/`STOP`
- Day 10: Minimal API layer (§6) + Case List/Detail screens — the demo needs to be *watchable* by this point

**SHOULD HAVE**
- Customer Interaction module fully (payment-method-update and customer-action sub-flows, sequences C/D)
- Complaint/opt-out/cancellation handling (sequence F)
- Scenario Runner screen + `POST /api/simulator/scenarios`
- Evaluation metrics endpoint + Metrics screen
- Core integration test suite (§13)

**CUT IF BEHIND**
- Manual-override endpoint/UI (ESCALATED cases can be inspected via the API/DB directly for the demo if time runs out)
- Nice-to-have metrics (outreach rate, unnecessary retries, 14-day exhaustion count)
- Concurrency/idempotency test suite (keep the *mechanisms* — lock, unique constraints — since they're cheap; the *tests proving them* are the first thing to drop under time pressure)
- Tailwind polish beyond "readable and demo-safe"
- Deployment (a well-run local demo via `docker compose up` + `pnpm dev` is a completely acceptable buildathon deliverable)

---

## 15. Final Output

**A. Final technology stack** — Node.js/TypeScript, Express, PostgreSQL (Docker Compose locally), Drizzle, Zod, plain `@google/genai` call against Gemini 2.5 Flash (no agent framework), `setInterval` scheduling, Vitest + Supertest, Vite + React + TanStack Query + Tailwind, pnpm workspaces, single-container deploy. Full table in §1.

**B. Why each was selected** — every row in §1 is justified against the architecture's actual requirements (row-locking, single-shot structured output, tiny API surface), not popularity.

**C. Final repository structure** — §4: one pnpm-workspace repo, `apps/api` (11 modules mirroring Phase 2 1:1) + `apps/web` + `packages/shared`.

**D. Database schema** — §5: 8 tables, no more; `recovery_cases` enforces single-open-case-per-subscription as a partial unique index, not just app logic.

**E. API contracts** — §6: 7 endpoints total.

**F. Event contracts** — §7: provider-shaped vs. internal fields kept explicitly separate; no invented Razorpay fields.

**G. Agent implementation** — §8: one function, Gemini 2.5 Flash with schema-constrained JSON output, Zod-validated, no framework.

**H. Policy implementation** — §9: pure function, ordered guardrail checks, deterministic, LLM cannot override.

**I. Orchestrator implementation** — §10: one transaction per evaluation cycle, `FOR UPDATE` lock, two `setInterval` pollers, no workflow engine.

**J. React demo design** — §12: 4 screens, polling-based, timeline component makes the agent loop visible.

**K. Testing strategy** — §13: unit (normalizer/policy/timing/transitions), integration (full flows), concurrency, Agent evaluation.

**L. Two-week build plan** — §14: MUST/SHOULD/CUT, sequenced around the core thesis, demo-watchable by day 10.

**M. Explicitly rejected as unnecessary (would be SCOPE CREEP for this MVP):**
- LangGraph or any multi-step agent framework — this Agent has no loop or tools (§2)
- Kafka / any message broker — a DB table + poller
- Kubernetes / container orchestration
- Temporal / Airflow / any distributed workflow engine
- Microservices — nothing here demonstrates a need to split the monolith
- Prisma — fights the raw `FOR UPDATE` pattern this system depends on
- SQLite — would make concurrency control *accidental* instead of *explicit*
- `node-cron` — `setInterval` already does the job with one fewer dependency
- Next.js — no routing/SSR problem exists for a 4-screen control surface
- WebSockets/SSE — polling is sufficient for a demo
- Turborepo/Nx — pnpm workspaces alone is enough for 2 apps + 1 shared package
- A real authentication system — a shared bearer token is sufficient for a 2-week demo; a real auth layer is a new architectural responsibility the Phase 2 design never asked for
- TypeORM/Sequelize, GraphQL, Redis/distributed cache — none solve a problem this system actually has
