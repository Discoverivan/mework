import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Input } from "./input";
import { Button } from "./button";

it("uses the same boundary for hover, focused input and an open picker", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = ".app-control-border { border: 1px solid rgb(100, 100, 100); }" + css.slice(css.indexOf("/* Preserve button geometry"), css.indexOf("/* All cards, including empty states"))
    .replace(/var\(--primary\)/g, "rgb(70, 90, 180)");
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "filled_borderless";
  try {
    render(<><Input aria-label="Example query" /><Button role="combobox" variant="outline" aria-expanded="true">Example picker</Button></>);
    const input = screen.getByRole("textbox", { name: "Example query" });
    fireEvent.pointerEnter(input);
    const hoveredBorder = getComputedStyle(input).borderColor;
    expect(hoveredBorder).toBe("rgb(70, 90, 180)");
    input.focus();
    fireEvent.pointerLeave(input);
    style.textContent += "\n";
    expect(getComputedStyle(input).borderColor).toBe(hoveredBorder);
    expect(getComputedStyle(input).boxShadow).toBe("none");
    expect(getComputedStyle(screen.getByRole("combobox")).borderColor).toBe(hoveredBorder);
    input.blur();
    style.textContent += "\n";
    expect(getComputedStyle(input).borderColor).toBe("rgb(100, 100, 100)");
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});
