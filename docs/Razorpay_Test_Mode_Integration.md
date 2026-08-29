# Razorpay Test-Mode Integration — Feature Add-On Implementation

> **Status:** IMPLEMENTED (feature-flagged, `PROVIDER=razorpay`). Not part of the locked MVP scope.
> **Type:** optional, feature-flagged second `ProviderPort` implementation.
>
> **What shipped** (all behind `PROVIDER=razorpay`; Simulator remains the default and all 39 pre-existing tests still pass):
> - `apps/api/src/razorpay/`: `config.ts` (lazy env), `client.ts` (fetch-based Razorpay REST — **no SDK dependency added**), `adapter.ts` (`ProviderPort`), `webhook.ts` (HMAC verify + translate + handler), `map.ts`, `provision.ts` (demo helper).
> - `apps/api/src/providerPort.ts` — static `provider` const selected by `process.env.PROVIDER`.
> - `POST /api/webhooks/razorpay` mounted in `server.ts` with `express.raw`, before `express.json()`, outside `requireAuth`.
> - `POST /api/razorpay/subscriptions` demo helper in `routes.ts` (409 unless `PROVIDER=razorpay`).
> - Migration `apps/api/src/db/migrations/0001_aspiring_killer_shrike.sql` — additive: `subscriptions.provider`, `subscriptions.provider_ref`, `outreach.provider_ref` (already applied to `recovery` and `recovery_test`).
> - Normalizer now prefers `error.reason`; real Razorpay reason keys added to the shared map.
> - New unit tests: `apps/api/src/razorpay/webhook.test.ts` (12 tests).
>
> **Deviation from the original plan:** `subscription.pending` is the failure trigger (translated to internal `payment.failed`), and standalone `payment.failed` / `payment.captured` webhooks are ignored (the subscription-scoped events carry the resolvable `sub_…` id; the bare payment entity does not). See §7.3.
>
> **Still requires you (no code):** create the Razorpay test account + keys + Plan, run a tunnel, register the webhook. See §4.
> **Scope guard:** the MVP is deliberately Simulator-only (Architecture §1, §15.H;
> Phase 3 §11). This document describes how to add a *real* Razorpay **test-mode**
> provider **behind a flag** without changing the Simulator, the Orchestrator, the
> Policy Engine, the Agent, the Audit Trail, or the state machine.

---

## 1. Overview & scope

### What is being added

A live Razorpay **test-mode** implementation of the existing `ProviderPort`
interface (`apps/api/src/simulator/port.ts`), selected at boot by a new
`PROVIDER` env var:

- `PROVIDER=simulator` (default) — current behaviour, unchanged. Powers `pnpm test`.
- `PROVIDER=razorpay` — the new `RazorpayAdapter` is bound instead.

The Razorpay adapter:

| `ProviderPort` method | Razorpay mechanism (test mode) |
|---|---|
| `retryPayment()` | Razorpay **Subscriptions** — a real Plan + Subscription authenticated with a test card, subsequent charges issued as tokenized recurring payments (Dashboard **"Charge this Now"** in test mode, or `POST /v1/subscriptions/:id/charge`-style flow). |
| `sendMessage()` | Razorpay **Payment Links** — each `OUTREACH` / `REQUEST_PAYMENT_METHOD_UPDATE` / `REQUEST_CUSTOMER_ACTION` creates a Payment Link with `reference_id = recovery_case_id`; the customer response arrives as a `payment_link.paid` / `payment_link.expired` webhook. |

Inbound provider events (which the Simulator fakes in-process today) now arrive
as **real Razorpay webhooks** at a new endpoint `POST /api/webhooks/razorpay`,
which verifies the signature, translates the Razorpay payload into the existing
internal `{event_id, event_type, payload}` envelope, and calls the **unchanged**
`ingestEvent()` (`apps/api/src/intake/index.ts`).

### What is explicitly NOT changed

- `apps/api/src/simulator/**` — untouched; still the default.
- `ProviderPort` interface signature (`apps/api/src/simulator/port.ts`) — untouched.
- Orchestrator, Policy, Agent, Audit, `evaluate()` / `sweepDueActions()` / `sweepExhaustion()`.
- The 11-state recovery state machine and all transitions.
- The `POST /api/events` endpoint and `ProviderEventSchema`
  (`packages/shared/src/schemas.ts`) — the internal envelope is reused verbatim.
- `ingested_events` dedup (`INSERT ... ON CONFLICT (event_id) DO NOTHING`,
  `apps/api/src/intake/index.ts:24`).

