import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./api/routes.js";
import { requireAuth } from "./api/auth.js";
import { sweepDueActions, sweepExhaustion } from "./orchestrator/index.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.status(200).json({ ok: true }));

app.use("/api", requireAuth, router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "internal_error" });
});

const PORT = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Recovery API listening on :${PORT}`);
  });

  const dueActionsIntervalMs = Number(process.env.DUE_ACTIONS_POLL_MS ?? 60_000);
  const exhaustionIntervalMs = Number(process.env.EXHAUSTION_SWEEP_MS ?? 300_000);

  setInterval(() => {
    sweepDueActions().catch((err) => console.error("sweepDueActions failed", err));
  }, dueActionsIntervalMs);

  setInterval(() => {
    sweepExhaustion().catch((err) => console.error("sweepExhaustion failed", err));
  }, exhaustionIntervalMs);
}

export { app };
