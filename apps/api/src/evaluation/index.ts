import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { recoveryCases, auditEvents, payments } from "../db/schema.js";

export interface Metrics {
  recovery_rate: number;
  revenue_recovered: number;
  time_to_recovery_avg_hours: number | null;
  escalation_rate: number;
  total_cases: number;
  terminal_cases: number;
  outreach_rate: number;
  exhausted_count: number;
}

/** Read-only. Cannot write anywhere — structurally cannot influence recovery decisions. */
export async function getMetrics(): Promise<Metrics> {
  const allCases = await db.select().from(recoveryCases);
  const totalCases = allCases.length;
  const terminalStatuses = ["RECOVERED", "ESCALATED", "EXHAUSTED", "STOPPED"];
  const terminalCases = allCases.filter((c) => terminalStatuses.includes(c.status));
  const recovered = allCases.filter((c) => c.status === "RECOVERED");
  const escalated = allCases.filter((c) => c.status === "ESCALATED");
  const exhausted = allCases.filter((c) => c.status === "EXHAUSTED");
  const withOutreach = allCases.filter((c) => c.outreachUsed > 0);

  let revenueRecovered = 0;
  const recoveryDurationsHours: number[] = [];

  for (const c of recovered) {
    const events = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.recoveryCaseId, c.id));
    const outcome = events.find((e) => e.eventType === "PAYMENT_OUTCOME");
    const paymentId = (outcome?.payload as Record<string, unknown> | undefined)?.payment_id as
      | string
      | undefined;
    if (paymentId) {
      const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
      if (p) revenueRecovered += p.amount;
    }
    const recoveredEvent = events.find((e) => e.eventType === "RECOVERED") ?? outcome;
    if (recoveredEvent) {
      const hours = (recoveredEvent.createdAt.getTime() - c.startedAt.getTime()) / 3_600_000;
      recoveryDurationsHours.push(hours);
    }
  }

  return {
    recovery_rate: totalCases ? recovered.length / totalCases : 0,
    revenue_recovered: revenueRecovered,
    time_to_recovery_avg_hours: recoveryDurationsHours.length
      ? recoveryDurationsHours.reduce((a, b) => a + b, 0) / recoveryDurationsHours.length
      : null,
    escalation_rate: totalCases ? escalated.length / totalCases : 0,
    total_cases: totalCases,
    terminal_cases: terminalCases.length,
    outreach_rate: totalCases ? withOutreach.length / totalCases : 0,
    exhausted_count: exhausted.length,
  };
}
