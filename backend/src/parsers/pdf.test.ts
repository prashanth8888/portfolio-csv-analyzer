import { describe, expect, it } from "vitest";

import { parsePdfFile, parsePdfText } from "./pdf";

describe("parsePdfText", () => {
  it("parses holdings from extracted tabular text", () => {
    const text = `Account: Sample Retirement
Symbol  Description  Quantity  Price  Current Value  Cost Basis  Total Gain  Total Gain %
AAA  Sample Broad Market ETF  2  $10.00  $20.00  $16.00  $4.00  25.00%  ETF
BBB  Sample International ETF  3  $10.00  $30.00  $24.00  $6.00  25.00%  ETF`;

    const result = parsePdfText("statement.pdf", text);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({
      account: "Sample Retirement",
      symbol: "AAA",
      currentValue: 20,
      costBasis: 16,
      totalGainDollar: 4,
      totalGainPercent: 0.25,
      sourceFormat: "pdf"
    });
    expect(result.warnings).toHaveLength(0);
  });

  it("warns for image-only or unreadable PDF content", async () => {
    const result = await parsePdfFile("scan.pdf", Buffer.from("pdf"), async () => "");

    expect(result.holdings).toHaveLength(0);
    expect(result.warnings).toEqual([
      expect.objectContaining({
        code: "image-only-pdf",
        sourceFile: "scan.pdf"
      })
    ]);
  });

  it("parses sectioned extracted PDF text with generic brokerage headers", () => {
    const text = [
      "Account Summary",
      "Account\tNet Account Value\tTotal Gain $\tTotal Gain %\tDay's Gain Unrealized $\tDay's Gain Unrealized %",
      "Sample Brokerage -0000\t100.00\t20.00\t25.00\t5.00\t5.00",
      "",
      "View Summary - Performance",
      "Symbol\tLast Price $\tChange $\tChange %\tDay's Gain $\tQty #\tPrice Paid $\tTotal Gain $\tTotal Gain %\tValue $",
      "CCC\t10.00\t1.00\t10.00\t2.00\t5\t8.00\t10.00\t25.00\t50.00",
      "DDD\t20.00\t1.00\t5.00\t1.00\t2\t15.00\t10.00\t33.33\t40.00"
    ].join("\n");

    const result = parsePdfText("statement.pdf", text);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({
      account: "Sample Brokerage -0000",
      symbol: "CCC",
      quantity: 5,
      price: 10,
      currentValue: 50,
      costBasis: 40,
      totalGainDollar: 10,
      totalGainPercent: 0.25,
      todayGainDollar: 2,
      sourceFormat: "pdf"
    });
    expect(result.accountSummaries).toEqual([
      expect.objectContaining({
        account: "Sample Brokerage -0000",
        value: 100,
        gainDollar: 20,
        gainPercent: 0.25
      })
    ]);
    expect(result.warnings).toHaveLength(0);
  });

  it("parses broker portfolio summary text with glued columns", () => {
    const text = [
      "Robinhood Securities, LLC",
      "Individual Account #:000000",
      "Portfolio Summary",
      "Securities Held in AccountSym/CusipAcct TypeQtyPriceMkt ValueEst. Dividend Yield% of Total Portfolio",
      "Sample Alpha",
      "Estimated Yield: 0.50%",
      "AAAMargin2.000000$10.00000$20.00$1.0020.00%",
      "Sample Beta",
      "Estimated Yield: 0.00%",
      "BBBMargin3.000000$10.00000$30.00$0.0030.00%",
      "Total Securities$50.00$1.0050.00%",
      "Brokerage Cash Balance$5.005.00%",
      "Total Priced Portfolio$55.00"
    ].join("\n");

    const result = parsePdfText("broker.pdf", text);

    expect(result.holdings.map((holding) => holding.symbol)).toEqual(["AAA", "BBB", "CASH"]);
    expect(result.holdings[0]).toMatchObject({
      account: "Robinhood Individual -000000",
      description: "Sample Alpha",
      currentValue: 20,
      percentOfAccount: 0.2
    });
    expect(result.holdings.reduce((sum, holding) => sum + holding.currentValue, 0)).toBeCloseTo(55);
    expect(result.warnings).toHaveLength(0);
  });

  it("parses automated investing holdings text with glued ETF tickers and split descriptions", () => {
    const text = [
      "Betterment",
      "Taxable Investing Account",
      "HOLDINGS",
      "StartingChangeEnding",
      "TypeDescriptionTickerSharesValueSharesValueSharesValue",
      "Sample Emerging Markets Bond",
      "ETF",
      "CCC2.000000$20.000.000000-$2.002.000000$18.00",
      "Sample Total Market ETFDDD3.000000$30.000.000000-$3.003.000000$27.00",
      "Total$50.00-$5.00$45.00",
      "Sample Goal - Automated Investing",
      "HOLDINGS",
      "StartingChangeEnding",
      "TypeDescriptionTickerSharesValueSharesValueSharesValue",
      "Sample Aggregate Bond ETFEEE4.000000$40.000.000000-$4.004.000000$36.00",
      "Sample Inflation-Protected Securities",
      "ETF",
      "FFF5.000000$50.000.000000$5.005.000000$55.00",
      "Total$90.00$1.00$91.00"
    ].join("\n");

    const result = parsePdfText("automated.pdf", text);

    expect(result.holdings.map((holding) => holding.symbol)).toEqual(["EEE", "FFF"]);
    expect(result.holdings[1]).toMatchObject({
      account: "Sample Goal - Automated Investing",
      symbol: "FFF",
      description: "Sample Inflation-Protected Securities ETF",
      currentValue: 55,
      totalGainDollar: 5
    });
    expect(result.warnings).toHaveLength(0);
  });
});
