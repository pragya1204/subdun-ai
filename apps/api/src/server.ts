import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./api/routes.js";
import { requireAuth } from "./api/auth.js";
import { razorpayWebhookHandler } from "./razorpay/webhook.js";
import { sweepDueActions, sweepExhaustion } from "./orchestrator/index.js";
import { logger } from "./log.js";

const log = logger("server");
const app = express();
app.use(cors());

// Request tracing: method path -> status (ms) for every request.
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

// Razorpay webhook: raw body for HMAC verification, no bearer auth (the signature IS the auth).
// Must be registered BEFORE express.json().
app.post(
  "/api/webhooks/razorpay",
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    razorpayWebhookHandler(req, res).catch(next);
  }
);

app.use(express.json());

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.use("/api", requireAuth, router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  log.error("unhandled error", err instanceof Error ? `${err.message}\n${err.stack}` : err);
  res.status(500).json({ error: "internal_error" });
});

const PORT = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV !== "test") {
  const provider = process.env.PROVIDER === "razorpay" ? "razorpay" : "simulator";
  log("startup config", {
    provider,
    log_level: process.env.LOG_LEVEL ?? "info",
    public_base_url: process.env.PUBLIC_BASE_URL ?? null,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID
      ? `${process.env.RAZORPAY_KEY_ID.slice(0, 12)}…`
      : null,
    razorpay_webhook_secret_set: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    razorpay_plan_id: process.env.RAZORPAY_PLAN_ID ?? null,
  });
  if (provider === "razorpay") {
    const missing = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "RAZORPAY_PLAN_ID"].filter(
      (k) => !process.env[k]
    );
    if (missing.length) log.warn(`PROVIDER=razorpay but missing env: ${missing.join(", ")}`);
  }

  app.listen(PORT, () => {
    log(`Recovery API listening on :${PORT}`);
  });

  const dueActionsIntervalMs = Number(process.env.DUE_ACTIONS_POLL_MS ?? 60_000);
  const exhaustionIntervalMs = Number(process.env.EXHAUSTION_SWEEP_MS ?? 300_000);

  setInterval(() => {
    sweepDueActions().catch((err) => log.error("sweepDueActions failed", err));
  }, dueActionsIntervalMs);

  setInterval(() => {
    sweepExhaustion().catch((err) => log.error("sweepExhaustion failed", err));
  }, exhaustionIntervalMs);
}

export { app };
