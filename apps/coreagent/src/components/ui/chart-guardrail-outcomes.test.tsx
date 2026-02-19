import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChartGuardrailOutcomes } from "./chart-guardrail-outcomes";

describe("ChartGuardrailOutcomes", () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 800,
      height: 400,
      top: 0,
      right: 800,
      bottom: 400,
      left: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });

  afterAll(() => {
    rectSpy.mockRestore();
  });

  it("renders loading and empty states", () => {
    const { rerender } = render(<ChartGuardrailOutcomes isLoading />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(<ChartGuardrailOutcomes />);
    expect(screen.getByText("No guardrail outcome data yet.")).toBeInTheDocument();
  });

  it("renders error state when payload is missing", () => {
    render(<ChartGuardrailOutcomes errorMessage="boom" />);
    expect(screen.getByText("Unable to load guardrail outcomes right now.")).toBeInTheDocument();
  });

  it("renders applied-dominant summary details", () => {
    render(
      <ChartGuardrailOutcomes
        tuningStatus={
          {
            recent_decisions: [
              { status: "applied" },
              { status: "applied" },
              { status: "applied" },
              { status: "skipped" },
            ],
          } as never
        }
      />
    );

    expect(screen.getByText("4 recent")).toBeInTheDocument();
    expect(screen.getByText("Applied outcomes are dominant.")).toBeInTheDocument();
    expect(screen.getByText("3 of 4 decisions were applied.")).toBeInTheDocument();
  });

  it("shows updating state while fetching with existing data", () => {
    render(
      <ChartGuardrailOutcomes
        isFetching
        tuningStatus={
          {
            recent_decisions: [{ status: "skipped" }, { status: "applied" }],
          } as never
        }
      />
    );

    expect(screen.getByText("Updating...")).toBeInTheDocument();
  });
});
