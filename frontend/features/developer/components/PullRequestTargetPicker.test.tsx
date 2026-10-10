import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PullRequestTargetPicker } from "./PullRequestTargetPicker";

it("keeps search result boundaries visible with borderless buttons and selects a target", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../../index.css"), "utf8");
  const style = document.createElement("style");
  // Supply the built border utility and token; exercise the actual appearance override.
  style.textContent = ".app-search-result { border: 1px solid rgb(100, 100, 100); }"
    + css.slice(css.indexOf("/* Preserve button geometry"), css.indexOf("/* Numeric controls"));
  document.head.append(style);
  const previous = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "filled_borderless";
  const select = vi.fn();
  try {
    render(<PullRequestTargetPicker open onOpenChange={() => {}} actionLabel="Add example project" inputId="example-project-search"
      fieldLabel="Project" query="EXAMPLE" onQueryChange={() => {}} placeholder="Search example project" searching={false}
      searchingLabel="Searching" resultsLabel="Example project results"
      options={[{ key: "example-project", primary: "EXAMPLE", secondary: "Example Project", accessibleName: "EXAMPLE (Example Project)" }]}
      onSelect={select} />);
    const result = screen.getByRole("button", { name: "EXAMPLE (Example Project)" });
    expect(getComputedStyle(result).borderWidth).toBe("1px");
    expect(getComputedStyle(result).borderColor).toBe("rgb(100, 100, 100)");
    fireEvent.click(result);
    expect(select).toHaveBeenCalledWith("example-project");
  } finally {
    style.remove();
    if (previous === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previous;
  }
});
