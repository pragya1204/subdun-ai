const COLORS: Record<string, string> = {
  FAILED: "bg-slate-200 text-slate-800",
  EVALUATING: "bg-sky-100 text-sky-800",
  WAITING: "bg-slate-100 text-slate-700",
  RETRYING: "bg-indigo-100 text-indigo-800",
  OUTREACH_PENDING: "bg-purple-100 text-purple-800",
  PAYMENT_METHOD_UPDATE_PENDING: "bg-orange-100 text-orange-800",
  CUSTOMER_ACTION_PENDING: "bg-orange-100 text-orange-800",
  RECOVERED: "bg-emerald-100 text-emerald-800",
  ESCALATED: "bg-red-100 text-red-800",
  EXHAUSTED: "bg-zinc-200 text-zinc-800",
  STOPPED: "bg-zinc-200 text-zinc-800",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${COLORS[status] ?? "bg-slate-100"}`}>
      {status}
    </span>
  );
}
