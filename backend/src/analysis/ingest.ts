import path from "node:path";

import { analyzeHoldings } from "../../../shared/src/analysis.ts";
import type { AnalysisWarning, PortfolioAnalysis, PortfolioHolding } from "../../../shared/src/types.ts";
import { parseCsvFile } from "../parsers/csv.ts";
import { parsePdfFile } from "../parsers/pdf.ts";
import type { ParsedPortfolioFile } from "../parsers/types.ts";
import { looksLikeDate } from "../utils/normalization.ts";

export const MAX_UPLOAD_FILES = 10;

function isCsvFile(file: Express.Multer.File): boolean {
  const extension = path.extname(file.originalname).toLowerCase();
  return extension === ".csv" || file.mimetype === "text/csv" || file.mimetype === "application/vnd.ms-excel";
}

function isPdfFile(file: Express.Multer.File): boolean {
  const extension = path.extname(file.originalname).toLowerCase();
  return extension === ".pdf" || file.mimetype === "application/pdf";
}

async function parseUploadedFile(file: Express.Multer.File): Promise<ParsedPortfolioFile> {
  if (isCsvFile(file)) {
    return parseCsvFile(file.originalname, file.buffer.toString("utf8"));
  }

  if (isPdfFile(file)) {
    return parsePdfFile(file.originalname, file.buffer);
  }

  return {
    accountSummaries: [],
    holdings: [],
    warnings: [
      {
        code: "unsupported-file",
        sourceFile: file.originalname,
        message: `Unsupported file type for ${file.originalname}. Upload CSV or text-based PDF files only.`
      }
    ]
  };
}

function appendDuplicateWarnings(holdings: PortfolioHolding[], warnings: AnalysisWarning[]): void {
  const seen = new Map<string, string>();

  for (const holding of holdings) {
    if ((holding.symbol && looksLikeDate(holding.symbol)) || (!holding.symbol && looksLikeDate(holding.description))) {
      continue;
    }

    const key = `${holding.account.toLowerCase()}|${holding.symbol.toLowerCase()}|${holding.description.toLowerCase()}`;

    if (!holding.symbol && !holding.description) {
      continue;
    }

    const existingFile = seen.get(key);

    if (existingFile) {
      warnings.push({
        code: "duplicate-position",
        sourceFile: holding.sourceFile,
        message: `Duplicate position detected for ${holding.symbol || holding.description} in ${holding.account}. Also present in ${existingFile}.`
      });
      continue;
    }

    seen.set(key, holding.sourceFile);
  }
}

export async function analyzeUploadedFiles(files: Express.Multer.File[]): Promise<PortfolioAnalysis> {
  const parsedFiles = await Promise.all(files.map((file) => parseUploadedFile(file)));
  const accountSummaries = parsedFiles.flatMap((result) => result.accountSummaries);
  const holdings = parsedFiles.flatMap((result) => result.holdings);
  const warnings = parsedFiles.flatMap((result) => result.warnings);

  appendDuplicateWarnings(holdings, warnings);

  return analyzeHoldings(holdings, warnings, accountSummaries);
}
