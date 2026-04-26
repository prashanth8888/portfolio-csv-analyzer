import React from "react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverMock {
  observe() {}

  unobserve() {}

  disconnect() {}
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");

  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", { "data-testid": "mock-responsive-container" }, children)
  };
});