### Files touched

| File | Change |
|---|---|
| `apps/api/src/razorpay/` (new dir) | `config.ts`, `client.ts`, `adapter.ts`, `webhook.ts`, `map.ts`, `provision.ts`, `webhook.test.ts` |
| `apps/api/src/providerPort.ts` (new) | `export const provider` — `razorpay` when `process.env.PROVIDER==="razorpay"`, else `simulatorAdapter` |
| `apps/api/src/execution/index.ts` | import `{ provider }` from `../providerPort.js`; `provider.retryPayment(...)` |
| `apps/api/src/interaction/index.ts` | same swap; `provider.sendMessage(...)` |
| `apps/api/src/server.ts` | mount raw-body, unauthenticated `POST /api/webhooks/razorpay` before `express.json()` |
| `apps/api/src/api/routes.ts` | `POST /api/razorpay/subscriptions` demo helper |
| `packages/shared/src/normalizerMap.ts` | real Razorpay `error.reason` → `Category` entries added |
| `apps/api/src/normalizer/index.ts` | `normalize()` prefers `errorReason ?? errorCode` |
| `apps/api/src/intake/index.ts` | `payment.failed` route passes `error_reason` into `normalize()` |
| `apps/api/src/db/schema.ts` + `0001_*.sql` | additive `subscriptions.provider`, `subscriptions.provider_ref`, `outreach.provider_ref` |
| `apps/api/.env.example` | new env keys (`PROVIDER`, `RAZORPAY_*`, `PUBLIC_BASE_URL`) |

### Invariant check (Architecture §15.G)

- **#5 (Simulator is the only component that knows it's not a real provider):**
  preserved — the Razorpay adapter is now *also* a provider-boundary component;
  no module outside `razorpay/` + `simulator/` knows which one is bound.
- **#7 (every state-changing op is idempotent, keyed by `action_id` / `event_id`):**
  preserved — webhook dedup keys on Razorpay's `x-razorpay-event-id` header via
  the existing `ingested_events` PK.
- **#9 (no action reaches the provider without passing Policy first):** preserved —
  the adapter is only ever called from `execution/` / `interaction/`, which run
  inside `evaluate()` after Policy approval.
- **#11 (Agent never sees card credentials / raw contact details):** preserved —
  the adapter deals in Razorpay opaque ids (`sub_…`, `pay_…`, `plink_…`); no card
  data enters our DB or the `AgentContext`.

---

## 2. Prerequisites / requirements

| Requirement | Notes |
|---|---|
| Razorpay account in **Test Mode** | Dashboard has a Test/Live toggle (top bar). All setup below is done in Test Mode. |
| **Test API keys** | Dashboard → Settings → API Keys → *Generate Test Key*. Gives `rzp_test_…` key id + secret (secret shown once). |
| **Subscriptions enabled** | Dashboard → Subscriptions. If not visible, enable the Subscriptions product for the account. |
| **Payment Links enabled** | Dashboard → Payment Links (on by default for most accounts). |
| A public tunnel to `localhost:4000` | Razorpay webhooks require a public HTTPS URL. **`ngrok.io`, `webhook.site`, `requestbin.com` are blacklisted by Razorpay.** Use **`zrok`** or **`cloudflared`** (see §4.4). |
| ~~`razorpay` Node SDK~~ | **Not needed** — `client.ts` calls the Razorpay REST API via global `fetch`. No new dependency. |
| Node 18+ | For global `fetch` and `node:crypto` `createHmac` used in signature verification. |
| Local Postgres | Already provided by `docker compose up -d`. One **additive** migration is required (§6). |

---

## 3. Environment variables

Add to `apps/api/.env.example` (and fill real values in `apps/api/.env`). Read them
through a new lazy-singleton helper `apps/api/src/razorpay/config.ts`, mirroring the
`getClient()` pattern in `apps/api/src/agent/index.ts:24` (throw only when
`PROVIDER=razorpay` and a key is missing — never at import time, so the Simulator
path and `pnpm test` are unaffected).

```dotenv
# --- provider selection ---
PROVIDER=simulator                         # simulator (default) | razorpay

# --- Razorpay test mode (only needed when PROVIDER=razorpay) ---
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx     # basic-auth username for api.razorpay.com
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxx  # basic-auth password (shown once on creation)
RAZORPAY_WEBHOOK_SECRET=whsec_local_dev     # arbitrary string; must match the Dashboard webhook secret
RAZORPAY_PLAN_ID=plan_xxxxxxxxxxxxxx        # pre-created test Plan (see §4.3)
PUBLIC_BASE_URL=https://<slug>.share.zrok.io # tunnel origin; used for Payment Link callback_url
```

