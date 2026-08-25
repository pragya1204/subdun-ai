const COLORS: Record<string, string> = {
  SOFT_BALANCE: "bg-amber-100 text-amber-800",
  SOFT_LIMIT: "bg-amber-100 text-amber-800",
  SOFT_TRANSIENT: "bg-blue-100 text-blue-800",
  CUSTOMER_ACTION: "bg-purple-100 text-purple-800",
  PAYMENT_METHOD_INVALID: "bg-orange-100 text-orange-800",
  FRAUD_RISK: "bg-red-100 text-red-800",
  UNKNOWN_DECLINE: "bg-slate-200 text-slate-800",
};

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${COLORS[category] ?? "bg-slate-100"}`}>
      {category}
    </span>
  );
}
