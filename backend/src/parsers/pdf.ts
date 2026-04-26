import pdfParse from "pdf-parse";

import type { AccountSummary, AnalysisWarning, PortfolioHolding } from "../../../shared/src/types.ts";
import type { ParsedPortfolioFile } from "./types.ts";
import {
  buildAccountLabel,
  cleanCellValue,
  looksLikeSymbol,
  normalizeHeader,
  parseCurrency,
  parseNumberLike,
  parsePercent,
  stringOrNull
} from "../utils/normalization.ts";

export type PdfTextExtractor = (buffer: Buffer) => Promise<string>;

const defaultPdfTextExtractor: PdfTextExtractor = async (buffer) => {
  const parsed = await pdfParse(buffer);
  return parsed.text ?? "";
};

function splitPdfLine(line: string): string[] {
  const pipeTokens = line.split(/\s+\|\s+/).map((token) => cleanCellValue(token)).filter(Boolean);

  if (pipeTokens.length >= 4) {
    return pipeTokens;
  }

  return line.split(/\t+|\s{2,}/).map((token) => cleanCellValue(token)).filter(Boolean);
}

function isHeaderLine(line: string): boolean {
  const normalized = cleanCellValue(line).toLowerCase();

  return (
    normalized.includes("current value") ||
    normalized.includes("total gain") ||
    normalized.includes("cost basis") ||
    normalized.includes("description") ||
    normalized.includes("quantity")
  );
}

function isAccountSummaryHeader(tokens: string[]): boolean {
  const normalized = tokens.map((token) => normalizeHeader(token));
  return normalized[0] === "account" && normalized.includes("netaccountvalue");
}

function isHoldingsHeader(tokens: string[]): boolean {
  const normalized = tokens.map((token) => normalizeHeader(token));
  return normalized.includes("symbol") && (normalized.includes("valuedollar") || normalized.includes("currentvalue"));
}

function extractAccountFromLine(line: string): string | null {
  const match = line.match(/^(?:account|account name|account number|portfolio account)\s*[:\-]\s*(.+)$/i);
  return match ? cleanCellValue(match[1]) : null;
}

function tokenAt(tokens: string[], headerMap: Map<string, number>, aliases: string[]): string {
  for (const alias of aliases) {
    const index = headerMap.get(alias);
    if (index !== undefined) {
      return cleanCellValue(tokens[index]);
    }
  }

  return "";
}

function createHeaderMap(tokens: string[]): Map<string, number> {
  const headerMap = new Map<string, number>();

  tokens.forEach((token, index) => {
    const normalized = normalizeHeader(token);
    if (normalized) {
      headerMap.set(normalized, index);
    }
  });

  return headerMap;
}

function parseAccountSummaryTokens(tokens: string[], headerMap: Map<string, number>, sourceFile: string): AccountSummary | null {
  const account = tokenAt(tokens, headerMap, ["account"]);
  const value = parseCurrency(tokenAt(tokens, headerMap, ["netaccountvalue"]));

  if (!account || value === null) {
    return null;
  }

  return {
    account,
    value,
    gainDollar: parseCurrency(tokenAt(tokens, headerMap, ["totalgaindollar", "totalgainlossdollar", "totalgain"])),
    gainPercent: parsePercent(tokenAt(tokens, headerMap, ["totalgainpercent", "totalgainlosspercent"])),
    sourceFile
  };
}