| Var | Purpose |
|---|---|
| `PROVIDER` | Chooses the `ProviderPort` binding in `apps/api/src/providerPort.ts`. Anything other than `razorpay` → Simulator. |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | HTTP Basic auth against `https://api.razorpay.com/v1`. Also used by the `razorpay` SDK constructor. |
| `RAZORPAY_WEBHOOK_SECRET` | HMAC-SHA256 key for verifying the `X-Razorpay-Signature` header on inbound webhooks. Set the same value on the Dashboard webhook. |
| `RAZORPAY_PLAN_ID` | The Plan that `POST /api/razorpay/subscriptions` links new test subscriptions to. |
| `PUBLIC_BASE_URL` | Tunnel HTTPS origin. Used to build Payment Link `callback_url` and (optionally) as the webhook URL base. Changes every time the tunnel restarts. |

`apps/api/.env.test` **must keep `PROVIDER=simulator`** (or omit it) so `pnpm test`
never calls Razorpay.

`LOG_LEVEL` (`info` default, or `debug`) — `debug` makes `POST /api/webhooks/razorpay`
log the full raw body and every translate decision. Use it when a webhook "does nothing".

> ⚠️ **The API reads `.env` once at process start.** After editing any `.env` value
> — `PROVIDER`, the rotated tunnel URL, keys — fully restart `pnpm dev` / `pnpm dev:api`
> (Ctrl+C, re-run). `tsx watch` hot-reloads source, **not** env.

### Running both apps

`pnpm dev` (root) starts `apps/api` **and** `apps/web` in parallel (Ctrl+C stops both).
`pnpm dev:api` / `pnpm dev:web` still run them individually.

---

## 4. Razorpay dashboard / test-mode setup (step by step)

### 4.1 Switch to Test Mode

Dashboard → toggle **Test Mode** (top-right). Confirm the URL / banner shows test mode.

### 4.2 Generate test API keys

Settings → API Keys → **Generate Test Key**. Copy `Key Id` → `RAZORPAY_KEY_ID`,
`Key Secret` → `RAZORPAY_KEY_SECRET`.

### 4.3 Create a test Plan

Subscriptions → Plans → **Create Plan**:

- Billing frequency: `Monthly`, interval `1`
- Amount: `99900` paise (₹999) — match `subscriptions.amount` conventions (minor units)
- Currency: `INR`

Copy the resulting `plan_…` id → `RAZORPAY_PLAN_ID`.

(Equivalent API call: `POST https://api.razorpay.com/v1/plans` with
`{ period: "monthly", interval: 1, item: { name: "Recovery Demo", amount: 99900, currency: "INR" } }`.)

### 4.4 Start a tunnel

**zrok:**
```bash
zrok share public http://localhost:4000
```
Copy the `https://<slug>.share.zrok.io` URL → `PUBLIC_BASE_URL`.

**cloudflared:**
```bash
cloudflared tunnel --url http://localhost:4000
```
Copy the `https://<random>.trycloudflare.com` URL → `PUBLIC_BASE_URL`.

### 4.5 Create the webhook

Settings → Webhooks → **Add New Webhook**:

- **Webhook URL:** `<PUBLIC_BASE_URL>/api/webhooks/razorpay`
- **Secret:** the same string as `RAZORPAY_WEBHOOK_SECRET`
- **Alert email:** your address
- **Active events** (tick these):
  - `payment.failed`
  - `payment.captured`
  - `subscription.charged`
  - `subscription.pending`
  - `subscription.halted`
  - `subscription.cancelled`
  - `payment_link.paid`
  - `payment_link.expired`

If prompted for an OTP during webhook creation in test mode, the default test OTP is `754081`.

### 4.6 Test cards & forcing outcomes

| Purpose | Card |
|---|---|
| Success (domestic) | `4718 6091 0820 4366` |
| Success (Visa, generic) | `4111 1111 1111 1111` |
| Declined | `4100 2800 0006 0003` |
| Insufficient funds | `4100 2800 0008 0001` |
| Timeout | `4100 2800 0009 0000` |

CVV: any 3 digits. Expiry: any future date. On the checkout success/failure screen,
**explicitly choose "failure"** (or enter an OTP shorter than 4 digits) to get a
real decline. **Test-mode subscription tokens are valid for 3 days only.**

### 4.7 Forcing subsequent charges

