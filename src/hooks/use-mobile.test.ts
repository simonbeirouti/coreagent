import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

function setupMatchMedia() {
  const listeners = new Set<() => void>();
  let width = 1024;

  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => width,
  });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: width < 768,
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    })),
  });

  return {
    setWidth(nextWidth: number) {
      width = nextWidth;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe("useIsMobile", () => {
  it("tracks viewport width changes around breakpoint", async () => {
    const media = setupMatchMedia();
    const { result } = renderHook(() => useIsMobile());

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    media.setWidth(600);
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });
});
