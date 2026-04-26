import Papa from "papaparse";

import type { AccountSummary, AnalysisWarning, PortfolioHolding } from "../../../shared/src/types.ts";
import type { ParsedPortfolioFile } from "./types.ts";
import {
  buildAccountLabel,
  cleanCellValue,
  looksLikeDate,
  normalizeHeader,
  parseCurrency,
  parseNumberLike,
  parsePercent,
  stringOrNull
} from "../utils/normalization.ts";

type CsvRow = Record<string, string>;
type CanonicalField =
  | "accountNumber"
  | "accountName"
  | "symbol"
  | "description"
  | "quantity"
  | "price"
  | "pricePaid"
  | "currentValue"
  | "todayGainDollar"
  | "todayGainPercent"
  | "totalGainDollar"
  | "totalGainPercent"
  | "percentOfAccount"
  | "costBasis"
  | "securityType";

const headerAliases: Record<CanonicalField, string[]> = {
  accountNumber: ["accountnumber", "acctnumber", "accountid", "accountno"],
  accountName: ["accountname", "accounttitle", "accountnickname", "portfolioaccount", "accountlabel", "account"],
  symbol: ["symbol", "ticker", "tickersymbol", "securitysymbol", "cusip"],
  description: ["description", "securitydescription", "securityname", "investmentname", "name"],
  quantity: ["quantity", "shares", "units", "sharequantity", "qtynumber", "qty"],
  price: ["lastpricedollar", "lastprice", "price", "marketprice", "shareprice", "closingprice"],
  pricePaid: ["pricepaiddollar", "pricepaid", "averagecostbasis", "averagecost", "avgcost", "avgcostbasis"],
  currentValue: ["currentvaluedollar", "currentvalue", "marketvaluedollar", "marketvalue", "valuedollar", "value", "positionvalue", "endingvalue"],
  todayGainDollar: [
    "todaysgainlossdollar",
    "daysgaindollar",
    "daygainlossdollar",
    "dailygainlossdollar",
    "todaysgaindollar",
    "daysgainunrealizeddollar",
    "daygainunrealizeddollar"
  ],
  todayGainPercent: [
    "todaysgainlosspercent",
    "daysgainpercent",
    "daygainlosspercent",
    "dailygainlosspercent",
    "todaysgainpercent",
    "daysgainunrealizedpercent",
    "daygainunrealizedpercent"
  ],
  totalGainDollar: [
    "totalgainlossdollar",
    "totalgainloss",
    "totalgaindollar",
    "totalgain",
    "unrealizedgainlossdollar",
    "unrealizedgainloss",
    "gainlossdollar"
  ],
  totalGainPercent: [
    "totalgainlosspercent",
    "totalgainpercent",
    "totalgainpercentage",
    "unrealizedgainlosspercent",
    "gainlosspercent"
  ],
  percentOfAccount: ["percentofaccount", "portfoliopercent", "weight", "allocationpercent"],
  costBasis: ["costbasistotal", "costbasis", "bookvalue", "totalcostbasis", "costbasisdollar", "cost"],
  securityType: ["type", "securitytype", "assetclass", "investmenttype"]
};

function resolveHeaders(fields: string[]): Partial<Record<CanonicalField, string>> {
  const byNormalized = new Map<string, string>();

  for (const field of fields) {
    byNormalized.set(normalizeHeader(field), field);
  }

  const resolved: Partial<Record<CanonicalField, string>> = {};

  for (const [canonicalField, aliases] of Object.entries(headerAliases) as Array<[CanonicalField, string[]]>) {
    resolved[canonicalField] = aliases.map((alias) => byNormalized.get(alias)).find(Boolean);
  }

  return resolved;
}

function scoreHeaderRow(fields: string[]): number {
  const headers = resolveHeaders(fields);
  let score = 0;

  if (headers.symbol) {
    score += 3;
  }

  if (headers.currentValue) {
    score += 3;
  }

  if (headers.totalGainDollar) {
    score += 2;
  }

  if (headers.totalGainPercent) {
    score += 2;
  }

  if (headers.quantity) {
    score += 1;
  }

  return score;
}