For an authenticated subscription, use the Dashboard → open the subscription →
**"Charge this Now"** → choose **Success** or **Failure**. This is how you exercise
`retryPayment()` outcomes without waiting for the real billing date. A failed
charge moves the Razorpay subscription to `pending`; after 4 consecutive failures
it moves to `halted`.

---

## 5. New modules

```
apps/api/src/razorpay/
  config.ts      # lazy env getters: key id/secret, webhook secret, plan id, public base url
  client.ts      # fetch-based Razorpay REST wrapper (customers, subscriptions, charge, payment_links) — no SDK
  adapter.ts     # export const razorpayAdapter: ProviderPort  (retryPayment, sendMessage)
  webhook.ts     # verifySignature(rawBody, sig), translateEvent(rzp, {eventId}) -> ProviderEvent|null, razorpayWebhookHandler
  map.ts         # categoryForRazorpayReason(), SUBSCRIBED_EVENTS
  provision.ts   # provisionRazorpaySubscription() for the demo helper endpoint
  webhook.test.ts
apps/api/src/providerPort.ts
```

### 5.1 `apps/api/src/providerPort.ts` (as shipped)

The adapter's config and client are lazy (no I/O, no env reads at import), so a
plain static import is safe — no dynamic `require`/`import` needed:

```ts
import type { ProviderPort } from "./simulator/port.js";
import { simulatorAdapter } from "./simulator/index.js";
import { razorpayAdapter } from "./razorpay/adapter.js";

export const provider: ProviderPort =
  process.env.PROVIDER === "razorpay" ? razorpayAdapter : simulatorAdapter;
```

Then in `apps/api/src/execution/index.ts` and `apps/api/src/interaction/index.ts`:

```diff
- import { simulatorAdapter } from "../simulator/index.js";
+ import { provider } from "../providerPort.js";
...
- const result = await simulatorAdapter.retryPayment({ ... });
+ const result = await provider.retryPayment({ ... });
```

(`execution/index.ts:3,36`; `interaction/index.ts:3,37`.)

### 5.2 `retryPayment({ subscriptionId, amount, paymentMethodId })`

1. Load the local `subscriptions` row; read `provider_ref` (the Razorpay `sub_…` id).
2. Issue a recurring charge on that subscription (test mode: this is what the
   Dashboard "Charge this Now" triggers; via API it is a recurring
   `POST /v1/payments` using the subscription's stored token, or the
   subscription-charge endpoint).
3. Razorpay processes **asynchronously**. Return
   `{ success: <sync ack>, paymentId: <pay_… id> }` — the **authoritative**
   success/failure signal arrives later as a `payment.captured` /
   `subscription.charged` / `payment.failed` webhook, which flows through
   `POST /api/webhooks/razorpay` → `ingestEvent()` exactly as the Simulator's
   `setTimeout(... ingestEvent("payment.success"))` does today
   (`apps/api/src/simulator/index.ts:114`).
4. On HTTP/network error, throw — `execute()` already treats a thrown error as an
   infra failure that does **not** consume the retry budget
   (`apps/api/src/execution/index.ts:46`).

> **Design note:** because the real outcome is asynchronous, `retryPayment` should
> return `success: false`-with-no-throw only when Razorpay *synchronously* rejects
> the charge request; otherwise return `success: true` optimistically and let the
> webhook drive the case. The Orchestrator already re-enters `EVALUATING` on the
> webhook, so a later `payment.failed` is handled cleanly.

### 5.3 `sendMessage({ recoveryCaseId, subscriptionId, kind, channel, template })`

1. `POST https://api.razorpay.com/v1/payment_links` with:
   - `amount`, `currency: "INR"` (the failed invoice amount)
   - `reference_id: recoveryCaseId`  ← the correlation key
   - `description: template`
   - `notify: { sms: true, email: true }`
   - `callback_url: ${PUBLIC_BASE_URL}/health` (any 200 page; the webhook is what matters)
   - `notes: { kind, subscription_id: subscriptionId }`
2. Persist the mapping `plink_… → { recoveryCaseId, kind }` (either an in-memory
   `Map` like `simulator/scenario.ts`, or a small `outreach.provider_ref` column —
   the doc recommends reusing the existing `outreach` row and storing `plink_…`
   in a new nullable `outreach.provider_ref` if you want restart-safety).
3. Return `{ delivered: true }` on 2xx (optimistic — see §11).

---

## 6. Data model / ID mapping

