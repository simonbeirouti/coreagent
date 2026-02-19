import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChartSourceMixBars } from "./chart-source-mix-bars";

describe("ChartSourceMixBars", () => {
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
    const { rerender } = render(<ChartSourceMixBars isLoading />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    rerender(<ChartSourceMixBars />);
    expect(
      screen.getByText("Source-mix metrics are not available in the current payload yet.")
    ).toBeInTheDocument();
  });

  it("renders error state when payload is missing", () => {
    render(<ChartSourceMixBars errorMessage="boom" />);
    expect(screen.getByText("Unable to load source-mix data right now.")).toBeInTheDocument();
  });

  it("renders total signals and empty activity message for shaped zero payload", () => {
    render(
      <ChartSourceMixBars
        tuningStatus={
          {
            quality: {
              source_mix: {
                user_override_count: 0,
                weighted_blend_count: 0,
                agent_only_count: 0,
                heuristic_fallback_count: 0,
              },
            },
          } as never
        }
      />
    );

    expect(screen.getByText("0 total signals")).toBeInTheDocument();
    expect(screen.getByText("No source-mix activity in the active window.")).toBeInTheDocument();
  });

  it("shows updating state while fetching with shaped payload", () => {
    render(
      <ChartSourceMixBars
        isFetching
        tuningStatus={
          {
            quality: {
              source_mix: {
                user_override_count: 2,
                weighted_blend_count: 3,
                agent_only_count: 4,
                heuristic_fallback_count: 1,
              },
            },
          } as never
        }
      />
    );

    expect(screen.getByText("Updating...")).toBeInTheDocument();
  });
});
