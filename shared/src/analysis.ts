import type {
  AccountBreakdown,
  AccountSummary,
  AllocationDatum,
  BenchmarkProjectionPoint,
  PortfolioAnalysis,
  PortfolioHolding,
  ProjectionPoint,
  ProjectionScenario,
  TopMover
} from "./types";

export const projectionAssumptions: Record<ProjectionScenario, { annualReturn: number; inflation: number }> = {
  conservative: { annualReturn: 0.04, inflation: 0.025 },
  base: { annualReturn: 0.07, inflation: 0.025 },
  optimistic: { annualReturn: 0.1, inflation: 0.025 }
};

export const benchmarkAssumptions = {
  sp500: {
    label: "S&P 500 historical",
    annualReturn: 0.1,
    inflation: 0.025
  }
} as const;

export const projectionHorizons = [1, 2, 3, 5, 7, 10];

function groupByName(holdings: PortfolioHolding[], getName: (holding: PortfolioHolding) => string): AllocationDatum[] {
  const totalValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const grouped = new Map<string, number>();

  for (const holding of holdings) {
    const key = getName(holding) || "Unclassified";
    grouped.set(key, (grouped.get(key) ?? 0) + holding.currentValue);
  }

  return [...grouped.entries()]
    .map(([name, value]) => ({
      name,
      value,
      weight: totalValue === 0 ? 0 : value / totalValue
    }))
    .sort((left, right) => right.value - left.value);
}

function buildAccounts(holdings: PortfolioHolding[], accountSummaries: AccountSummary[] = []): AccountBreakdown[] {
  const grouped = new Map<string, { value: number; gain: number; basis: number; holdings: number }>();

  for (const holding of holdings) {
    const current = grouped.get(holding.account) ?? { value: 0, gain: 0, basis: 0, holdings: 0 };
    current.value += holding.currentValue;
    current.gain += holding.totalGainDollar ?? 0;
    current.basis += holding.costBasis ?? 0;
    current.holdings += 1;
    grouped.set(holding.account, current);
  }

  if (accountSummaries.length > 0) {
    const holdingCounts = new Map<string, number>();
    const summaryGrouped = new Map<
      string,
      { value: number; gain: number; basis: number; holdings: number; gainPercentWeight: number; gainPercentValue: number }
    >();

    for (const holding of holdings) {
      holdingCounts.set(holding.account, (holdingCounts.get(holding.account) ?? 0) + 1);
    }

    for (const summary of accountSummaries) {
      const current = summaryGrouped.get(summary.account) ?? {
        value: 0,
        gain: 0,
        basis: 0,
        holdings: holdingCounts.get(summary.account) ?? 0,
        gainPercentWeight: 0,
        gainPercentValue: 0
      };

      current.value += summary.value;
      current.gain += summary.gainDollar ?? 0;

      if (summary.gainDollar !== null) {
        current.basis += summary.value - summary.gainDollar;
      }

      if (summary.gainPercent !== null) {
        current.gainPercentWeight += summary.value;
        current.gainPercentValue += summary.gainPercent * summary.value;
      }

      summaryGrouped.set(summary.account, current);
    }

    for (const [account, value] of grouped.entries()) {
      if (!summaryGrouped.has(account)) {
        summaryGrouped.set(account, {
          ...value,
          gainPercentWeight: 0,
          gainPercentValue: 0
        });
      }
    }

    return [...summaryGrouped.entries()]
      .map(([account, value]) => ({
        account,
        value: value.value,
        gainDollar: value.gain,
        gainPercent:
          value.gainPercentWeight > 0
            ? value.gainPercentValue / value.gainPercentWeight
            : value.basis > 0
              ? value.gain / value.basis
              : null,
        holdings: value.holdings
      }))
      .sort((left, right) => right.value - left.value);
  }

  return [...grouped.entries()]
    .map(([account, value]) => ({
      account,
      value: value.value,
      gainDollar: value.gain,
      gainPercent: value.basis > 0 ? value.gain / value.basis : null,
      holdings: value.holdings
    }))
    .sort((left, right) => right.value - left.value);
}

