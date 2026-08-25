import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { CategoryBadge } from "../components/CategoryBadge.js";
import { StatusBadge } from "../components/StatusBadge.js";

export default function CaseList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["cases"],
    queryFn: () => api.listCases(),
  });

  if (isLoading) return <p className="text-slate-500">Loading…</p>;
  if (error) return <p className="text-red-600">Failed to load cases.</p>;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">Recovery Cases</h1>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Retries</th>
              <th className="px-3 py-2">Outreach</th>
              <th className="px-3 py-2">Deadline</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((c) => (
              <tr key={c.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2">
                  <Link to={`/cases/${c.id}`} className="text-sky-700 hover:underline">
                    {c.subscription_id}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <CategoryBadge category={c.category} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2">{c.retries_used}</td>
                <td className="px-3 py-2">{c.outreach_used}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {new Date(c.deadline).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.length === 0 && <p className="p-4 text-sm text-slate-500">No cases yet — run a scenario.</p>}
      </div>
    </div>
  );
}
