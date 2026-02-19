import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import React from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (config: { component: React.ComponentType }) => ({
    component: config.component,
    useParams: () => ({ agentId: "agent-1" }),
  }),
}));

vi.mock("@/hooks/useAbilities", () => ({
  useAgentSkillRatings: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useAgentSkillRatingTrends: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
}));

vi.mock("@/hooks/useFeedback", () => ({
  useFeedbackStats: () => ({ data: { positive: 0, negative: 0 }, isLoading: false, isFetching: false, error: null }),
  useFeedbackMonthly: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  usePersonalityAdjustments: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useTraitState: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
}));

vi.mock("@/hooks/useMemory", () => ({
  useMemoryQualityTimeseries: () => ({ data: [], isLoading: false, isFetching: false, error: null }),
  useRetrievalTuningStatus: () => ({ data: undefined, isLoading: false, isFetching: false, error: null }),
}));

vi.mock("@/components/ui/chart-sentiment-feedback", () => ({ SentimentFeedback: () => <div>SentimentFeedback</div> }));
vi.mock("@/components/ui/chart-core-skill-performance", () => ({ CoreSkillPerformance: () => <div>CoreSkillPerformance</div> }));
vi.mock("@/components/ui/chart-memory-hit-nohit", () => ({ ChartMemoryHitNoHit: () => <div>ChartMemoryHitNoHit</div> }));
vi.mock("@/components/ui/chart-memory-quality-lines", () => ({ ChartMemoryQualityLines: () => <div>ChartMemoryQualityLines</div> }));
vi.mock("@/components/ui/chart-source-mix-bars", () => ({ ChartSourceMixBars: () => <div>ChartSourceMixBars</div> }));
vi.mock("@/components/ui/chart-confidence-coverage", () => ({ ChartConfidenceCoverage: () => <div>ChartConfidenceCoverage</div> }));
vi.mock("@/components/ui/chart-guardrail-outcomes", () => ({ ChartGuardrailOutcomes: () => <div>ChartGuardrailOutcomes</div> }));
vi.mock("@/components/ui/chart-skill-trend-area", () => ({ ChartSkillTrendArea: () => <div>ChartSkillTrendArea</div> }));
vi.mock("@/components/ui/chart-trait-state-radar", () => ({ ChartTraitStateRadar: () => <div>ChartTraitStateRadar</div> }));
vi.mock("@/components/agent/personality-evolution", () => ({ PersonalityEvolution: () => <div>PersonalityEvolution</div> }));
vi.mock("@/components/agent/orchestration-panel", () => ({ OrchestrationPanel: () => <div>OrchestrationPanel</div> }));

import { Route } from "./$agentId.dashboard";

describe("dashboard route runtime", () => {
  it("renders dashboard cards with route + hook wiring", () => {
    const DashboardComponent = (Route as unknown as { component: React.ComponentType }).component;
    render(<DashboardComponent />);

    expect(screen.getByText("ChartSourceMixBars")).toBeInTheDocument();
    expect(screen.getByText("ChartConfidenceCoverage")).toBeInTheDocument();
    expect(screen.getByText("ChartGuardrailOutcomes")).toBeInTheDocument();
    expect(screen.getByText("PersonalityEvolution")).toBeInTheDocument();
    expect(screen.getByText("OrchestrationPanel")).toBeInTheDocument();
  });
});
