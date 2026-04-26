export function cleanCellValue(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\uFEFF/g, "").trim();
}

export function normalizeHeader(header: string): string {
  return cleanCellValue(header)
    .toLowerCase()
    .replace(/\$/g, " dollar ")
    .replace(/%/g, " percent ")
    .replace(/#/g, " number ")
    .replace(/[^a-z0-9]/g, "");
}

export function parseNumberLike(value: unknown): number | null {
  const raw = cleanCellValue(value);

  if (!raw) {
    return null;
  }

  const normalized = raw.replace(/[$,%]/g, "").replace(/,/g, "").replace(/\s+/g, "");
  const negativeWrapped = normalized.startsWith("(") && normalized.endsWith(")");
  const candidate = negativeWrapped ? `-${normalized.slice(1, -1)}` : normalized;
  const parsed = Number(candidate);

  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCurrency(value: unknown): number | null {
  return parseNumberLike(value);
}

export function parsePercent(value: unknown): number | null {
  const parsed = parseNumberLike(value);

  if (parsed === null) {
    return null;
  }

  return parsed / 100;
}

export function hasText(value: unknown): boolean {
  return cleanCellValue(value).length > 0;
}

export function stringOrNull(value: unknown): string | null {
  const cleaned = cleanCellValue(value);
  return cleaned ? cleaned : null;
}

export function buildAccountLabel(accountName: string | null, accountNumber: string | null): string {
  if (accountName && accountNumber && accountName !== accountNumber) {
    return `${accountName} (${accountNumber})`;
  }

  return accountName ?? accountNumber ?? "Unknown account";
}

export function looksLikeSymbol(value: string): boolean {
  return /^[A-Z0-9.*-]{1,15}$/i.test(value.trim());
}

export function looksLikeDate(value: string): boolean {
  const cleaned = cleanCellValue(value);

  return (
    /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cleaned) ||
    /^\d{4}-\d{1,2}-\d{1,2}$/.test(cleaned) ||
    /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}$/i.test(cleaned)
  );
}
