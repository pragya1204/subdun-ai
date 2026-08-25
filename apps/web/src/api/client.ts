const BEARER_TOKEN = import.meta.env.VITE_API_BEARER_TOKEN ?? "dev-local-token";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BEARER_TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface RecoveryCaseSummary {
  id: string;
  subscription_id: string;
  category: string;
  status: string;
  retries_used: number;
  outreach_used: number;
  started_at: string;
  deadline: string;
}

export interface AuditEvent {
  id: string;
  recoveryCaseId: string;
  subscriptionId: string;
  paymentId: string | null;
  eventType: string;
  payload: unknown;
  createdAt: string;
}

export interface RecoveryCaseDetail {
  case: {
    id: string;
    subscriptionId: string;
    paymentId: string;
    category: string;
    status: string;
    retriesUsed: number;
    outreachUsed: number;
    optedOut: boolean;
    complaint: boolean;
    startedAt: string;
    deadline: string;
  };
  timeline: AuditEvent[];
}

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

export const api = {
  listCases: (params?: { status?: string; category?: string }) => {
    const qs = new URLSearchParams(params as Record<string, string>).toString();
    return request<RecoveryCaseSummary[]>(`/recovery-cases${qs ? `?${qs}` : ""}`);
  },
  getCase: (id: string) => request<RecoveryCaseDetail>(`/recovery-cases/${id}`),
  reevaluate: (id: string) => request(`/recovery-cases/${id}/reevaluate`, { method: "POST", body: "{}" }),
  manualOverride: (id: string, outcome: "RECOVERED" | "STOPPED", humanId: string, note?: string) =>
    request(`/recovery-cases/${id}/manual-override`, {
      method: "POST",
      body: JSON.stringify({ outcome, human_id: humanId, note }),
    }),
  runScenario: (config: Record<string, unknown>) =>
    request<{ subscription_id: string; payment_id: string; recovery_case_id: string | null }>(
      "/simulator/scenarios",
      { method: "POST", body: JSON.stringify(config) }
    ),
  getMetrics: () => request<Metrics>("/evaluation/metrics"),
};
