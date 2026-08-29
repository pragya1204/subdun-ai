import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client.js";

const FAILURE_CODES = [
  "insufficient_funds",
  "limit_exceeded",
  "issuer_unavailable",
  "otp_failed",
  "card_expired",
  "suspected_fraud",
  "some_unmapped_code",
];

export default function ScenarioRunner() {
  const [form, setForm] = useState({
    failure_code: "insufficient_funds",
    failure_behavior: "fail_then_succeed",
    customer_behavior: "responsive",
    payment_method_behavior: "updates",
    customer_action_behavior: "completes",
    would_native_retry_succeed: true,
    amount: 999,
    delay_ms: 0,
  });

  const run = useMutation({
    mutationFn: () => api.runScenario(form),
  });

  const [rzpAmount, setRzpAmount] = useState(99900);
  const rzp = useMutation({
    mutationFn: () => api.createRazorpaySubscription({ amount: rzpAmount }),
  });

  return (
    <div className="max-w-xl">
      <h1 className="mb-4 text-lg font-semibold">Scenario Runner</h1>

      <div className="mb-6 space-y-3 rounded border bg-white p-4">
        <h2 className="text-sm font-semibold">Razorpay test-mode subscription</h2>
        <p className="text-xs text-slate-600">
          Creates a real Razorpay test subscription (requires <code>PROVIDER=razorpay</code>). Open the
          returned link, authenticate with a test card, then use “Charge this Now → Failure” in the
          Razorpay dashboard to start a recovery case.
        </p>
        <Field label="Amount (paise)">
          <input
            type="number"
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={rzpAmount}
            onChange={(e) => setRzpAmount(Number(e.target.value))}
          />
        </Field>
        <button
          type="button"
          className="rounded bg-sky-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={rzp.isPending}
          onClick={() => rzp.mutate()}
        >
          {rzp.isPending ? "Creating…" : "Create Razorpay subscription"}
        </button>

        {rzp.isSuccess && (
          <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm">
            <p className="mb-1">
              Subscription <span className="font-mono text-xs">{rzp.data.razorpay_subscription_id}</span>{" "}
              (local <span className="font-mono text-xs">{rzp.data.subscription_id}</span>)
            </p>
            <a
              href={rzp.data.short_url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-sky-700 underline break-all"
            >
              {rzp.data.short_url}
            </a>
          </div>
        )}
        {rzp.isError && <p className="text-sm text-red-600">{(rzp.error as Error).message}</p>}
      </div>

      <form
        className="space-y-4 rounded border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate();
        }}
      >
        <Field label="Failure code">
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.failure_code}
            onChange={(e) => setForm({ ...form, failure_code: e.target.value })}
          >
            {FAILURE_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Retry behavior">
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.failure_behavior}
            onChange={(e) => setForm({ ...form, failure_behavior: e.target.value })}
          >
            <option value="always_fail">always_fail</option>
            <option value="fail_then_succeed">fail_then_succeed</option>
            <option value="always_succeed">always_succeed</option>
          </select>
        </Field>

        <Field label="Customer behavior">
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.customer_behavior}
            onChange={(e) => setForm({ ...form, customer_behavior: e.target.value })}
          >
            <option value="responsive">responsive</option>
            <option value="unresponsive">unresponsive</option>
            <option value="opts_out">opts_out</option>
            <option value="complains">complains</option>
          </select>
        </Field>

        <Field label="Payment method behavior">
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.payment_method_behavior}
            onChange={(e) => setForm({ ...form, payment_method_behavior: e.target.value })}
          >
            <option value="updates">updates</option>
            <option value="never_updates">never_updates</option>
          </select>
        </Field>

        <Field label="Customer action behavior">
          <select
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.customer_action_behavior}
            onChange={(e) => setForm({ ...form, customer_action_behavior: e.target.value })}
          >
            <option value="completes">completes</option>
            <option value="never_completes">never_completes</option>
          </select>
        </Field>

        <Field label="Amount (paise)">
          <input
            type="number"
            className="w-full rounded border px-2 py-1.5 text-sm"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
          />
        </Field>

        <button
          type="submit"
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={run.isPending}
        >
          {run.isPending ? "Running…" : "Run scenario"}
        </button>
      </form>

      {run.isSuccess && run.data.recovery_case_id && (
        <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
          Created case{" "}
          <Link to={`/cases/${run.data.recovery_case_id}`} className="font-medium text-sky-700 underline">
            {run.data.recovery_case_id}
          </Link>
        </p>
      )}
      {run.isError && <p className="mt-4 text-sm text-red-600">{(run.error as Error).message}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
