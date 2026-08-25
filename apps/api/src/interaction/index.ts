import { eq } from "drizzle-orm";
import { outreach, recoveryCases } from "../db/schema.js";
import { simulatorAdapter } from "../simulator/index.js";

export type InteractionKind = "OUTREACH" | "REQUEST_PAYMENT_METHOD_UPDATE" | "REQUEST_CUSTOMER_ACTION";

const TEMPLATES: Record<InteractionKind, string> = {
  OUTREACH: "payment_failed_outreach",
  REQUEST_PAYMENT_METHOD_UPDATE: "update_payment_method",
  REQUEST_CUSTOMER_ACTION: "complete_required_action",
};

/**
 * Sends an approved customer-facing message. Channel/template chosen
 * deterministically, never by the Agent. Merged Outreach + PMU + CustomerAction
 * per Phase 2 §2 merge rationale — they share one budget/cooldown.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function send(caseId: string, kind: InteractionKind, tx: any) {
  const kase = await tx.query.recoveryCases.findFirst({ where: eq(recoveryCases.id, caseId) });
  if (!kase) throw new Error(`Recovery case ${caseId} not found`);

  const channel = "sms";
  const template = TEMPLATES[kind];

  const [record] = await tx
    .insert(outreach)
    .values({
      recoveryCaseId: caseId,
      kind,
      channel,
      template,
      status: "sent",
    })
    .returning();

  const result = await simulatorAdapter.sendMessage({
    recoveryCaseId: caseId,
    subscriptionId: kase.subscriptionId,
    kind,
    channel,
    template,
  });

  await tx
    .update(outreach)
    .set({ status: result.delivered ? "delivered" : "failed" })
    .where(eq(outreach.id, record.id));

  return { ...record, status: result.delivered ? "delivered" : "failed" };
}