The schema has **no** `razorpay_*` columns; provider-shaped ids are stored directly
in `text` columns (`subscriptions.id`, `payments.id`, `subscriptions.payment_method_id`).
There is no `order_id`.

**Recommended: one additive migration.** Add to `apps/api/src/db/schema.ts`
`subscriptions`:

```ts
provider:    text("provider").notNull().default("simulator"), // simulator | razorpay
providerRef: text("provider_ref"),                            // Razorpay sub_… id (nullable)
```

Generate and apply:

```bash
pnpm --filter @recovery/api db:generate   # writes src/db/migrations/0001_*.sql
pnpm db:migrate
```

This is purely additive (nullable column + defaulted column) — no data migration,
existing Simulator rows keep working (`provider = 'simulator'`, `provider_ref = NULL`).

- **Subscription correlation:** webhook payload carries `subscription.entity.id`
  (`sub_…`); look up `subscriptions` by `provider_ref` to get our local id.
- **Payment Link correlation:** webhook payload carries `payment_link.entity.reference_id`
  which we set to `recovery_case_id` — no column needed.
- **Rejected alternative:** storing the Razorpay `sub_…` id directly as
  `subscriptions.id`. Simpler, but mixes id namespaces and makes it impossible to
  run both providers against one DB. Not recommended.

### 6.1 Optional demo helper — `POST /api/razorpay/subscriptions`

Parallel to `POST /api/simulator/scenarios` (`apps/api/src/api/routes.ts:119`).
Behind `requireAuth`. Body: `{ customer_id?, amount? }`. Does:

1. `POST /v1/customers` (test) → `cust_…`
2. `POST /v1/subscriptions` with `plan_id = RAZORPAY_PLAN_ID`, `total_count: 12`,
   `customer_notify: 1` → `sub_…` + `short_url`
3. Insert a local `subscriptions` row: `id = <our id>`, `provider = 'razorpay'`,
   `provider_ref = sub_…`, `payment_method_id = 'pending'`, `amount`, etc.
4. Respond `201 { subscription_id, razorpay_subscription_id, short_url }`

The operator opens `short_url`, pays with a **success** test card to authenticate,
then uses **"Charge this Now → Fail"** to produce the first real `payment.failed`.

---

## 7. New endpoint: `POST /api/webhooks/razorpay`

### 7.1 Mounting (in `apps/api/src/server.ts`)

Must be registered **before** the global `express.json()` (line 10) and **outside**
`app.use("/api", requireAuth, router)` (line 14), because:

