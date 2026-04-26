import { afterEach, describe, expect, it, vi } from "vitest";

import { analyzePortfolio } from "./api";

describe("analyzePortfolio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns parsed analysis payloads", async () => {
    const responsePayload = {
      summary: {
        currentValue: 1000,
        costBasis: 700,
        totalGainDollar: 300,
        totalGainPercent: 0.42,
        todayGainDollar: 10
      },
      allocations: {
        bySymbol: [],
        byAccount: [],
        bySecurityType: []
      },
      accounts: [],
      holdings: [],
      topMovers: {
        gainers: [],
        laggards: []
      },
      projections: [],
      warnings: []
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => responsePayload
      }))
    );

    const result = await analyzePortfolio([new File(["csv"], "positions.csv", { type: "text/csv" })]);

    expect(result.summary.currentValue).toBe(1000);
  });

  it("surfaces backend error payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ error: "Upload at least one CSV or PDF file." })
      }))
    );

    await expect(analyzePortfolio([new File(["csv"], "positions.csv", { type: "text/csv" })])).rejects.toThrow(
      "Upload at least one CSV or PDF file."
    );
  });
});
