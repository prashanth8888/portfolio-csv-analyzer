export type SourceFormat = "csv" | "pdf";
export type ProjectionScenario = "conservative" | "base" | "optimistic";

export interface PortfolioHolding {
  account: string;
  symbol: string;
  description: string;
  quantity: number | null;
  price: number | null;
  currentValue: number;
  costBasis: number | null;
  totalGainDollar: number | null;
  totalGainPercent: number | null;
  todayGainDollar: number | null;
  todayGainPercent: number | null;
  percentOfAccount: number | null;
  securityType: string | null;
  sourceFile: string;
  sourceFormat: SourceFormat;
}

export interface AnalysisWarning {
  code:
    | "unsupported-file"
    | "missing-columns"
    | "skipped-row"
    | "low-confidence-pdf"
    | "image-only-pdf"
    | "duplicate-position";
  message: string;
  sourceFile: string;
  row?: number;
}

export interface SummaryMetrics {
  currentValue: number;
  costBasis: number;
  totalGainDollar: number;
  totalGainPercent: number | null;
  todayGainDollar: number;
}

export interface AllocationDatum {
  name: string;
  value: number;
  weight: number;
}

export interface AccountBreakdown {
  account: string;
  value: number;
  gainDollar: number;
  gainPercent: number | null;
  holdings: number;
}

export interface AccountSummary {
  account: string;
  value: number;
  gainDollar: number | null;
  gainPercent: number | null;
  sourceFile: string;
}

export interface TopMover {
  symbol: string;
  description: string;
  currentValue: number;
  totalGainDollar: number;
  totalGainPercent: number | null;
  account: string;
}

export interface ProjectionPoint {
  scenario: ProjectionScenario;
  years: number;
  nominalValue: number;
  realValue: number;
  annualReturn: number;
  annualContribution?: number;
}

export interface BenchmarkProjectionPoint {
  benchmark: "sp500";
  label: string;
  years: number;
  nominalValue: number;
  realValue: number;
  annualReturn: number;
  annualContribution?: number;
}

export interface PortfolioAnalysis {
  summary: SummaryMetrics;
  allocations: {
    bySymbol: AllocationDatum[];
    byAccount: AllocationDatum[];
    bySecurityType: AllocationDatum[];
  };
  accounts: AccountBreakdown[];
  holdings: PortfolioHolding[];
  topMovers: {
    gainers: TopMover[];
    laggards: TopMover[];
  };
  projections: ProjectionPoint[];
  warnings: AnalysisWarning[];
}
