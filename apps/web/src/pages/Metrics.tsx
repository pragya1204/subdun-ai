import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client.js";

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-white p-4">
      <p className="text-xs uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

export default function MetricsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["metrics"],
    queryFn: () => api.getMetrics(),
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error || !data) return <p className="text-red-600">Failed to load metrics.</p>;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Evaluation Metrics</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Recovery rate" value={`${(data.recovery_rate * 100).toFixed(1)}%`} />
        <Card label="Revenue recovered" value={`₹${(data.revenue_recovered / 100).toFixed(2)}`} />
        <Card
          label="Avg time to recovery"
          value={data.time_to_recovery_avg_hours !== null ? `${data.time_to_recovery_avg_hours.toFixed(1)}h` : "—"}
        />
        <Card label="Escalation rate" value={`${(data.escalation_rate * 100).toFixed(1)}%`} />
      </div>

      <p className="mb-2 mt-6 text-xs font-semibold uppercase text-slate-400">Nice to have</p>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card label="Total cases" value={String(data.total_cases)} />
        <Card label="Terminal cases" value={String(data.terminal_cases)} />
        <Card label="Outreach rate" value={`${(data.outreach_rate * 100).toFixed(1)}%`} />
        <Card label="Exhausted count" value={String(data.exhausted_count)} />
      </div>
    </div>
  );
}
