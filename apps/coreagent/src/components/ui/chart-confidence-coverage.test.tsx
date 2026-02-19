import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChartConfidenceCoverage } from "./chart-confidence-coverage";

describe("ChartConfidenceCoverage", () => {
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

  it("renders loading and no-shape states", () => {
    const { rerender } = render(<ChartConfidenceCoverage isLoading />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(<ChartConfidenceCoverage />);
    expect(
      screen.getByText("Confidence coverage metrics are not available in the current payload yet.")
    ).toBeInTheDocument();
  });

  it("renders error state when payload is missing", () => {
    render(<ChartConfidenceCoverage errorMessage="boom" />);
    expect(screen.getByText("Unable to load confidence coverage right now.")).toBeInTheDocument();
  });

  it("renders below-target summary text from shaped payload", () => {
    render(
      <ChartConfidenceCoverage
        tuningStatus={
          {
            quality: {
              confidence_target: 0.8,
              confidence_scored_sample_size: 10,
              confidence_above_target_count: 6,
              confidence_above_target_ratio: 0.6,
            },
          } as never
        }
      />
    );

    expect(screen.getByText("10 scored - target 80%")).toBeInTheDocument();
    expect(screen.getByText("Coverage is below target.")).toBeInTheDocument();
    expect(screen.getByText(/6 of 10 scored/i)).toBeInTheDocument();
  });

  it("shows updating state while fetch is in flight", () => {
    render(
      <ChartConfidenceCoverage
        isFetching
        tuningStatus={
          {
            quality: {
              confidence_target: 0.8,
              confidence_scored_sample_size: 10,
              confidence_above_target_count: 9,
              confidence_above_target_ratio: 0.9,
            },
          } as never
        }
      />
    );

    expect(screen.getByText("Updating...")).toBeInTheDocument();
    expect(screen.getByText("Coverage is meeting target.")).toBeInTheDocument();
  });
});
