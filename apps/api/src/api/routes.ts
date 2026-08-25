import { Router } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import { recoveryCases, auditEvents } from "../db/schema.js";
import { ingestEvent } from "../intake/index.js";
import { evaluate, manualOverride } from "../orchestrator/index.js";
import { runScenario } from "../simulator/index.js";
import { getMetrics } from "../evaluation/index.js";
import {
  ProviderEventSchema,
  ScenarioConfigSchema,
  ManualOverrideRequestSchema,
  isTerminal,
  type CaseStatus,
} from "@recovery/shared";

export const router = Router();

// 1. POST /api/events
router.post("/events", async (req, res) => {
  const parsed = ProviderEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_shape", details: parsed.error.flatten() });
    return;
  }
  const result = await ingestEvent(parsed.data);
  res.status(202).json(result);
});

// 2. GET /api/recovery-cases?status=&category=
router.get("/recovery-cases", async (req, res) => {
  const status = req.query.status as string | undefined;
  const category = req.query.category as string | undefined;

  const conditions = [];
  if (status) conditions.push(eq(recoveryCases.status, status));
  if (category) conditions.push(eq(recoveryCases.category, category));

  const rows = await db
    .select()
    .from(recoveryCases)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(recoveryCases.startedAt));

  res.status(200).json(
    rows.map((r) => ({
      id: r.id,
      subscription_id: r.subscriptionId,
      category: r.category,
      status: r.status,
      retries_used: r.retriesUsed,
      outreach_used: r.outreachUsed,
      started_at: r.startedAt,
      deadline: r.deadline,
    }))
  );
});

// 3. GET /api/recovery-cases/:id
router.get("/recovery-cases/:id", async (req, res) => {
  const kase = await db.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, req.params.id) });
  if (!kase) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const timeline = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.recoveryCaseId, req.params.id))
    .orderBy(auditEvents.createdAt);

  res.status(200).json({ case: kase, timeline });
});

// 4. POST /api/recovery-cases/:id/manual-override
router.post("/recovery-cases/:id/manual-override", async (req, res) => {
  const parsed = ManualOverrideRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_shape", details: parsed.error.flatten() });
    return;
  }
  const existing = await db.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, req.params.id) });
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (existing.status !== "ESCALATED") {
    res.status(409).json({ error: "case_not_escalated" });
    return;
  }
  try {
    const result = await manualOverride(req.params.id, parsed.data.outcome, parsed.data.human_id, parsed.data.note);
    res.status(200).json({ case: result });
  } catch (err) {
    if (err instanceof Error && err.message === "CASE_NOT_ESCALATED") {
      res.status(409).json({ error: "case_not_escalated" });
      return;
    }
    throw err;
  }
});

// 5. POST /api/recovery-cases/:id/reevaluate
router.post("/recovery-cases/:id/reevaluate", async (req, res) => {
  const existing = await db.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, req.params.id) });
  if (!existing) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  if (isTerminal(existing.status as CaseStatus)) {
    res.status(409).json({ error: "case_terminal" });
    return;
  }
  res.status(202).json({ status: "queued" });
  evaluate(req.params.id).catch((err) => console.error("reevaluate failed", err));
});

// 6. POST /api/simulator/scenarios
router.post("/simulator/scenarios", async (req, res) => {
  const parsed = ScenarioConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_scenario", details: parsed.error.flatten() });
    return;
  }
  const { subscriptionId, paymentId } = await runScenario(parsed.data);
  const caseId = await db.query.recoveryCases.findFirst({
    where: eq(recoveryCases.subscriptionId, subscriptionId),
  });
  res.status(201).json({
    subscription_id: subscriptionId,
    payment_id: paymentId,
    recovery_case_id: caseId?.id ?? null,
  });
});

// 7. GET /api/evaluation/metrics
router.get("/evaluation/metrics", async (_req, res) => {
  const metrics = await getMetrics();
  res.status(200).json(metrics);
});
