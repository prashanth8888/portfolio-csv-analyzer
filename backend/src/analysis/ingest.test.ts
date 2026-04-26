import { describe, expect, it } from "vitest";

import { analyzeUploadedFiles } from "./ingest";

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

describe("analyzeUploadedFiles", () => {
  it("analyzes uploaded CSV files", async () => {
    const csv = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Total Gain/Loss Dollar,Total Gain/Loss Percent,Cost Basis Total,Type
,Sample Account,AAA,SAMPLE FUND,2,$10.00,"$20.00","$4.00",25.00%,"$16.00",ETF`;

    const response = await analyzeUploadedFiles([createUpload("positions.csv", csv, "text/csv")]);

    expect(response.summary).toMatchObject({
      currentValue: 20,
      costBasis: 16,
      totalGainDollar: 4
    });
    expect(response.holdings).toHaveLength(1);
    expect(response.warnings).toEqual([]);
  });

  it("flags unsupported upload types without failing the rest of the batch", async () => {
    const csv = `Account,Symbol,Description,Current Value
Sample Account,BBB,Sample Company,"$20.00"`;

    const response = await analyzeUploadedFiles([
      createUpload("positions.csv", csv, "text/csv"),
      createUpload("notes.txt", "not supported", "text/plain")
    ]);

    expect(response.holdings).toHaveLength(1);
    expect(response.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unsupported-file",
          sourceFile: "notes.txt"
        })
      ])
    );
  });

  it("uses account summary values for account allocation when present", async () => {
    const csv = [
      "Account Summary",
      "Account,Net Account Value,Total Gain $,Total Gain %",
      "Sample Brokerage,70.00,14.00,25.00",
      "Sample Retirement,30.00,6.00,25.00",
      "Symbol,Account,Current Value,Total Gain $,Total Gain %",
      "AAA,Sample Brokerage,50.00,10.00,25.00",
      "BBB,Sample Retirement,20.00,4.00,25.00"
    ].join("\n");

    const response = await analyzeUploadedFiles([createUpload("sectioned.csv", csv, "text/csv")]);

    expect(response.allocations.byAccount).toEqual([
      expect.objectContaining({ name: "Sample Brokerage", value: 70, weight: 0.7 }),
      expect.objectContaining({ name: "Sample Retirement", value: 30, weight: 0.3 })
    ]);
    expect(response.accounts).toEqual([
      expect.objectContaining({ account: "Sample Brokerage", value: 70, holdings: 1 }),
      expect.objectContaining({ account: "Sample Retirement", value: 30, holdings: 1 })
    ]);
  });

  it("does not report duplicate positions for date-like non-holding rows", async () => {
    const csv = [
      "Account Summary",
      "Account\tNet Account Value\tTotal Gain $\tTotal Gain %",
      "Sample Brokerage -0000\t100.00\t20.00\t25.00",
      "Symbol\tLast Price $\tChange $\tChange %\tDay's Gain $\tQty #\tPrice Paid $\tTotal Gain $\tTotal Gain %\tValue $",
      "CCC\t10.00\t1.00\t10.00\t2.00\t5\t8.00\t10.00\t25.00\t50.00",
      "01/02/2099\t\t\t\t\t\t\t\t\t50.00",
      "2099-01-03\t\t\t\t\t\t\t\t\t50.00"
    ].join("\n");

    const response = await analyzeUploadedFiles([
      createUpload("sectioned.csv", csv, "text/csv"),
      createUpload("sectioned-copy.csv", csv, "text/csv")
    ]);

    expect(response.holdings.some((holding) => holding.symbol === "01/02/2099")).toBe(false);
    expect(response.holdings.some((holding) => holding.symbol === "2099-01-03")).toBe(false);
    expect(response.warnings.some((warning) => warning.message.includes("01/02/2099"))).toBe(false);
    expect(response.warnings.some((warning) => warning.message.includes("2099-01-03"))).toBe(false);
  });
});
