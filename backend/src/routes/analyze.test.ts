import multer from "multer";
import { describe, expect, it, vi } from "vitest";

import { analyzeErrorHandler, handleAnalyzeRequest } from "./analyze";

function createUpload(filename: string, content: string, mimetype: string): Express.Multer.File {
  return {
    fieldname: "files",
    originalname: filename,
    encoding: "7bit",
    mimetype,
    size: Buffer.byteLength(content),
    destination: "",
    filename,
    path: "",
    buffer: Buffer.from(content, "utf8"),
    stream: undefined as never
  };
}

function createResponseDouble() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    }
  };
}

describe("handleAnalyzeRequest", () => {
  it("returns portfolio analysis for uploaded CSV files", async () => {
    const csv = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Total Gain/Loss Dollar,Total Gain/Loss Percent,Cost Basis Total,Type
,Sample Account,AAA,SAMPLE FUND,2,$10.00,"$20.00","$4.00",25.00%,"$16.00",ETF`;
    const response = createResponseDouble();
    const next = vi.fn();

    await handleAnalyzeRequest(
      { files: [createUpload("positions.csv", csv, "text/csv")] } as never,
      response as never,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      summary: {
        currentValue: 20,
        costBasis: 16,
        totalGainDollar: 4
      }
    });
  });

  it("rejects requests without attached files", async () => {
    const response = createResponseDouble();
    const next = vi.fn();

    await handleAnalyzeRequest({ files: [] } as never, response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Attach between 1 and 10 CSV or PDF files using the files field."
    });
  });
});

describe("analyzeErrorHandler", () => {
  it("maps multer file-count errors to a 400 response", () => {
    const response = createResponseDouble();
    const next = vi.fn();

    analyzeErrorHandler(new multer.MulterError("LIMIT_FILE_COUNT"), {} as never, response as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({
      error: "Attach no more than 10 files per request."
    });
  });
});
