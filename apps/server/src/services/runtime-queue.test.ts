import { describe, expect, it } from "vitest";

import { computeAutoscalingRecommendation } from "./runtime-queue.js";

describe("computeAutoscalingRecommendation", () => {
  it("respects minimum replicas when demand is low", () => {
    const recommended = computeAutoscalingRecommendation({
      queuedJobs: 0,
      activeJobs: 1,
      minReplicas: 2,
      maxReplicas: 10,
      targetConcurrencyPerReplica: 4
    });

    expect(recommended).toBe(2);
  });

  it("scales up by queue+active demand and target concurrency", () => {
    const recommended = computeAutoscalingRecommendation({
      queuedJobs: 9,
      activeJobs: 3,
      minReplicas: 1,
      maxReplicas: 10,
      targetConcurrencyPerReplica: 4
    });

    expect(recommended).toBe(3);
  });

  it("caps at max replicas when pressure is high", () => {
    const recommended = computeAutoscalingRecommendation({
      queuedJobs: 100,
      activeJobs: 20,
      minReplicas: 1,
      maxReplicas: 8,
      targetConcurrencyPerReplica: 4
    });

    expect(recommended).toBe(8);
  });
});