function parseHeaderBasedHolding(
  tokens: string[],
  headerMap: Map<string, number>,
  sourceFile: string,
  account: string | null
): PortfolioHolding | null {
  const symbol = tokenAt(tokens, headerMap, ["symbol", "ticker", "tickersymbol"]);

  if (!looksLikeSymbol(symbol)) {
    return null;
  }

  const quantity = parseNumberLike(tokenAt(tokens, headerMap, ["qtynumber", "qty", "quantity", "shares"]));
  const pricePaid = parseCurrency(tokenAt(tokens, headerMap, ["pricepaiddollar", "pricepaid", "averagecostbasis"]));
  const totalGainDollar = parseCurrency(
    tokenAt(tokens, headerMap, ["totalgaindollar", "totalgain", "totalgainlossdollar", "unrealizedgainlossdollar"])
  );
  const currentValue = parseCurrency(tokenAt(tokens, headerMap, ["valuedollar", "value", "currentvaluedollar", "currentvalue"]));
  const reportedCostBasis = parseCurrency(tokenAt(tokens, headerMap, ["costbasis", "costbasistotal", "totalcostbasis"]));

  if (currentValue === null) {
    return null;
  }

  return {
    account: buildAccountLabel(account, null),
    symbol,
    description: symbol,
    quantity,
    price: parseCurrency(tokenAt(tokens, headerMap, ["lastpricedollar", "lastprice", "marketprice", "price"])),
    currentValue,
    costBasis: reportedCostBasis ?? (pricePaid !== null && quantity !== null ? pricePaid * quantity : null),
    totalGainDollar,
    totalGainPercent: parsePercent(tokenAt(tokens, headerMap, ["totalgainpercent", "totalgainlosspercent"])),
    todayGainDollar: parseCurrency(tokenAt(tokens, headerMap, ["daysgaindollar", "todaysgaindollar", "todaysgainlossdollar"])),
    todayGainPercent: parsePercent(tokenAt(tokens, headerMap, ["changepercent", "daysgainpercent", "todaysgainlosspercent"])),
    percentOfAccount: null,
    securityType: stringOrNull(tokenAt(tokens, headerMap, ["securitytype", "securitytypes", "type", "assetclass"])),
    sourceFile,
    sourceFormat: "pdf"
  };
}

