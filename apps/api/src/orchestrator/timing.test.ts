import { describe, it, expect } from "vitest";
import { computeDueAt, nextCommunicationWindow } from "./timing.js";

describe("computeDueAt", () => {
  const now = new Date("2026-01-10T10:00:00Z");

  it("WAIT_6H adds 6 hours", () => {
    expect(computeDueAt("WAIT_6H", now, null).toISOString()).toBe("2026-01-10T16:00:00.000Z");
  });
  it("WAIT_24H adds 24 hours", () => {
    expect(computeDueAt("WAIT_24H", now, null).toISOString()).toBe("2026-01-11T10:00:00.000Z");
  });
  it("WAIT_72H adds 72 hours", () => {
    expect(computeDueAt("WAIT_72H", now, null).toISOString()).toBe("2026-01-13T10:00:00.000Z");
  });
  it("NEXT_PAYDAY uses next_billing_date", () => {
    expect(computeDueAt("NEXT_PAYDAY", now, "2026-02-01").toISOString()).toBe(
      new Date("2026-02-01").toISOString()
    );
  });
  it("IMMEDIATE returns now", () => {
    expect(computeDueAt("IMMEDIATE", now, null).toISOString()).toBe(now.toISOString());
  });
});

describe("nextCommunicationWindow", () => {
  it("returns same time when inside window", () => {
    const inside = new Date("2026-01-10T14:00:00");
    expect(nextCommunicationWindow(inside).getTime()).toBe(inside.getTime());
  });

  it("defers to 09:00 same day when before window", () => {
    const early = new Date("2026-01-10T05:00:00");
    const result = nextCommunicationWindow(early);
    expect(result.getHours()).toBe(9);
    expect(result.getDate()).toBe(early.getDate());
  });

  it("defers to 09:00 next day when after window", () => {
    const late = new Date("2026-01-10T20:00:00");
    const result = nextCommunicationWindow(late);
    expect(result.getHours()).toBe(9);
    expect(result.getDate()).toBe(late.getDate() + 1);
  });
});