function findHoldingsHeaderIndex(rows: string[][]): number {
  let bestIndex = 0;
  let bestScore = -1;

  rows.forEach((row, index) => {
    const score = scoreHeaderRow(row.map((value) => cleanCellValue(value)));
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 6 ? bestIndex : 0;
}

function extractAccountSummaryAccount(rows: string[][], beforeIndex: number): string | null {
  return extractAccountSummaries(rows, beforeIndex, "").at(0)?.account ?? null;
}

function parseAccountSummaryRow(
  row: string[],
  fields: string[],
  headerMap: Partial<Record<"account" | "value" | "gainDollar" | "gainPercent", number>>,
  sourceFile: string
): AccountSummary | null {
  const accountIndex = headerMap.account;
  const valueIndex = headerMap.value;

  if (accountIndex === undefined || valueIndex === undefined) {
    return null;
  }

  const account = cleanCellValue(row[accountIndex]);
  const value = parseCurrency(cleanCellValue(row[valueIndex]));

  if (!account || value === null || normalizeHeader(account) === normalizeHeader(fields[accountIndex])) {
    return null;
  }

  const gainDollar =
    headerMap.gainDollar === undefined ? null : parseCurrency(cleanCellValue(row[headerMap.gainDollar]));
  const gainPercent =
    headerMap.gainPercent === undefined ? null : parsePercent(cleanCellValue(row[headerMap.gainPercent]));

  return {
    account,
    value,
    gainDollar,
    gainPercent,
    sourceFile
  };
}

function extractAccountSummaries(rows: string[][], beforeIndex: number, sourceFile: string): AccountSummary[] {
  const summaries: AccountSummary[] = [];

  for (let index = 0; index < beforeIndex; index += 1) {
    const row = rows[index] ?? [];
    const normalized = row.map((cell) => normalizeHeader(cell));

    if (normalized[0] !== "account" || !normalized.includes("netaccountvalue")) {
      continue;
    }

    const headerMap = {
      account: normalized.indexOf("account"),
      value: normalized.indexOf("netaccountvalue"),
      gainDollar: normalized.findIndex((header) => ["totalgaindollar", "totalgainlossdollar", "totalgain"].includes(header)),
      gainPercent: normalized.findIndex((header) => ["totalgainpercent", "totalgainlosspercent"].includes(header))
    };

    const normalizedHeaderMap = {
      account: headerMap.account >= 0 ? headerMap.account : undefined,
      value: headerMap.value >= 0 ? headerMap.value : undefined,
      gainDollar: headerMap.gainDollar >= 0 ? headerMap.gainDollar : undefined,
      gainPercent: headerMap.gainPercent >= 0 ? headerMap.gainPercent : undefined
    };

    for (const candidate of rows.slice(index + 1, beforeIndex)) {
      const summary = parseAccountSummaryRow(candidate, row, normalizedHeaderMap, sourceFile);
      if (summary) {
        summaries.push(summary);
      }
    }
  }

  return summaries;
}

function rowsToObjects(rows: string[][], headerIndex: number): { fields: string[]; data: CsvRow[] } {
  const fields = (rows[headerIndex] ?? []).map((field) => cleanCellValue(field));
  const data = rows.slice(headerIndex + 1).map((row) => {
    const record: CsvRow = {};

    fields.forEach((field, index) => {
      record[field] = cleanCellValue(row[index]);
    });

    return record;
  });

  return { fields, data };
}

function getValue(row: CsvRow, header?: string): string {
  if (!header) {
    return "";
  }

  return cleanCellValue(row[header]);
}

function hasStructuredData(row: CsvRow, headers: Partial<Record<CanonicalField, string>>): boolean {
  const numericHeaders: CanonicalField[] = [
    "quantity",
    "price",
    "currentValue",
    "todayGainDollar",
    "todayGainPercent",
    "totalGainDollar",
    "totalGainPercent",
    "percentOfAccount",
    "costBasis"
  ];

  return numericHeaders.some((header) => parseNumberLike(getValue(row, headers[header])) !== null);
}

function shouldIgnoreNonHoldingRow(row: CsvRow, headers: Partial<Record<CanonicalField, string>>): boolean {
  const symbol = getValue(row, headers.symbol);
  const description = getValue(row, headers.description);
  const normalizedSymbol = symbol.toUpperCase();
  const normalizedDescription = description.toUpperCase();

  if (normalizedSymbol === "TOTAL" || normalizedDescription === "TOTAL") {
    return true;
  }

  if (symbol && looksLikeDate(symbol)) {
    return true;
  }

  if (!symbol && description && looksLikeDate(description)) {
    return true;
  }

  return false;
}

function createMissingColumnWarnings(
  sourceFile: string,
  headers: Partial<Record<CanonicalField, string>>
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  const required: CanonicalField[] = ["currentValue"];
  const recommended: CanonicalField[] = ["totalGainDollar", "totalGainPercent"];

  const missingRequired = required.filter((field) => !headers[field]);
  const missingRecommended = recommended.filter((field) => !headers[field]);

  if (missingRequired.length > 0) {
    warnings.push({
      code: "missing-columns",
      sourceFile,
      message: `Missing required columns: ${missingRequired.join(", ")}.`
    });
  }

  if (missingRecommended.length > 0) {
    warnings.push({
      code: "missing-columns",
      sourceFile,
      message: `Missing gain columns: ${missingRecommended.join(", ")}.`
    });
  }

  return warnings;
}

function createHolding(
  row: CsvRow,
  headers: Partial<Record<CanonicalField, string>>,
  sourceFile: string,
  fallbackAccount: string | null
): PortfolioHolding | null {
  const currentValue = parseCurrency(getValue(row, headers.currentValue));

  if (currentValue === null) {
    return null;
  }

  const accountName = stringOrNull(getValue(row, headers.accountName));
  const accountNumber = stringOrNull(getValue(row, headers.accountNumber));
  const quantity = parseNumberLike(getValue(row, headers.quantity));
  const pricePaid = parseCurrency(getValue(row, headers.pricePaid));
  const reportedCostBasis = parseCurrency(getValue(row, headers.costBasis));
  const inferredCostBasis = reportedCostBasis ?? (pricePaid !== null && quantity !== null ? pricePaid * quantity : null);

  return {
    account: buildAccountLabel(accountName ?? fallbackAccount, accountNumber),
    symbol: getValue(row, headers.symbol),
    description: stringOrNull(getValue(row, headers.description)) || getValue(row, headers.symbol) || "Unknown position",
    quantity,
    price: parseCurrency(getValue(row, headers.price)),
    currentValue,
    costBasis: inferredCostBasis,
    totalGainDollar: parseCurrency(getValue(row, headers.totalGainDollar)),
    totalGainPercent: parsePercent(getValue(row, headers.totalGainPercent)),
    todayGainDollar: parseCurrency(getValue(row, headers.todayGainDollar)),
    todayGainPercent: parsePercent(getValue(row, headers.todayGainPercent)),
    percentOfAccount: parsePercent(getValue(row, headers.percentOfAccount)),
    securityType: stringOrNull(getValue(row, headers.securityType)),
    sourceFile,
    sourceFormat: "csv"
  };
}

export function parseCsvFile(sourceFile: string, content: string): ParsedPortfolioFile {
  const parsed = Papa.parse<string[]>(content.replace(/\uFEFF/g, ""), {
    skipEmptyLines: false,
    transform: (value) => cleanCellValue(value)
  });
  const rawRows = parsed.data.filter((row) => row.some((cell) => cleanCellValue(cell).length > 0));
  const headerIndex = findHoldingsHeaderIndex(rawRows);
  const fallbackAccount = extractAccountSummaryAccount(rawRows, headerIndex);
  const accountSummaries = extractAccountSummaries(rawRows, headerIndex, sourceFile);
  const { fields, data } = rowsToObjects(rawRows, headerIndex);
  const headers = resolveHeaders(fields);
  const warnings = createMissingColumnWarnings(sourceFile, headers);
  const holdings: PortfolioHolding[] = [];

  data.forEach((row, index) => {
    if (shouldIgnoreNonHoldingRow(row, headers)) {
      return;
    }

    const holding = createHolding(row, headers, sourceFile, fallbackAccount);

    if (holding) {
      holdings.push(holding);
      return;
    }

    if (!hasStructuredData(row, headers)) {
      return;
    }

    const rowDescriptor = getValue(row, headers.description) || getValue(row, headers.symbol) || `row ${index + 2}`;

    warnings.push({
      code: "skipped-row",
      sourceFile,
      row: headerIndex + index + 2,
      message: `Skipped row ${headerIndex + index + 2} because it did not contain a readable current value (${rowDescriptor}).`
    });
  });

  return { accountSummaries, holdings, warnings };
}
