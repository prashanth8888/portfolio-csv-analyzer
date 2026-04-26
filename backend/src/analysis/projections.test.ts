import { describe, expect, it } from "vitest";

import { buildProjections, buildSp500Benchmark } from "../../../shared/src/analysis.ts";

describe("buildProjections", () => {
  it("adds annual contributions at the end of each projected year", () => {
    const baseline = buildProjections(100, 0).find((point) => point.scenario === "base" && point.years === 2);
    const withContribution = buildProjections(100, 10).find((point) => point.scenario === "base" && point.years === 2);

    expect(baseline?.nominalValue).toBeCloseTo(114.49);
    expect(withContribution?.nominalValue).toBeCloseTo(135.19);
    expect(withContribution?.annualContribution).toBe(10);
  });

  it("builds a synthetic S&P 500 benchmark tracker with the same contribution timing", () => {
    const benchmark = buildSp500Benchmark(100, 10).find((point) => point.years === 2);

    expect(benchmark).toMatchObject({
      benchmark: "sp500",
      label: "S&P 500 historical",
      annualReturn: 0.1,
      annualContribution: 10
    });
    expect(benchmark?.nominalValue).toBeCloseTo(142);
  });
});
