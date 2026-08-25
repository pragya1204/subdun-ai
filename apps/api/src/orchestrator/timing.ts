import type { TimingStrategy } from "@recovery/shared";

/** Pure function: timing strategy -> absolute due timestamp. */
export function computeDueAt(
  strategy: TimingStrategy,
  now: Date,
  nextBillingDate: string | null
): Date {
  const due = new Date(now);
  switch (strategy) {
    case "WAIT_6H":
      due.setHours(due.getHours() + 6);
      return due;
    case "WAIT_24H":
      due.setHours(due.getHours() + 24);
      return due;
    case "WAIT_72H":
      due.setHours(due.getHours() + 72);
      return due;
    case "NEXT_PAYDAY":
      return nextBillingDate ? new Date(nextBillingDate) : due;
    case "IMMEDIATE":
      return now;
    default:
      return due;
  }
}

const COMMUNICATION_WINDOW = { startHour: 9, endHour: 19 };

/** If outside the 09:00-19:00 window, defer to the next window open. */
export function nextCommunicationWindow(now: Date): Date {
  const hour = now.getHours();
  if (hour >= COMMUNICATION_WINDOW.startHour && hour < COMMUNICATION_WINDOW.endHour) {
    return now;
  }
  const next = new Date(now);
  if (hour >= COMMUNICATION_WINDOW.endHour) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(COMMUNICATION_WINDOW.startHour, 0, 0, 0);
  return next;
}