function buildAccountAllocation(accounts: AccountBreakdown[]): AllocationDatum[] {
  const totalValue = accounts.reduce((sum, account) => sum + account.value, 0);

  return accounts.map((account) => ({
    name: account.account,
    value: account.value,
    weight: totalValue === 0 ? 0 : account.value / totalValue
  }));
}

function buildMovers(holdings: PortfolioHolding[], direction: "asc" | "desc"): TopMover[] {
  return holdings
    .filter((holding) => holding.totalGainDollar !== null)
    .sort((left, right) =>
      direction === "desc"
        ? (right.totalGainDollar ?? 0) - (left.totalGainDollar ?? 0)
        : (left.totalGainDollar ?? 0) - (right.totalGainDollar ?? 0)
    )
    .slice(0, 5)
    .map((holding) => ({
      symbol: holding.symbol || "N/A",
      description: holding.description,
      currentValue: holding.currentValue,
      totalGainDollar: holding.totalGainDollar ?? 0,
      totalGainPercent: holding.totalGainPercent,
      account: holding.account
    }));
}

export function buildProjections(currentValue: number, annualContribution = 0): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];

  for (const [scenario, assumptions] of Object.entries(projectionAssumptions) as Array<
    [ProjectionScenario, { annualReturn: number; inflation: number }]
  >) {
    for (const years of projectionHorizons) {
      let nominalValue = currentValue;

      for (let year = 0; year < years; year += 1) {
        nominalValue = nominalValue * (1 + assumptions.annualReturn) + annualContribution;
      }

      const realValue = nominalValue / (1 + assumptions.inflation) ** years;

      points.push({
        scenario,
        years,
        nominalValue,
        realValue,
        annualReturn: assumptions.annualReturn,
        annualContribution
      });
    }
  }

  return points;
}

export function buildSp500Benchmark(currentValue: number, annualContribution = 0): BenchmarkProjectionPoint[] {
  return projectionHorizons.map((years) => {
    let nominalValue = currentValue;

    for (let year = 0; year < years; year += 1) {
      nominalValue = nominalValue * (1 + benchmarkAssumptions.sp500.annualReturn) + annualContribution;
    }

    return {
      benchmark: "sp500",
      label: benchmarkAssumptions.sp500.label,
      years,
      nominalValue,
      realValue: nominalValue / (1 + benchmarkAssumptions.sp500.inflation) ** years,
      annualReturn: benchmarkAssumptions.sp500.annualReturn,
      annualContribution
    };
  });
}

export function analyzeHoldings(
  holdings: PortfolioHolding[],
  warnings: PortfolioAnalysis["warnings"] = [],
  accountSummaries: AccountSummary[] = []
): PortfolioAnalysis {
  const currentValue = holdings.reduce((sum, holding) => sum + holding.currentValue, 0);
  const costBasis = holdings.reduce((sum, holding) => sum + (holding.costBasis ?? 0), 0);
  const totalGainDollar = holdings.reduce((sum, holding) => sum + (holding.totalGainDollar ?? 0), 0);
  const todayGainDollar = holdings.reduce((sum, holding) => sum + (holding.todayGainDollar ?? 0), 0);
  const accounts = buildAccounts(holdings, accountSummaries);

  return {
    summary: {
      currentValue,
      costBasis,
      totalGainDollar,
      totalGainPercent: costBasis > 0 ? totalGainDollar / costBasis : null,
      todayGainDollar
    },
    allocations: {
      bySymbol: groupByName(holdings, (holding) => holding.symbol || holding.description || "Unknown"),
      byAccount: buildAccountAllocation(accounts),
      bySecurityType: groupByName(holdings, (holding) => holding.securityType || "Unclassified")
    },
    accounts,
    holdings: [...holdings].sort((left, right) => right.currentValue - left.currentValue),
    topMovers: {
      gainers: buildMovers(holdings, "desc"),
      laggards: buildMovers(holdings, "asc")
    },
    projections: buildProjections(currentValue),
    warnings
  };
}
