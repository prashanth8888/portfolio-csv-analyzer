import { describe, expect, it } from "vitest";

import { MAX_FILES, canAnalyzeFiles, selectFiles } from "./file-utils";

function buildFile(name: string) {
  return new File(["content"], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/csv" });
}

describe("selectFiles", () => {
  it("filters unsupported extensions", () => {
    const result = selectFiles([], [buildFile("portfolio.csv"), buildFile("notes.txt")]);

    expect(result.files).toHaveLength(1);
    expect(result.rejectedNames).toEqual(["notes.txt"]);
  });

  it("enforces the 10-file limit", () => {
    const files = Array.from({ length: MAX_FILES + 1 }, (_, index) => buildFile(`portfolio-${index}.csv`));
    const result = selectFiles([], files);

    expect(result.files).toHaveLength(MAX_FILES);
    expect(result.limitExceeded).toBe(true);
  });
});

describe("canAnalyzeFiles", () => {
  it("accepts selections between 1 and 10 files", () => {
    expect(canAnalyzeFiles([])).toBe(false);
    expect(canAnalyzeFiles([buildFile("portfolio.csv")])).toBe(true);
  });
});