- HMAC verification needs the **raw** request body ("Do not parse or cast the
  webhook request body" — Razorpay docs).
- Razorpay cannot send our bearer token; **the signature is the authentication.**

```ts
// server.ts — insert between line 9 and line 10
import { razorpayWebhookHandler } from "./razorpay/webhook.js";
app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  razorpayWebhookHandler
);

app.use(express.json()); // existing line 10
```

### 7.2 Handler flow

```
rawBody  = req.body                       // Buffer, thanks to express.raw
sigHdr   = req.header("X-Razorpay-Signature")
eventId  = req.header("X-Razorpay-Event-Id")   // dedup key

expected = crypto.createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
                 .update(rawBody).digest("hex")
if (!timingSafeEqual(expected, sigHdr))  ->  return 400 "invalid_signature"

rzp      = JSON.parse(rawBody.toString())
envelope = await translateEvent(rzp, { eventId })   // -> { event_id, event_type, payload } | null
if (!envelope)  ->  return 200 { status: "ignored" }   // event we don't act on

await ensurePaymentRow(envelope)   // upsert a payments row for payment.failed/success
                                   // (ON CONFLICT (id) DO NOTHING) — FK target for recovery_cases
await ingestEvent(envelope)        // existing intake; dedups on event_id
return 200 <ingestResult>          // { status: "accepted" | "duplicate" }
```

`translateEvent` is async — it resolves the local `subscription_id` from
`subscriptions.provider_ref` and the outreach `kind` from `outreach.provider_ref`.
`ensurePaymentRow` exists because a real Razorpay `pay_…` id has no row in our
`payments` table (the Simulator inserts one in `runScenario`); `createCase` /
`appendFailureToCase` need that FK to resolve.

`ingestEvent()` (`apps/api/src/intake/index.ts:24`) already does
`INSERT ... ON CONFLICT (event_id) DO NOTHING`, so Razorpay's automatic webhook
retries are safe no-ops (invariant #7).

### 7.3 Event translation table (`apps/api/src/razorpay/map.ts`)

| Razorpay event | Internal `event_type` | Internal `payload` |
|---|---|---|
| `subscription.charged` | `payment.success` | `{ payment_id, subscription_id: <local via provider_ref>, amount, currency, method, status:"success", created_at }` from `payload.subscription.entity` + `payload.payment.entity` |
| `subscription.pending` | **`payment.failed`** (the failure trigger) | `{ payment_id: payment.entity.id ?? pay_pending_<eventId>, subscription_id: <local>, amount, currency, method, status:"failed", error_code/description/source/step/reason from payment.entity or generic GATEWAY_ERROR / payment_failed, created_at }`. Creates the case (first failure) or appends `FAILURE_APPENDED`. |
| `subscription.halted` | `payment.failed` (synthetic) | `{ ..., status:"failed", error_code:"GATEWAY_ERROR", error_reason:"subscription_halted" }` → normalizes to `UNKNOWN_DECLINE` |
| `payment.failed` / `payment.captured` (standalone) | *(ignored — `200 {status:"ignored"}`)* | bare payment entity has no resolvable subscription ref; the `subscription.*` events cover both paths |

**Auto-provisioning:** if a `subscription.*` event references a `sub_…` with no local
`subscriptions` mirror row (e.g. the subscription was created in the Razorpay **dashboard**,
not via `POST /api/razorpay/subscriptions`), `webhook.ts` `ensureLocalSubscription()` fetches
the subscription + plan from the Razorpay API (`GET /v1/subscriptions/:id`, `GET /v1/plans/:id`)
and inserts the mirror row on the fly, then proceeds. So dashboard-created subscriptions work
without any manual step.

**One open case per subscription (invariant #6):** if a case is already open for that
subscription, a further `subscription.pending` appends `FAILURE_APPENDED` to it (audit-only, no
new case, no status change). To see a *fresh* case, first drive the current one to a terminal
state or use a different subscription.
| `subscription.cancelled` | `cancellation` | `{ subscription_id: <local> }` |
| `payment_link.paid` | depends on stored `kind` for that `plink_…` / `reference_id`: `REQUEST_PAYMENT_METHOD_UPDATE` → `payment_method_updated`; `REQUEST_CUSTOMER_ACTION` → `customer_action_completed`; `OUTREACH` → `outreach.result` | `payment_method_updated`: `{ subscription_id, payment_method_id: pay_…, updated: true }` • `customer_action_completed`: `{ subscription_id, recovery_case_id: reference_id, completed: true }` • `outreach.result`: `{ outreach_id, subscription_id, recovery_case_id: reference_id, status:"delivered", customer_response:"paid" }` |
| `payment_link.expired` | `outreach.result` | `{ outreach_id, subscription_id, recovery_case_id: reference_id, status:"failed", customer_response: null }` |

These internal `event_type` values are exactly the ones `ProviderEventSchema`
(`packages/shared/src/schemas.ts:139`) and `route()` (`apps/api/src/intake/index.ts:43`)
already accept — **no intake changes**.

---

## 8. Normalizer additions

The current map keys (`insufficient_funds`, `card_expired`, …) in
`packages/shared/src/normalizerMap.ts` are **synthetic**, not real Razorpay codes.
Real Razorpay puts a coarse code in `error.code` (`BAD_REQUEST_ERROR`,
`GATEWAY_ERROR`, …) and the useful detail in **`error.reason`**.

`normalize()` (`apps/api/src/normalizer/index.ts`) already accepts `errorReason` in
`RawFailureFields` but ignores it. Change it to prefer `errorReason` when present,
falling back to `errorCode`:

```ts
export function normalize(f: RawFailureFields): Category {
  return normalizeCategory(f.errorReason ?? f.errorCode);
}
```

Add these entries to `ERROR_CODE_CATEGORY_MAP` (keep the existing synthetic keys —
the Simulator still uses them):

```ts
// --- real Razorpay error.reason values ---
payment_failed:                          "UNKNOWN_DECLINE",
insufficient_funds:                      "SOFT_BALANCE",      // (already present)
payment_frequency_limit_exceeded:        "SOFT_LIMIT",
payment_method_limit_exhausted:          "SOFT_LIMIT",
transaction_limit_exceeded:              "SOFT_LIMIT",
issuer_down:                             "SOFT_TRANSIENT",
gateway_technical_error:                 "SOFT_TRANSIENT",
server_error:                            "SOFT_TRANSIENT",
payment_authentication_failed:           "CUSTOMER_ACTION",
3ds_failed:                              "CUSTOMER_ACTION",
otp_incorrect:                           "CUSTOMER_ACTION",
otp_attempts_exceeded:                   "CUSTOMER_ACTION",
card_expired:                            "PAYMENT_METHOD_INVALID",   // (already present)
expired_card:                            "PAYMENT_METHOD_INVALID",
card_number_incorrect:                   "PAYMENT_METHOD_INVALID",
incorrect_cvc:                           "PAYMENT_METHOD_INVALID",
payment_method_blocked:                  "PAYMENT_METHOD_INVALID",
international_transaction_not_allowed:    "PAYMENT_METHOD_INVALID",
payment_declined_by_bank_due_to_risk:    "FRAUD_RISK",
suspected_fraud:                         "FRAUD_RISK",
subscription_halted:                     "UNKNOWN_DECLINE",
```

Unknown reasons still fall through to `UNKNOWN_DECLINE` (existing behaviour).

---

## 9. Build order (checklist)

1. Add the env keys to `apps/api/.env.example` (done). No SDK to install — `client.ts` uses `fetch`.
2. `apps/api/src/razorpay/config.ts` (lazy singletons) + `client.ts` (SDK + `fetch` wrappers).
3. `apps/api/src/providerPort.ts`; swap the imports in `execution/index.ts:3` and
   `interaction/index.ts:3`. **Run `pnpm test` — must stay green** (defaults to Simulator).
4. `apps/api/src/razorpay/adapter.ts` — `retryPayment` (subscription charge) +
   `sendMessage` (Payment Link).
5. Additive migration: add `provider` / `provider_ref` to `subscriptions` in
   `schema.ts`; `pnpm --filter @recovery/api db:generate`; `pnpm db:migrate`.
6. `apps/api/src/razorpay/webhook.ts` (`verifySignature` + handler) and
   `apps/api/src/razorpay/map.ts` (translation table §7.3).
7. Mount `POST /api/webhooks/razorpay` in `server.ts` with `express.raw(...)`,
   **before** `express.json()`, **outside** `requireAuth`.
8. Normalizer: prefer `errorReason`; add the map entries from §8.
9. (Optional) `POST /api/razorpay/subscriptions` demo helper in `routes.ts`.
10. `pnpm typecheck && pnpm build`.

---

## 10. End-to-end verification walkthrough

### 10.1 Regression (Simulator still default)

```bash
pnpm test          # PROVIDER unset -> simulator; all existing tests pass
pnpm typecheck
```

### 10.2 Razorpay test-mode happy path

1. `docker compose up -d`
2. `apps/api/.env`: `PROVIDER=razorpay`, test keys, `RAZORPAY_PLAN_ID`, `RAZORPAY_WEBHOOK_SECRET`.
3. Start tunnel (`zrok share public http://localhost:4000`); set `PUBLIC_BASE_URL`.
4. Create/confirm the Dashboard webhook points at `<PUBLIC_BASE_URL>/api/webhooks/razorpay`
   with the matching secret and the 8 events from §4.5.
5. `pnpm dev:api`
6. Provision a subscription:
   ```bash
   curl -X POST http://localhost:4000/api/razorpay/subscriptions \
     -H "Authorization: Bearer dev-local-token" -H "Content-Type: application/json" \
     -d '{"customer_id":"cust_demo","amount":99900}'
   ```
   Open the returned `short_url`, pay with **`4111 1111 1111 1111`** (success) to authenticate.
7. Dashboard → the subscription → **Charge this Now → Failure**.
   - Expect: `POST /api/webhooks/razorpay` 200 (signature verified)
   - `select * from ingested_events` → a `payment.failed` row
   - `select * from recovery_cases` → a new open case, `category` per the error reason
   - `select * from audit_events` → `FAILURE_RECEIVED`, `AGENT_DECISION`, `POLICY_CHECK`, …
8. Wait for the `due_actions` sweep (or `POST /api/recovery-cases/:id/reevaluate`).
   When the Orchestrator schedules `RETRY_PAYMENT` and `execute()` calls
   `provider().retryPayment()`, go to Dashboard → **Charge this Now → Success**.
   - Expect: `subscription.charged` webhook → internal `payment.success` →
     `handlePaymentSuccess` → case → `RECOVERED`, audit `PAYMENT_OUTCOME` + `RECOVERED`.

### 10.3 Outreach / Payment Link path

1. Provision another subscription; force a `payment.failed` whose reason maps to
   `PAYMENT_METHOD_INVALID` (e.g. card `4100 2800 0006 0003`).
2. When the Orchestrator emits `REQUEST_PAYMENT_METHOD_UPDATE`, `sendMessage()`
   creates a Payment Link — verify in Dashboard → Payment Links (its `reference_id`
   equals the `recovery_cases.id`).
3. Pay that link with a success test card.
   - Expect: `payment_link.paid` webhook → internal `payment_method_updated {updated:true}`
     → `handleCustomerSignal` → case leaves `PAYMENT_METHOD_UPDATE_PENDING`.

### 10.4 Negative tests

- `curl -X POST http://localhost:4000/api/webhooks/razorpay -H 'X-Razorpay-Signature: deadbeef' -H 'Content-Type: application/json' -d '{"event":"payment.failed"}'`
  → **400**, nothing written to `ingested_events`.
- Re-deliver the same webhook (same `X-Razorpay-Event-Id`) from the Dashboard
  → second call returns `{ status: "duplicate"|"accepted" }` but **no** second
  case / audit row (dedup).
- `PROVIDER=simulator pnpm test` → still green.

---

## 11. Risks & limitations

| # | Risk | Mitigation / note |
|---|---|---|
| 1 | Test-mode subscription tokens expire after **3 days** | Long-lived demo cases need re-authentication; provision fresh subscriptions per demo session. |
| 2 | Razorpay runs its **own** native retry loop | We translate `subscription.pending` to an internal `payment.failed` (the recovery-case trigger) but do **not** mirror Razorpay's retry schedule — our Orchestrator owns retry timing. A demo operator should drive charges only via "Charge this Now", not also wait for Razorpay's native retry, to avoid double-charging. |
| 3 | `sendMessage` "delivered" is **optimistic** | A created Payment Link ≠ customer saw it. Real customer response only arrives on `payment_link.paid`. Matches the Simulator's `{delivered:true}` contract, so no downstream code changes. |
| 4 | Tunnel URL changes on every restart | `PUBLIC_BASE_URL` **and** the Dashboard webhook URL must be updated each time. Consider a reserved zrok/cloudflared subdomain. |
| 5 | `retryPayment` outcome is asynchronous | The adapter returns before the real result; the webhook is authoritative. The Orchestrator already re-enters `EVALUATING` on `payment.failed`, so this is safe, but time-to-recovery metrics reflect webhook latency. |
| 6 | No production hardening | No webhook timestamp/replay window, no key rotation, no rate limiting. Test-mode demo only — consistent with the repo's "single shared bearer token, not a real auth system" stance (Phase 3 §6). |
| 7 | `express.raw` ordering | If the webhook route is accidentally mounted after `express.json()`, `req.body` becomes a parsed object and every signature check fails. Keep it first (§7.1). |
| 8 | Real Razorpay `error.reason` strings vary by method/bank | The §8 map is best-effort; unmapped reasons fall to `UNKNOWN_DECLINE`. Log unmapped reasons to refine the map over time. |

---

## 12. Reference — current code touchpoints

| Path | Role |
|---|---|
| `apps/api/src/simulator/port.ts` | `ProviderPort` contract the new adapter implements (unchanged) |
| `apps/api/src/simulator/index.ts` | `simulatorAdapter` + `runScenario`; async-outcome→`ingestEvent` pattern to mirror |
| `apps/api/src/intake/index.ts` | `ingestEvent()` + dedup + `route()` — reused unchanged by the webhook |
| `apps/api/src/execution/index.ts` | `retryPayment` call site (line 36) — repoint import |
| `apps/api/src/interaction/index.ts` | `sendMessage` call site (line 37) — repoint import |
| `apps/api/src/agent/index.ts` | `getClient()` lazy-singleton pattern to copy for `razorpay/config.ts` |
| `apps/api/src/server.ts` | mount raw-body webhook before `express.json()` (line 10), outside `requireAuth` (line 14) |
| `apps/api/src/api/routes.ts` | `POST /api/simulator/scenarios` (line 119) — template for the optional demo helper |
| `packages/shared/src/schemas.ts` | `ProviderEventSchema` (line 139) — internal envelope, unchanged |
| `packages/shared/src/normalizerMap.ts` | `ERROR_CODE_CATEGORY_MAP` — add real Razorpay reasons |
| `apps/api/src/db/schema.ts` | `subscriptions` table (line 15) — additive `provider` / `provider_ref` |
| `apps/api/drizzle.config.ts` / `apps/api/src/db/migrate.ts` | migration generate/apply flow |
| `apps/api/.env.example` | new env keys |
