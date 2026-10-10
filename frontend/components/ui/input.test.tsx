import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Input } from "./input";
import { Button } from "./button";
import { ManualNumberField } from "@/components/shared/ManualNumberField";

it("shares numeric value feedback across Filled styles while preserving their border appearance", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = ".app-control-border { border: 1px solid rgb(100, 100, 100); }" + css.slice(css.indexOf("/* Preserve button geometry"), css.indexOf("/* All cards, including empty states"))
    .replace(/var\(--primary\)/g, "rgb(70, 90, 180)")
    .replace(/var\(--destructive\)/g, "rgb(180, 40, 40)");
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "filled_borderless";
  try {
    render(<ManualNumberField id="example-count" label="Example count" value={2} min={1} max={10}
      errors={{ required: "Enter a number", number: "Use a number", range: "Use 1 to 10" }} onChange={() => {}} />);
    const input = screen.getByRole("textbox", { name: "Example count" });
    for (const appearance of ["filled", "filled_borderless", "quiet"]) {
      document.documentElement.dataset.buttonStyle = appearance;
      fireEvent.pointerEnter(input);
      input.focus();
      style.textContent += "\n";
      expect(getComputedStyle(input).color).toBe("rgb(70, 90, 180)");
      expect(getComputedStyle(input).borderColor).toBe(appearance === "filled" ? "rgb(70, 90, 180)" : "rgba(0, 0, 0, 0)");
      fireEvent.change(input, { target: { value: "20" } });
      style.textContent += "\n";
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(getComputedStyle(input).color).toBe("rgb(180, 40, 40)");
      expect(getComputedStyle(input).borderColor).toBe(appearance === "filled" ? "rgb(180, 40, 40)" : "rgba(0, 0, 0, 0)");
      expect(screen.getByRole("alert")).toHaveTextContent("Use 1 to 10");
      fireEvent.change(input, { target: { value: "3" } });
      style.textContent += "\n";
      expect(input).toHaveAttribute("aria-invalid", "false");
      expect(getComputedStyle(input).color).toBe("rgb(70, 90, 180)");
      expect(getComputedStyle(input).borderColor).toBe(appearance === "filled" ? "rgb(70, 90, 180)" : "rgba(0, 0, 0, 0)");
    }
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});

it("highlights open pickers through text and the selected border style", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = ".app-control-border { border: 1px solid rgb(100, 100, 100); padding: 8px 12px; }" + css.slice(css.indexOf("/* Preserve button geometry"), css.indexOf("/* All cards, including empty states"))
    .replace(/var\(--primary\)/g, "rgb(70, 90, 180)")
    // jsdom does not distinguish mouse focus from keyboard focus like a browser.
    .replace(/:focus-visible/g, '[data-example-keyboard-focus="true"]');
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "filled_borderless";
  try {
    render(<><Input aria-label="Example query" /><Button role="combobox" variant="outline" aria-expanded="false">Example picker</Button></>);
    const picker = screen.getByRole("combobox");
    expect(getComputedStyle(picker).paddingLeft).toBe("12px");
    fireEvent.pointerEnter(picker);
    style.textContent += "\n";
    expect(getComputedStyle(picker).borderColor).toBe("rgba(0, 0, 0, 0)");
    fireEvent.pointerLeave(picker);
    picker.setAttribute("aria-expanded", "true");
    style.textContent += "\n";
    const input = screen.getByRole("textbox", { name: "Example query" });
    fireEvent.pointerEnter(input);
    const hoveredBorder = getComputedStyle(input).borderColor;
    expect(hoveredBorder).toBe("rgb(70, 90, 180)");
    input.focus();
    fireEvent.pointerLeave(input);
    style.textContent += "\n";
    expect(getComputedStyle(input).borderColor).toBe(hoveredBorder);
    expect(getComputedStyle(input).boxShadow).toBe("none");
    expect(getComputedStyle(picker).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(picker).color).toBe("rgb(70, 90, 180)");
    input.blur();
    style.textContent += "\n";
    expect(getComputedStyle(input).borderColor).toBe("rgb(100, 100, 100)");
    picker.setAttribute("aria-expanded", "false");
    picker.focus();
    style.textContent += "\n";
    expect(picker).toHaveFocus();
    expect(getComputedStyle(picker).borderColor).toBe("rgba(0, 0, 0, 0)");
    picker.setAttribute("data-example-keyboard-focus", "true");
    style.textContent += "\n";
    expect(getComputedStyle(picker).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(picker).color).toBe("rgb(70, 90, 180)");
    document.documentElement.dataset.buttonStyle = "filled";
    picker.removeAttribute("data-example-keyboard-focus");
    picker.setAttribute("aria-expanded", "true");
    style.textContent += "\n";
    expect(getComputedStyle(picker).borderColor).toBe(hoveredBorder);
    expect(getComputedStyle(picker).color).toBe("rgb(70, 90, 180)");
    picker.setAttribute("aria-expanded", "false");
    style.textContent += "\n";
    expect(picker).toHaveFocus();
    expect(getComputedStyle(picker).borderColor).toBe("rgb(100, 100, 100)");
    picker.setAttribute("data-example-keyboard-focus", "true");
    style.textContent += "\n";
    expect(getComputedStyle(picker).borderColor).toBe(hoveredBorder);
    document.documentElement.dataset.buttonStyle = "quiet";
    picker.setAttribute("aria-expanded", "true");
    style.textContent += "\n";
    expect(getComputedStyle(picker).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(picker).paddingLeft).toBe("0px");
    expect(getComputedStyle(input).paddingLeft).toBe("0px");
    expect(getComputedStyle(input).paddingRight).toBe("12px");
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});
