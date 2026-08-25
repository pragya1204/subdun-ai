import type { AuditEvent } from "../api/client.js";

export function Timeline({ events }: { events: AuditEvent[] }) {
  return (
    <ol className="space-y-3">
      {events.map((e) => (
        <li key={e.id} className="rounded border bg-white p-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs font-semibold text-slate-700">{e.eventType}</span>
            <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-600">
            {JSON.stringify(e.payload, null, 2)}
          </pre>
        </li>
      ))}
      {events.length === 0 && <p className="text-sm text-slate-500">No events yet.</p>}
    </ol>
  );
}
