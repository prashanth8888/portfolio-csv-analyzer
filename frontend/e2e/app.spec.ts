import { expect, test } from "@playwright/test";

test("uploads a sample CSV and renders the summary dashboard", async ({ page }) => {
  await page.route("http://127.0.0.1:4177/api/analyze", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          currentValue: 1000,
          costBasis: 800,
          totalGainDollar: 200,
          totalGainPercent: 0.25,
          todayGainDollar: 10
        },
        allocations: {
          bySymbol: [
            { name: "AAA", value: 500, weight: 0.5 },
            { name: "BBB", value: 300, weight: 0.3 },
            { name: "CCC", value: 200, weight: 0.2 }
          ],
          byAccount: [
            { name: "Sample Brokerage", value: 700, weight: 0.7 },
            { name: "Sample Retirement", value: 300, weight: 0.3 }
          ],
          bySecurityType: [
            { name: "Equity", value: 600, weight: 0.6 },
            { name: "ETF", value: 400, weight: 0.4 }
          ]
        },
        accounts: [
          { account: "Sample Brokerage", value: 700, gainDollar: 140, gainPercent: 0.25, holdings: 2 },
          { account: "Sample Retirement", value: 300, gainDollar: 60, gainPercent: 0.25, holdings: 1 }
        ],
        holdings: [
          {
            account: "Sample Brokerage",
            symbol: "AAA",
            description: "Sample Alpha",
            quantity: 10,
            price: 50,
            currentValue: 500,
            costBasis: 400,
            totalGainDollar: 100,
            totalGainPercent: 0.25,
            todayGainDollar: 5,
            todayGainPercent: 0.01,
            percentOfAccount: 0.5,
            securityType: "Equity",
            sourceFile: "sample.csv",
            sourceFormat: "csv"
          }
        ],
        topMovers: {
          gainers: [
            {
              symbol: "AAA",
              description: "Sample Alpha",
              currentValue: 500,
              totalGainDollar: 100,
              totalGainPercent: 0.25,
              account: "Sample Brokerage"
            }
          ],
          laggards: [
            {
              symbol: "BBB",
              description: "Sample Beta",
              currentValue: 300,
              totalGainDollar: -10,
              totalGainPercent: -0.03,
              account: "Sample Brokerage"
            }
          ]
        },
        projections: [
          { scenario: "conservative", years: 2, nominalValue: 1080, realValue: 1030, annualReturn: 0.04 },
          { scenario: "conservative", years: 3, nominalValue: 1120, realValue: 1050, annualReturn: 0.04 },
          { scenario: "conservative", years: 5, nominalValue: 1220, realValue: 1080, annualReturn: 0.04 },
          { scenario: "conservative", years: 7, nominalValue: 1320, realValue: 1110, annualReturn: 0.04 },
          { scenario: "conservative", years: 10, nominalValue: 1480, realValue: 1160, annualReturn: 0.04 },
          { scenario: "base", years: 2, nominalValue: 1150, realValue: 1100, annualReturn: 0.07 },
          { scenario: "base", years: 3, nominalValue: 1230, realValue: 1140, annualReturn: 0.07 },
          { scenario: "base", years: 5, nominalValue: 1400, realValue: 1240, annualReturn: 0.07 },
          { scenario: "base", years: 7, nominalValue: 1600, realValue: 1340, annualReturn: 0.07 },
          { scenario: "base", years: 10, nominalValue: 1970, realValue: 1540, annualReturn: 0.07 },
          { scenario: "optimistic", years: 2, nominalValue: 1210, realValue: 1160, annualReturn: 0.1 },
          { scenario: "optimistic", years: 3, nominalValue: 1330, realValue: 1230, annualReturn: 0.1 },
          { scenario: "optimistic", years: 5, nominalValue: 1610, realValue: 1420, annualReturn: 0.1 },
          { scenario: "optimistic", years: 7, nominalValue: 1950, realValue: 1630, annualReturn: 0.1 },
          { scenario: "optimistic", years: 10, nominalValue: 2590, realValue: 2030, annualReturn: 0.1 }
        ],
        warnings: [
          {
            code: "low-confidence-pdf",
            message: "Recovered values from a synthetic PDF fixture.",
            sourceFile: "sample.pdf"
          }
        ]
      })
    });
  });

  await page.goto("/");
  await page.setInputFiles('[data-testid="file-input"]', [
    {
      name: "sample.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("symbol,currentValue\nAAA,500\n")
    },
    {
      name: "sample.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4")
    }
  ]);
  await page.getByTestId("analyze-button").click();

  await expect(page.getByTestId("summary-grid")).toBeVisible();
  await expect(page.getByTestId("summary-current-value")).toContainText("$");
  await expect(page.getByTestId("account-allocation-chart")).toContainText("Value by account");
  await expect(page.getByTestId("sp500-tracker")).toContainText("S&P 500 tracker");
  await expect(page.getByTestId("holdings-table")).toBeVisible();

  await page.getByTestId("annual-contribution-select").selectOption("100000");
  await expect(page.getByTestId("annual-contribution-input")).toHaveValue("100000");
  await expect(page.getByTestId("projection-panel")).toContainText("$100,000 invested yearly");
});
