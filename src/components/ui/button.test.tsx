/// <reference types="node" />

import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Button } from "./button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./alert-dialog";

it("applies the minimal action style to form and confirmation buttons", () => {
  // Use the application's unlayered appearance rules; Tailwind utilities are built by Vite.
  const css = readFileSync("src/index.css", "utf8");
  const style = document.createElement("style");
  style.textContent = ".app-shell { --muted-foreground: rgb(128, 128, 128); } .example-navigation { height: 36px; padding: 8px 12px; color: rgb(255, 255, 255); } .example-selector { background-color: rgb(240, 240, 240); border-color: rgb(100, 100, 100); }" + css.slice(css.indexOf(".app-icon-button,"));
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "quiet";
  let applied = false;

  try {
    render(<>
      <Button onClick={() => { applied = true; }}>Apply</Button>
      <Button>Save</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="outline" actionTone="add">Add item</Button>
      <Button variant="outline" actionTone="delete">Delete item</Button>
      <Button variant="default" aria-pressed="true">Selected filter</Button>
      <Button variant="outline" role="combobox" className="example-selector">Select sprint</Button>
      <div className="app-shell"><aside><nav className="sidebar-navigation"><Button asChild variant="ghost" className="example-navigation"><a href="#example">Example section</a></Button></nav></aside></div>
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Confirm action</AlertDialogTitle>
          <AlertDialogDescription>Remove the example item.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep item</AlertDialogCancel>
            <AlertDialogAction variant="destructive">Remove item</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>);

    for (const name of ["Apply", "Cancel", "Keep item", "Remove item"]) {
      const button = screen.getByText(name);
      expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(button).borderColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(button).paddingLeft).toBe(button.closest(".app-dialog-actions") ? "12px" : "6px");
      expect(getComputedStyle(button).minHeight).toBe("32px");
    }
    expect(getComputedStyle(screen.getByText("Remove item")).getPropertyValue("--app-action-color")).toBe("var(--destructive)");
    expect(getComputedStyle(screen.getByText("Keep item").closest(".app-dialog-actions")!).gap).toBe("0.5rem");
    const selector = screen.getByText("Select sprint");
    const navigation = screen.getByText("Example section");
    expect(getComputedStyle(navigation).height).toBe("36px");
    expect(getComputedStyle(navigation).paddingLeft).toBe("12px");
    expect(getComputedStyle(navigation).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(selector).backgroundColor).toBe("rgb(240, 240, 240)");
    expect(getComputedStyle(selector).borderColor).toBe("rgb(100, 100, 100)");
    fireEvent.click(screen.getByRole("button", { name: "Keep item" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(applied).toBe(true);
    document.documentElement.dataset.buttonStyle = "filled";
    expect(getComputedStyle(navigation).height).toBe("36px");
    expect(getComputedStyle(navigation).paddingLeft).toBe("12px");
    expect(getComputedStyle(navigation).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(screen.getByRole("button", { name: "Apply" })).borderWidth).toBe("1px");
    const apply = screen.getByRole("button", { name: "Apply" });
    const save = screen.getByRole("button", { name: "Save" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(getComputedStyle(save).backgroundColor).toBe(getComputedStyle(cancel).backgroundColor);
    expect(getComputedStyle(save).color).toBe(getComputedStyle(cancel).color);
    expect(getComputedStyle(screen.getByRole("button", { name: "Add item" })).getPropertyValue("--app-action-color")).toBe("var(--success)");
    expect(getComputedStyle(screen.getByRole("button", { name: "Delete item" })).getPropertyValue("--app-action-color")).toBe("var(--destructive)");
    expect(screen.getByRole("button", { name: "Selected filter" })).not.toHaveClass("app-action-text");
    apply.focus();
    expect(getComputedStyle(apply).color).toBe("var(--primary-foreground)");
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});
