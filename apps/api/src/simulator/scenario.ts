import type { ScenarioConfig } from "@recovery/shared";

interface ScenarioState extends ScenarioConfig {
  retryAttempts: number;
}

/** Scenario configuration keyed by subscription_id — the only state the Simulator owns. */
const scenarios = new Map<string, ScenarioState>();

export function registerScenario(subscriptionId: string, config: ScenarioConfig): void {
  scenarios.set(subscriptionId, { ...config, retryAttempts: 0 });
}

export function getScenario(subscriptionId: string): ScenarioState | undefined {
  return scenarios.get(subscriptionId);
}

export function recordRetryAttempt(subscriptionId: string): number {
  const s = scenarios.get(subscriptionId);
  if (!s) return 1;
  s.retryAttempts += 1;
  return s.retryAttempts;
}
