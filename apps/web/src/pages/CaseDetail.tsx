import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { CategoryBadge } from "../components/CategoryBadge.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { Timeline } from "../components/Timeline.js";

export default function CaseDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["case", id],
    queryFn: () => api.getCase(id!),
    enabled: !!id,
  });

  const reevaluate = useMutation({
    mutationFn: () => api.reevaluate(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["case", id] }),
  });

  const override = useMutation({
    mutationFn: (outcome: "RECOVERED" | "STOPPED") => api.manualOverride(id!, outcome, "ops-console"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["case", id] }),
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data) return <p className="text-red-600">Case not found.</p>;

  const { case: kase, timeline } = data;
  const paymentOutcome = timeline.find((e) => e.eventType === "PAYMENT_OUTCOME");
  const amount = (paymentOutcome?.payload as { payment_id?: string } | undefined)?.payment_id;

  return (
    <div className="space-y-6">
      <div className="rounded border bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{kase.subscriptionId}</h1>
          <CategoryBadge category={kase.category} />
          <StatusBadge status={kase.status} />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-slate-500">Retries used</dt>
            <dd>{kase.retriesUsed} / 2</dd>
          </div>
          <div>
            <dt className="text-slate-500">Outreach used</dt>
            <dd>{kase.outreachUsed} / 3</dd>
          </div>
          <div>
            <dt className="text-slate-500">Opted out</dt>
            <dd>{kase.optedOut ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Complaint</dt>
            <dd>{kase.complaint ? "yes" : "no"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Started</dt>
            <dd>{new Date(kase.startedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Deadline</dt>
            <dd>{new Date(kase.deadline).toLocaleString()}</dd>
          </div>
          {amount && (
            <div>
              <dt className="text-slate-500">Recovered payment</dt>
              <dd>{amount}</dd>
            </div>
          )}
        </dl>
        <div className="mt-4 flex gap-2">
          <button
            onClick={() => reevaluate.mutate()}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            disabled={reevaluate.isPending}
          >
            Force re-evaluate
          </button>
          {kase.status === "ESCALATED" && (
            <>
              <button
                onClick={() => override.mutate("RECOVERED")}
                className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                Mark recovered
              </button>
              <button
                onClick={() => override.mutate("STOPPED")}
                className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
              >
                Stop
              </button>
            </>
          )}
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Audit Timeline</h2>
        <Timeline events={timeline} />
      </div>
    </div>
  );
}
