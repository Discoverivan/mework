import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Label } from "./label";
import { FieldLabel } from "./field";

it("removes field-label indentation only in Minimal while preserving inline labels", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = ".pl-1 { padding-left: 4px; } .pl-0 { padding-left: 0; }" + css.slice(css.indexOf("/* Minimal field values"));
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  try {
    render(<>
      <Label htmlFor="name">Name</Label>
      <input id="name" />
      <Label htmlFor="enabled" alignment="inline">Enabled</Label>
      <input id="enabled" type="checkbox" />
      <FieldLabel htmlFor="example-description">Example description</FieldLabel>
      <input id="example-description" />
    </>);

    expect(screen.getByText("Name")).toHaveClass("pl-1");
    expect(screen.getByText("Enabled")).toHaveClass("pl-0");
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeInTheDocument();
    for (const appearance of ["filled", "filled_borderless", "quiet"]) {
      document.documentElement.dataset.buttonStyle = appearance;
      style.textContent += "\n";
      for (const name of ["Name", "Example description"]) {
        expect(getComputedStyle(screen.getByText(name)).paddingLeft).toBe(appearance === "quiet" ? "0px" : "4px");
      }
      expect(getComputedStyle(screen.getByText("Enabled")).paddingLeft).toBe("0px");
    }
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});
