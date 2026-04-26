import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App", () => {
  it("renders the empty state before analysis", () => {
    render(<App />);

    expect(screen.getByTestId("empty-analysis")).toBeInTheDocument();
    expect(screen.getByTestId("analyze-button")).toBeDisabled();
  });

  it("accepts supported files into the upload list", () => {
    render(<App />);

    const fileInput = screen.getByTestId("file-input") as HTMLInputElement;
    const csvFile = new File(["Account,Current Value\nBrokerage,$100"], "portfolio.csv", { type: "text/csv" });

    fireEvent.change(fileInput, { target: { files: [csvFile] } });

    expect(screen.getByTestId("selected-count")).toHaveTextContent("1");
    expect(screen.getByTestId("selected-file-list")).toHaveTextContent("portfolio.csv");
    expect(screen.getByTestId("analyze-button")).toBeEnabled();
  });
});