function parseRobinhoodHoldings(lines: string[], sourceFile: string): PortfolioHolding[] {
  if (!lines.some((line) => line.includes("Robinhood")) || !lines.some((line) => line.includes("Portfolio Summary"))) {
    return [];
  }

  const accountLine = lines.find((line) => /Individual Account #:/i.test(line));
  const account = accountLine?.replace(/^.*Individual Account #:/i, "Robinhood Individual -") ?? "Robinhood";
  const holdings: PortfolioHolding[] = [];
  let activeDescription: string | null = null;
  let inPortfolioSummary = false;

  for (const line of lines) {
    if (line.includes("Portfolio Summary")) {
      inPortfolioSummary = true;
      activeDescription = null;
      continue;
    }

    if (!inPortfolioSummary) {
      continue;
    }

    if (line.includes("Account Activity") || line.startsWith("Total Priced Portfolio")) {
      inPortfolioSummary = false;
      activeDescription = null;
      continue;
    }

    if (line.startsWith("Estimated Yield:")) {
      continue;
    }

    const holdingMatch = line.match(
      /^([A-Z][A-Z0-9.]{0,9})Margin([0-9.,]+)\$([0-9,]+\.\d{5})\$([0-9,]+\.\d{2})\$([0-9,]+\.\d{2})(-?[0-9,]+\.\d{2})%?$/
    );

    if (holdingMatch) {
      holdings.push({
        account,
        symbol: holdingMatch[1],
        description: activeDescription ?? holdingMatch[1],
        quantity: parseNumberLike(holdingMatch[2]),
        price: parseCurrency(holdingMatch[3]),
        currentValue: parseCurrency(holdingMatch[4]) ?? 0,
        costBasis: null,
        totalGainDollar: null,
        totalGainPercent: null,
        todayGainDollar: null,
        todayGainPercent: null,
        percentOfAccount: parsePercent(holdingMatch[6]),
        securityType: "Equity",
        sourceFile,
        sourceFormat: "pdf"
      });
      activeDescription = null;
      continue;
    }

    const cashMatch = line.match(/^Brokerage Cash Balance\$([0-9,]+\.\d{2})([0-9,]+\.\d{2})%?$/);
    if (cashMatch) {
      holdings.push({
        account,
        symbol: "CASH",
        description: "Brokerage Cash Balance",
        quantity: null,
        price: null,
        currentValue: parseCurrency(cashMatch[1]) ?? 0,
        costBasis: null,
        totalGainDollar: null,
        totalGainPercent: null,
        todayGainDollar: null,
        todayGainPercent: null,
        percentOfAccount: parsePercent(cashMatch[2]),
        securityType: "Cash",
        sourceFile,
        sourceFormat: "pdf"
      });
      continue;
    }

    if (
      !line.startsWith("Page ") &&
      !line.includes("Securities Held in Account") &&
      !line.includes("Estimated Yield") &&
      !line.startsWith("Total Securities")
    ) {
      activeDescription = line;
    }
  }

  return holdings.filter((holding) => holding.currentValue > 0);
}

function parseBettermentHoldingLine(
  line: string,
  descriptionPrefix: string | null,
  account: string,
  sourceFile: string
): PortfolioHolding | null {
  const match = line.match(/^(.+?)([0-9]+\.[0-9]{6})\$([0-9,]+\.\d{2})(-?[0-9]+\.[0-9]{6})(-?\$[0-9,]+\.\d{2})([0-9]+\.[0-9]{6})\$([0-9,]+\.\d{2})$/);

  if (!match) {
    return null;
  }

  const prefix = match[1];
  const tickerRun = prefix.match(/[A-Z]{2,10}$/)?.[0] ?? "";
  const symbol = tickerRun.startsWith("ETF") && tickerRun.length > 3 ? tickerRun.slice(3) : tickerRun;
  const descriptionSuffix = tickerRun.startsWith("ETF") ? "ETF" : "";
  const descriptionStem = tickerRun ? prefix.slice(0, -tickerRun.length) : prefix;
  const description = `${descriptionPrefix ?? ""}${descriptionStem}${descriptionSuffix}`.replace(/\s+/g, " ").replace(/ETFETF/g, "ETF").trim();
  const startingValue = parseCurrency(match[3]);
  const endingValue = parseCurrency(match[7]);
  const changeValue = parseCurrency(match[5]);

  if (!looksLikeSymbol(symbol)) {
    return null;
  }

  return {
    account,
    symbol,
    description: description || symbol,
    quantity: parseNumberLike(match[6]),
    price: null,
    currentValue: endingValue ?? 0,
    costBasis: startingValue,
    totalGainDollar: changeValue,
    totalGainPercent: startingValue && changeValue !== null ? changeValue / startingValue : null,
    todayGainDollar: null,
    todayGainPercent: null,
    percentOfAccount: null,
    securityType: "ETF",
    sourceFile,
    sourceFormat: "pdf"
  };
}

function parseBettermentHoldings(lines: string[], sourceFile: string): PortfolioHolding[] {
  if (!lines.some((line) => line.includes("Betterment"))) {
    return [];
  }

  const sections: Array<{ account: string; holdings: PortfolioHolding[] }> = [];
  let activeAccount: string | null = null;
  let inHoldings = false;
  let pendingDescription: string | null = null;

  for (const line of lines) {
    if (
      line === "Taxable Investing Account" ||
      line.endsWith(" - Automated Investing") ||
      line === "Major Purchase - Automated Investing"
    ) {
      activeAccount = line;
      inHoldings = false;
      pendingDescription = null;
      continue;
    }

    if (line === "HOLDINGS" && activeAccount) {
      inHoldings = true;
      pendingDescription = null;
      if (!sections.some((section) => section.account === activeAccount)) {
        sections.push({ account: activeAccount, holdings: [] });
      }
      continue;
    }

    if (!inHoldings || !activeAccount) {
      continue;
    }

    if (
      line.startsWith("Account #") ||
      line.includes("Monthly Overview") ||
      line === "No holdings" ||
      line.startsWith("Total$") ||
      line === "ETFs" ||
      line.startsWith("StartingChangeEnding") ||
      line === "2" ||
      line.includes("TypeDescriptionTickerSharesValue")
    ) {
      if (line.startsWith("Account #") || line.includes("Monthly Overview") || line === "No holdings") {
        inHoldings = false;
      }
      pendingDescription = null;
      continue;
    }

    if (!line.includes("$")) {
      pendingDescription = pendingDescription ? `${pendingDescription} ${line}` : line;
      continue;
    }

    const holding = parseBettermentHoldingLine(line, pendingDescription, activeAccount, sourceFile);
    if (holding) {
      sections.find((section) => section.account === activeAccount)?.holdings.push(holding);
      pendingDescription = null;
    }
  }

  const nonAggregateSections = sections.filter(
    (section) => section.account !== "Taxable Investing Account" && section.holdings.length > 0
  );

  if (nonAggregateSections.length > 0) {
    return nonAggregateSections.flatMap((section) => section.holdings);
  }

  return sections.flatMap((section) => section.holdings);
}

function parseHoldingTokens(tokens: string[], sourceFile: string, account: string | null): PortfolioHolding | null {
  if (tokens.length < 4) {
    return null;
  }

  const workingTokens = [...tokens];
  let securityType: string | null = null;

  if (workingTokens.length > 4 && parseNumberLike(workingTokens.at(-1)) === null && parsePercent(workingTokens.at(-1)) === null) {
    securityType = stringOrNull(workingTokens.pop());
  }

  const totalGainPercent = parsePercent(workingTokens.at(-1));
  if (workingTokens.length >= 4 && totalGainPercent !== null) {
    workingTokens.pop();
  }

  const totalGainDollar = workingTokens.length >= 4 ? parseCurrency(workingTokens.pop()) : null;
  const costBasis = workingTokens.length >= 3 ? parseCurrency(workingTokens.pop()) : null;
  const currentValue = workingTokens.length >= 2 ? parseCurrency(workingTokens.pop()) : null;

  if (currentValue === null) {
    return null;
  }

  let quantity: number | null = null;
  let price: number | null = null;

  if (workingTokens.length >= 3) {
    const maybePrice = parseCurrency(workingTokens.at(-1));
    const maybeQuantity = parseNumberLike(workingTokens.at(-2));

    if (maybePrice !== null && maybeQuantity !== null) {
      price = maybePrice;
      quantity = maybeQuantity;
      workingTokens.pop();
      workingTokens.pop();
    }
  }

  const symbol = cleanCellValue(workingTokens.shift());
  const description = cleanCellValue(workingTokens.join(" "));

  if (!looksLikeSymbol(symbol) || !description) {
    return null;
  }

  return {
    account: buildAccountLabel(account, null),
    symbol,
    description,
    quantity,
    price,
    currentValue,
    costBasis,
    totalGainDollar,
    totalGainPercent,
    todayGainDollar: null,
    todayGainPercent: null,
    percentOfAccount: null,
    securityType,
    sourceFile,
    sourceFormat: "pdf"
  };
}

export function parsePdfText(sourceFile: string, text: string): ParsedPortfolioFile {
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanCellValue(line))
    .filter(Boolean);
  const warnings: AnalysisWarning[] = [];

  if (lines.length < 2 || text.trim().length < 20) {
    warnings.push({
      code: "image-only-pdf",
      sourceFile,
      message: "The PDF did not contain enough extractable text. Scanned or image-only PDFs are not supported."
    });
    return { accountSummaries: [], holdings: [], warnings };
  }

  let activeAccount: string | null = null;
  let accountSummaryHeader: Map<string, number> | null = null;
  let activeHoldingsHeader: Map<string, number> | null = null;
  const accountSummaries: AccountSummary[] = [];
  const holdings: PortfolioHolding[] = [];
  const brokerSpecificHoldings = [...parseRobinhoodHoldings(lines, sourceFile), ...parseBettermentHoldings(lines, sourceFile)];

  if (brokerSpecificHoldings.length > 0) {
    return { accountSummaries: [], holdings: brokerSpecificHoldings, warnings };
  }

  for (const line of lines) {
    const tokens = splitPdfLine(line);
    const account = extractAccountFromLine(line);

    if (account) {
      activeAccount = account;
      accountSummaryHeader = null;
      continue;
    }

    if (accountSummaryHeader) {
      const summary = parseAccountSummaryTokens(tokens, accountSummaryHeader, sourceFile);
      if (summary) {
        accountSummaries.push(summary);
        activeAccount = summary.account;
        continue;
      }

      accountSummaryHeader = null;
    }

    if (isAccountSummaryHeader(tokens)) {
      accountSummaryHeader = createHeaderMap(tokens);
      activeHoldingsHeader = null;
      continue;
    }

    if (isHoldingsHeader(tokens)) {
      activeHoldingsHeader = createHeaderMap(tokens);
      continue;
    }

    if (isHeaderLine(line)) {
      continue;
    }

    const holding = activeHoldingsHeader
      ? parseHeaderBasedHolding(tokens, activeHoldingsHeader, sourceFile, activeAccount)
      : parseHoldingTokens(tokens, sourceFile, activeAccount);

    if (holding) {
      holdings.push(holding);
    }
  }

  if (holdings.length === 0) {
    warnings.push({
      code: "low-confidence-pdf",
      sourceFile,
      message: "The PDF text was extracted, but no holdings could be confidently parsed from it."
    });
  }

  return { accountSummaries, holdings, warnings };
}

export async function parsePdfFile(
  sourceFile: string,
  buffer: Buffer,
  extractText: PdfTextExtractor = defaultPdfTextExtractor
): Promise<ParsedPortfolioFile> {
  try {
    const text = await extractText(buffer);
    return parsePdfText(sourceFile, text);
  } catch {
      return {
        accountSummaries: [],
        holdings: [],
        warnings: [
        {
          code: "low-confidence-pdf",
          sourceFile,
          message: "The PDF could not be read as a text-based statement."
        }
      ]
    };
  }
}
