import type { AccountSummary, AnalysisWarning, PortfolioHolding } from "../../../shared/src/types.ts";

export interface ParsedPortfolioFile {
  accountSummaries: AccountSummary[];
  holdings: PortfolioHolding[];
  warnings: AnalysisWarning[];
}
