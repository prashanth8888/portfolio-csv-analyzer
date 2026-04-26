import { describe, expect, it } from "vitest";

import { parseCsvFile } from "./csv";

describe("parseCsvFile", () => {
  it("parses brokerage-style rows and skips disclaimer content", () => {
    const csv = `Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Type
,Sample Taxable,AAA,SAMPLE BROAD MARKET ETF,2,$10.00,"$20.00",$1.00,5.00%,"$4.00",25.00%,50.00%,"$16.00",ETF
0000,Sample Retirement,BBB,SAMPLE TARGET FUND,3,$20.00,"$60.00","$2.00",3.33%,"$12.00",25.00%,50.00%,"$48.00",Mutual Fund
"The data and information in this spreadsheet is provided to you solely for your use",,,,,,,,,,,,`;

    const result = parseCsvFile("portfolio.csv", csv);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings[0]).toMatchObject({
      account: "Sample Taxable",
      symbol: "AAA",
      currentValue: 20,
      totalGainDollar: 4,
      totalGainPercent: 0.25,
      sourceFormat: "csv"
    });
    expect(result.holdings[1].account).toBe("Sample Retirement (0000)");
    expect(result.warnings).toHaveLength(0);
  });

  it("supports generic gain aliases and warns when a gain percentage column is missing", () => {
    const csv = `Account,Ticker,Security Description,Shares,Price,Market Value,Cost Basis,Total Gain,Asset Class
Sample Account,CCC,SAMPLE COMPANY,4,$5.00,"$20.00","$12.00","$8.00",Equity`;

    const result = parseCsvFile("aliases.csv", csv);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]).toMatchObject({
      account: "Sample Account",
      symbol: "CCC",
      totalGainDollar: 8,
      totalGainPercent: null,
      costBasis: 12
    });
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing-columns",
          sourceFile: "aliases.csv",
          message: expect.stringContaining("totalGainPercent")
        })
      ])
    );
  });

  it("finds sectioned brokerage tables with unit-specific generic headers", () => {
    const csv = [
      "Account Summary\t\t\t\t\t\t\t\t",
      "Account\tNet Account Value\tTotal Gain $\tTotal Gain %\tDay's Gain Unrealized $\tDay's Gain Unrealized %\tAvailable For Withdrawal\tCash Purchasing Power\t",
      "Sample Brokerage -0000\t100.00\t20.00\t25.00\t5.00\t5.00\t1.00\t1.00\t",
      "\t\t\t\t\t\t\t\t",
      "View Summary - Performance\t\t\t\t\t\t\t\t",
      "Symbol\tLast Price $\tChange $\tChange %\tDay's Gain $\tQty #\tPrice Paid $\tTotal Gain $\tTotal Gain %\tValue $",
      "DDD\t10.00\t1.00\t10.00\t2.00\t5\t8.00\t10.00\t25.00\t50.00"
    ].join("\n");

    const result = parseCsvFile("sectioned.tsv", csv);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0]).toMatchObject({
      account: "Sample Brokerage -0000",
      symbol: "DDD",
      quantity: 5,
      price: 10,
      currentValue: 50,
      costBasis: 40,
      totalGainDollar: 10,
      totalGainPercent: 0.25,
      todayGainDollar: 2
    });
    expect(result.accountSummaries).toEqual([
      expect.objectContaining({
        account: "Sample Brokerage -0000",
        value: 100,
        gainDollar: 20,
        gainPercent: 0.25
      })
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("ignores date-like rows that appear below sectioned holdings tables", () => {
    const csv = [
      "Account Summary",
      "Account\tNet Account Value\tTotal Gain $\tTotal Gain %",
      "Sample Brokerage -0000\t100.00\t20.00\t25.00",
      "Symbol\tLast Price $\tChange $\tChange %\tDay's Gain $\tQty #\tPrice Paid $\tTotal Gain $\tTotal Gain %\tValue $",
      "EEE\t10.00\t1.00\t10.00\t2.00\t5\t8.00\t10.00\t25.00\t50.00",
      "01/02/2099\t\t\t\t\t\t\t\t\t50.00",
      "2099-01-03\t\t\t\t\t\t\t\t\t50.00"
    ].join("\n");

    const result = parseCsvFile("sectioned.csv", csv);

    expect(result.holdings.map((holding) => holding.symbol)).toEqual(["EEE"]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps cash but ignores total summary rows in sectioned CSVs", () => {
    const csv = [
      "Account Summary",
      "Account,Net Account Value,Total Gain $,Total Gain %",
      "\"Sample Brokerage -0000\",100.00,20.00,25.00",
      "Symbol,Last Price $,Change $,Change %,Day's Gain $,Qty #,Price Paid $,Total Gain $,Total Gain %,Value $",
      "FFF,10.00,1.00,10.00,2.00,5.00,8.00,10.00,25.00,50.00",
      "     01/02/2099,10.00,1.00,10.00,2.00,5.00,8.00,10.00,25.00,50.00",
      "CASH,,,,,,,,,5.00,",
      "TOTAL,,,,2.00,,40.00,10.00,25.00,55.00,"
    ].join("\n");

    const result = parseCsvFile("sectioned.csv", csv);

    expect(result.holdings.map((holding) => holding.symbol)).toEqual(["FFF", "CASH"]);
    expect(result.holdings.reduce((sum, holding) => sum + holding.currentValue, 0)).toBeCloseTo(55);
    expect(result.warnings).toEqual([]);
  });
});
