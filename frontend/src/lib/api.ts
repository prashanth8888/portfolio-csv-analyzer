import type { PortfolioAnalysis } from "@shared/types";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:4177";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPortfolioAnalysis(value: unknown): value is PortfolioAnalysis {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.summary) &&
    Array.isArray(value.holdings) &&
    isRecord(value.allocations) &&
    Array.isArray(value.accounts) &&
    isRecord(value.topMovers) &&
    Array.isArray(value.projections) &&
    Array.isArray(value.warnings)
  );
}

export async function analyzePortfolio(files: File[]): Promise<PortfolioAnalysis> {
  const formData = new FormData();

  for (const file of files) {
    formData.append("files", file);
  }

  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? DEFAULT_API_BASE_URL;
  const response = await fetch(`${apiBaseUrl}/api/analyze`, {
    method: "POST",
    body: formData
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    if (isRecord(payload) && typeof payload.error === "string") {
      throw new Error(payload.error);
    }

    if (isRecord(payload) && typeof payload.message === "string") {
      throw new Error(payload.message);
    }

    if (typeof payload === "string" && payload.trim()) {
      throw new Error(payload);
    }

    throw new Error("Analysis failed. Confirm the backend is running on localhost:4177.");
  }

  if (!isPortfolioAnalysis(payload)) {
    throw new Error("The backend returned an unexpected analysis payload.");
  }

  return payload;
}
