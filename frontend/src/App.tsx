import { startTransition, useDeferredValue, useId, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

import type {
  AllocationDatum,
  AnalysisWarning,
  PortfolioAnalysis,
  PortfolioHolding,
  ProjectionPoint,
  ProjectionScenario,
  TopMover
} from "@shared/types";
import { benchmarkAssumptions, buildProjections, buildSp500Benchmark } from "@shared/analysis";

import { analyzePortfolio } from "./lib/api";
import { MAX_FILES, canAnalyzeFiles, getFileKindLabel, selectFiles } from "./lib/file-utils";
import { formatCompactCurrency, formatCurrency, formatNumber, formatPercent, formatSignedCurrency } from "./lib/formatters";

const chartColors = ["#156064", "#f4a261", "#2a9d8f", "#e76f51", "#264653", "#e9c46a", "#7f5539", "#8ab17d"];
const scenarioOrder: ProjectionScenario[] = ["conservative", "base", "optimistic"];
const scenarioLabels: Record<ProjectionScenario, string> = {
  conservative: "Conservative",
  base: "Base case",
  optimistic: "Optimistic"
};
const annualContributionOptions = [0, 100000, 200000, 300000, 400000, 500000];

type ProjectionMetric = "nominalValue" | "realValue";

function getToneClass(value: number | null | undefined): string {
  if (value === null || value === undefined || value === 0) {
    return "tone-neutral";
  }

  return value > 0 ? "tone-positive" : "tone-negative";
}

function combineSmallSlices(data: AllocationDatum[], limit: number): AllocationDatum[] {
  if (data.length <= limit) {
    return data;
  }

  const head = data.slice(0, limit - 1);
  const remaining = data.slice(limit - 1);
  const remainderValue = remaining.reduce((sum, item) => sum + item.value, 0);
  const remainderWeight = remaining.reduce((sum, item) => sum + item.weight, 0);

  return [
    ...head,
    {
      name: "Other",
      value: remainderValue,
      weight: remainderWeight
    }
  ];
}

function takeTopAllocations(data: AllocationDatum[], limit: number): AllocationDatum[] {
  return data.slice(0, limit);
}

function buildProjectionSeries(points: ProjectionPoint[], metric: ProjectionMetric) {
  const byYears = new Map<number, { years: number; conservative?: number; base?: number; optimistic?: number }>();

  for (const point of points) {
    const current = byYears.get(point.years) ?? { years: point.years };
    current[point.scenario] = point[metric];
    byYears.set(point.years, current);
  }

  return [...byYears.values()].sort((left, right) => left.years - right.years);
}

function addBenchmarkToProjectionSeries(
  series: ReturnType<typeof buildProjectionSeries>,
  benchmarkPoints: ReturnType<typeof buildSp500Benchmark>,
  metric: ProjectionMetric
) {
  const benchmarkByYear = new Map(benchmarkPoints.map((point) => [point.years, point[metric]]));

  return series.map((point) => ({
    ...point,
    sp500: benchmarkByYear.get(point.years)
  }));
}

function buildProjectionCards(points: ProjectionPoint[], years: number) {
  return scenarioOrder
    .map((scenario) => points.find((point) => point.scenario === scenario && point.years === years))
    .filter((point): point is ProjectionPoint => Boolean(point));
}

function filterHoldings(holdings: PortfolioHolding[], query: string): PortfolioHolding[] {
  if (!query.trim()) {
    return holdings;
  }

  const normalizedQuery = query.trim().toLowerCase();

  return holdings.filter((holding) =>
    [holding.symbol, holding.description, holding.account, holding.securityType ?? ""].some((value) =>
      value.toLowerCase().includes(normalizedQuery)
    )
  );
}

function getWarningTitle(warning: AnalysisWarning): string {
  switch (warning.code) {
    case "missing-columns":
      return "Missing data";
    case "unsupported-file":
      return "Unsupported file";
    case "skipped-row":
      return "Skipped row";
    case "low-confidence-pdf":
      return "Low-confidence PDF parse";
    case "image-only-pdf":
      return "Image-only PDF";
    case "duplicate-position":
      return "Duplicate position";
    default:
      return "Warning";
  }
}

function getFileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function CustomTooltip({
  active,
  payload,
  label,
  formatter
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="chart-tooltip">
      {label ? <div className="chart-tooltip-label">{label}</div> : null}
      <ul>
        {payload.map((entry) => (
          <li key={entry.name}>
            <span className="chart-tooltip-dot" style={{ backgroundColor: entry.color }} />
            <span>{entry.name}</span>
            <strong>{formatter ? formatter(entry.value) : formatCurrency(entry.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyAnalysisState() {
  return (
    <section className="analysis-placeholder" data-testid="empty-analysis">
      <div>
        <p className="eyebrow">Local workflow</p>
        <h2>Upload brokerage exports and let the dashboard do the sorting.</h2>
        <p>
          The frontend sends selected CSV and PDF files to the backend, then renders allocation shifts, gain breakdowns,
          and a 2-10 year outlook from the returned analysis payload.
        </p>
      </div>
      <div className="placeholder-grid">
        <article>
          <span>Detect</span>
          <strong>Total gain and return fields</strong>
          <p>Flexible CSV columns and text-based PDF statements feed the same normalized dashboard.</p>
        </article>
        <article>
          <span>Compare</span>
          <strong>Accounts, sectors, and positions</strong>
          <p>Charts highlight concentration, outsized winners, laggards, and the biggest holdings.</p>
        </article>
        <article>
          <span>Project</span>
          <strong>2-10 year scenario bands</strong>
          <p>Nominal and inflation-adjusted views show how the portfolio could evolve under fixed return bands.</p>
        </article>
      </div>
    </section>
  );
}

export function App() {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [analysis, setAnalysis] = useState<PortfolioAnalysis | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);
  const [projectionYears, setProjectionYears] = useState(5);
  const [projectionMetric, setProjectionMetric] = useState<ProjectionMetric>("nominalValue");
  const [annualContribution, setAnnualContribution] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");

  const deferredSearchTerm = useDeferredValue(searchTerm);
  const filteredHoldings = analysis ? filterHoldings(analysis.holdings, deferredSearchTerm) : [];
  const symbolAllocation = analysis ? takeTopAllocations(analysis.allocations.bySymbol, 5) : [];
  const securityTypeAllocation = analysis ? combineSmallSlices(analysis.allocations.bySecurityType, 5) : [];
  const accountAllocation = analysis ? combineSmallSlices(analysis.allocations.byAccount, 5) : [];
  const adjustedProjections = analysis ? buildProjections(analysis.summary.currentValue, annualContribution) : [];
  const sp500Benchmark = analysis ? buildSp500Benchmark(analysis.summary.currentValue, annualContribution) : [];
  const projectionSeries = addBenchmarkToProjectionSeries(
    buildProjectionSeries(adjustedProjections, projectionMetric),
    sp500Benchmark,
    projectionMetric
  );
  const projectionCards = buildProjectionCards(adjustedProjections, projectionYears);
  const sp500ProjectionCard = sp500Benchmark.find((point) => point.years === projectionYears);

  const csvCount = files.filter((file) => file.name.toLowerCase().endsWith(".csv")).length;
  const pdfCount = files.filter((file) => file.name.toLowerCase().endsWith(".pdf")).length;

  function updateFiles(incomingFiles: Iterable<File>) {
    setFiles((currentFiles) => {
      const selection = selectFiles(currentFiles, incomingFiles);

      if (selection.rejectedNames.length > 0) {
        setSelectionMessage(`Ignored unsupported files: ${selection.rejectedNames.join(", ")}`);
      } else if (selection.limitExceeded) {
        setSelectionMessage(`Only ${MAX_FILES} files can be analyzed at once.`);
      } else if (selection.files.length > currentFiles.length) {
        setSelectionMessage(`${selection.files.length} file${selection.files.length === 1 ? "" : "s"} ready for analysis.`);
      }

      setErrorMessage(null);
      return selection.files;
    });
  }

  function handleRemoveFile(targetFile: File) {
    const fileKey = getFileKey(targetFile);
    setFiles((currentFiles) => currentFiles.filter((file) => getFileKey(file) !== fileKey));
  }

  function handleReset() {
    setFiles([]);
    setAnalysis(null);
    setErrorMessage(null);
    setSelectionMessage("Selection cleared.");
    setSearchTerm("");

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleAnalyze() {
    if (!canAnalyzeFiles(files) || isLoading) {
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSelectionMessage(null);

    try {
      const nextAnalysis = await analyzePortfolio(files);
      startTransition(() => {
        setAnalysis(nextAnalysis);
        setProjectionYears(5);
        setProjectionMetric("nominalValue");
        setAnnualContribution(0);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Analysis failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Portfolio Analyzer</p>
          <h1>Turn brokerage exports into a clean portfolio readout.</h1>
          <p className="hero-text">
            Upload up to {MAX_FILES} CSV or text-based PDF files, run the backend analysis locally, and inspect current
            value, gain exposure, concentration risk, and scenario-based projections in one screen.
          </p>
          <div className="hero-badges">
            <span>CSV + PDF</span>
            <span>Local backend</span>
            <span>2-10 year outlook</span>
          </div>
        </div>

        <section className="uploader-card" data-testid="upload-panel">
          <div
            className={`dropzone ${isDragging ? "is-dragging" : ""}`}
            onDragEnter={() => setIsDragging(true)}
            onDragLeave={() => setIsDragging(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragging(false);
              updateFiles(event.dataTransfer.files);
            }}
            data-testid="file-dropzone"
          >
            <div className="dropzone-copy">
              <strong>Drop files here</strong>
              <p>Accepts `.csv` and `.pdf` inputs. The selection stays in this browser session only.</p>
            </div>
            <label className="file-picker" htmlFor={inputId}>
              Choose files
            </label>
            <input
              ref={fileInputRef}
              id={inputId}
              className="file-input"
              type="file"
              accept=".csv,.pdf,application/pdf,text/csv"
              multiple
              onChange={(event) => {
                if (event.target.files) {
                  updateFiles(event.target.files);
                }
              }}
              data-testid="file-input"
            />
          </div>

          <div className="selection-summary">
            <div>
              <span className="selection-label">Selected</span>
              <strong data-testid="selected-count">{files.length}</strong>
            </div>
            <div>
              <span className="selection-label">CSV</span>
              <strong>{csvCount}</strong>
            </div>
            <div>
              <span className="selection-label">PDF</span>
              <strong>{pdfCount}</strong>
            </div>
            <div>
              <span className="selection-label">Limit</span>
              <strong>{MAX_FILES}</strong>
            </div>
          </div>

          {selectionMessage ? (
            <p className="support-message" data-testid="selection-message">
              {selectionMessage}
            </p>
          ) : null}

          {errorMessage ? (
            <p className="error-message" role="alert" data-testid="error-message">
              {errorMessage}
            </p>
          ) : null}

          <ul className="file-list" data-testid="selected-file-list">
            {files.length === 0 ? (
              <li className="file-empty">No files selected yet.</li>
            ) : (
              files.map((file) => (
                <li key={getFileKey(file)} className="file-row" data-testid="selected-file">
                  <div>
                    <span className="file-kind">{getFileKindLabel(file.name)}</span>
                    <strong>{file.name}</strong>
                    <small>{formatNumber(file.size / 1024)} KB</small>
                  </div>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => handleRemoveFile(file)}
                    data-testid={`remove-file-${file.name}`}
                  >
                    Remove
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="action-row">
            <button
              type="button"
              className="secondary-button"
              onClick={handleReset}
              disabled={files.length === 0 && analysis === null}
              data-testid="reset-button"
            >
              Reset
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={handleAnalyze}
              disabled={!canAnalyzeFiles(files) || isLoading}
              data-testid="analyze-button"
            >
              {isLoading ? "Analyzing..." : "Analyze portfolio"}
            </button>
          </div>
        </section>
      </section>

      {analysis ? (
        <>
          <section className="summary-grid" data-testid="summary-grid">
            <article className="metric-card">
              <span>Current value</span>
              <strong data-testid="summary-current-value">{formatCurrency(analysis.summary.currentValue)}</strong>
              <small>Combined market value across uploaded files.</small>
            </article>
            <article className="metric-card">
              <span>Cost basis</span>
              <strong>{formatCurrency(analysis.summary.costBasis)}</strong>
              <small>Reported basis from parsed brokerage data.</small>
            </article>
            <article className={`metric-card ${getToneClass(analysis.summary.totalGainDollar)}`}>
              <span>Total gain</span>
              <strong>{formatSignedCurrency(analysis.summary.totalGainDollar)}</strong>
              <small>{formatPercent(analysis.summary.totalGainPercent)} total return</small>
            </article>
            <article className={`metric-card ${getToneClass(analysis.summary.todayGainDollar)}`}>
              <span>Today change</span>
              <strong>{formatSignedCurrency(analysis.summary.todayGainDollar)}</strong>
              <small>Day move if reported by the uploaded files.</small>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel panel-wide" data-testid="top-holdings-chart">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Concentration</p>
                  <h2>Largest positions</h2>
                </div>
                <span>Top {symbolAllocation.length} positions</span>
              </div>
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={symbolAllocation} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8d0c4" />
                    <XAxis dataKey="name" stroke="#4f5d75" tickLine={false} axisLine={false} />
                    <YAxis stroke="#4f5d75" tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                    <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                      {symbolAllocation.map((entry, index) => (
                        <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="allocation-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Structure</p>
                  <h2>Security mix</h2>
                </div>
              </div>
              <div className="chart-frame">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={securityTypeAllocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={60}
                      outerRadius={92}
                      paddingAngle={2}
                      cornerRadius={5}
                    >
                      {securityTypeAllocation.map((entry, index) => (
                        <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                    <Legend verticalAlign="bottom" height={36} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="panel" data-testid="account-allocation-chart">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Accounts</p>
                  <h2>Value by account</h2>
                </div>
                <span>{accountAllocation.length} slices</span>
              </div>
              <div className="chart-frame chart-frame-pie">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={accountAllocation}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={66}
                      outerRadius={104}
                      paddingAngle={3}
                      cornerRadius={6}
                    >
                      {accountAllocation.map((entry, index) => (
                        <Cell key={entry.name} fill={chartColors[(index + 2) % chartColors.length]} stroke="#fffaf2" strokeWidth={2} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                    <Legend verticalAlign="bottom" height={44} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="content-grid">
            <article className="panel panel-large" data-testid="projection-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Projection bands</p>
                  <h2>Portfolio outlook</h2>
                </div>
                <div className="panel-actions">
                  <div className="segmented-control" role="tablist" aria-label="Projection years">
                    {[1, 2, 3, 5, 7, 10].map((years) => (
                      <button
                        key={years}
                        type="button"
                        className={projectionYears === years ? "is-active" : ""}
                        onClick={() => setProjectionYears(years)}
                      >
                        {years}Y
                      </button>
                    ))}
                  </div>
                  <div className="segmented-control" role="tablist" aria-label="Projection metric">
                    <button
                      type="button"
                      className={projectionMetric === "nominalValue" ? "is-active" : ""}
                      onClick={() => setProjectionMetric("nominalValue")}
                    >
                      Nominal
                    </button>
                    <button
                      type="button"
                      className={projectionMetric === "realValue" ? "is-active" : ""}
                      onClick={() => setProjectionMetric("realValue")}
                    >
                      Real
                    </button>
                  </div>
                  <label className="projection-contribution-control">
                    <span>Annual investment</span>
                    <div>
                      <select
                        value={annualContributionOptions.includes(annualContribution) ? String(annualContribution) : "custom"}
                        onChange={(event) => {
                          if (event.target.value === "custom") {
                            return;
                          }

                          setAnnualContribution(Number(event.target.value));
                        }}
                        data-testid="annual-contribution-select"
                      >
                        {annualContributionOptions.map((value) => (
                          <option key={value} value={value}>
                            {value === 0 ? "No new investment" : `${formatCurrency(value)} / year`}
                          </option>
                        ))}
                        <option value="custom">Custom</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="1000"
                        value={annualContribution}
                        onChange={(event) => setAnnualContribution(Math.max(0, Number(event.target.value) || 0))}
                        data-testid="annual-contribution-input"
                      />
                    </div>
                  </label>
                </div>
              </div>

              <div className="projection-card-row">
                {projectionCards.map((point) => (
                  <article key={`${point.scenario}-${point.years}`} className="projection-card">
                    <span>{scenarioLabels[point.scenario]}</span>
                    <strong>{formatCurrency(point[projectionMetric])}</strong>
                    <small>
                      {formatPercent(point.annualReturn)} return, {formatCurrency(annualContribution)} invested yearly
                    </small>
                  </article>
                ))}
                {sp500ProjectionCard ? (
                  <article className="projection-card benchmark-card" data-testid="sp500-tracker">
                    <span>S&P 500 tracker</span>
                    <strong>{formatCurrency(sp500ProjectionCard[projectionMetric])}</strong>
                    <small>
                      {formatPercent(sp500ProjectionCard.annualReturn)} historical average,{" "}
                      {formatCurrency(annualContribution)} invested yearly
                    </small>
                  </article>
                ) : null}
              </div>

              <div className="chart-frame" data-testid="projections-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={projectionSeries} margin={{ top: 16, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8d0c4" />
                    <XAxis dataKey="years" stroke="#4f5d75" tickFormatter={(value) => `${value}Y`} tickLine={false} axisLine={false} />
                    <YAxis stroke="#4f5d75" tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip formatter={formatCurrency} />} />
                    <Legend />
                    <Line type="monotone" dataKey="conservative" name="Conservative" stroke="#264653" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="base" name="Base case" stroke="#2a9d8f" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="optimistic" name="Optimistic" stroke="#f4a261" strokeWidth={2} dot={false} />
                    <Line
                      type="monotone"
                      dataKey="sp500"
                      name="S&P 500 historical"
                      stroke="#6d597a"
                      strokeWidth={3}
                      strokeDasharray="6 5"
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <p className="projection-note">
                Illustrative only. Future values use fixed scenario assumptions and annual end-of-year investments, not extrapolated current gains.
                The S&P 500 tracker uses a {formatPercent(benchmarkAssumptions.sp500.annualReturn)} historical average return baseline.
              </p>
            </article>

            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Top movers</p>
                  <h2>Biggest gain and drag</h2>
                </div>
              </div>
              <div className="movers-grid">
                <MoverList title="Gainers" movers={analysis.topMovers.gainers} />
                <MoverList title="Laggards" movers={analysis.topMovers.laggards} />
              </div>
            </article>

            <article className="panel" data-testid="warnings-panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Parser notes</p>
                  <h2>Warnings</h2>
                </div>
                <span>{analysis.warnings.length}</span>
              </div>
              {analysis.warnings.length === 0 ? (
                <p className="empty-panel">No parser warnings in the latest analysis.</p>
              ) : (
                <ul className="warning-list">
                  {analysis.warnings.map((warning, index) => (
                    <li key={`${warning.sourceFile}-${warning.code}-${index}`}>
                      <div>
                        <strong>{getWarningTitle(warning)}</strong>
                        <span>{warning.sourceFile}</span>
                      </div>
                      <p>{warning.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </section>

          <section className="content-grid tables-grid">
            <article className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Accounts</p>
                  <h2>Account summary</h2>
                </div>
              </div>
              <table className="data-table" data-testid="accounts-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Value</th>
                    <th>Gain</th>
                    <th>Return</th>
                    <th>Holdings</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.accounts.map((account) => (
                    <tr key={account.account}>
                      <td>{account.account}</td>
                      <td>{formatCurrency(account.value)}</td>
                      <td className={getToneClass(account.gainDollar)}>{formatSignedCurrency(account.gainDollar)}</td>
                      <td>{formatPercent(account.gainPercent)}</td>
                      <td>{account.holdings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </article>

            <article className="panel panel-large">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Positions</p>
                  <h2>Holdings table</h2>
                </div>
                <label className="search-field">
                  <span className="sr-only">Search holdings</span>
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Filter by symbol, account, or type"
                    data-testid="holdings-search"
                  />
                </label>
              </div>

              <table className="data-table" data-testid="holdings-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Description</th>
                    <th>Account</th>
                    <th>Value</th>
                    <th>Gain</th>
                    <th>Return</th>
                    <th>Type</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHoldings.map((holding) => (
                    <tr key={`${holding.account}-${holding.symbol}-${holding.sourceFile}`}>
                      <td>{holding.symbol || "--"}</td>
                      <td>{holding.description || "--"}</td>
                      <td>{holding.account}</td>
                      <td>{formatCurrency(holding.currentValue)}</td>
                      <td className={getToneClass(holding.totalGainDollar)}>{formatSignedCurrency(holding.totalGainDollar)}</td>
                      <td>{formatPercent(holding.totalGainPercent)}</td>
                      <td>{holding.securityType ?? "--"}</td>
                      <td>{holding.sourceFile}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredHoldings.length === 0 ? <p className="empty-panel">No holdings match the current filter.</p> : null}
            </article>
          </section>
        </>
      ) : (
        <EmptyAnalysisState />
      )}
    </main>
  );
}

function MoverList({ title, movers }: { title: string; movers: TopMover[] }) {
  if (movers.length === 0) {
    return (
      <div className="mover-list">
        <h3>{title}</h3>
        <p className="empty-panel">No holdings carried gain data for this list.</p>
      </div>
    );
  }

  return (
    <div className="mover-list">
      <h3>{title}</h3>
      <ul>
        {movers.map((mover) => (
          <li key={`${title}-${mover.account}-${mover.symbol}`}>
            <div>
              <strong>{mover.symbol}</strong>
              <span>{mover.account}</span>
            </div>
            <div className={getToneClass(mover.totalGainDollar)}>
              <strong>{formatSignedCurrency(mover.totalGainDollar)}</strong>
              <span>{formatPercent(mover.totalGainPercent)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
