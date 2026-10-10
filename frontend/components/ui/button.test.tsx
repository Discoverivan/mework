/// <reference types="node" />

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { Sparkles, Trash2 } from "lucide-react";

import { Button } from "./button";
import { Input } from "./input";
import { Card, CardHeader } from "./card";
import { CreateButton } from "@/components/shared/CreateButton";
import { EmptyState } from "@/components/shared/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "./alert-dialog";

it("keeps Filled edit and review-action backgrounds while highlighting text and visible borders", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = css.slice(css.indexOf(".app-icon-button,"))
    .replace(/var\(--app-action-color\)/g, "rgb(70, 90, 180)")
    .replace(/var\(--input\)/g, "rgb(100, 100, 100)");
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  try {
    render(<>
      <Button variant="outline" actionTone="warning">Needs work</Button>
      <Button variant="outline" actionTone="success">Approve</Button>
      <Button actionTone="edit">Save</Button>
      <Button variant="outline" actionTone="neutral">Cancel</Button>
    </>);
    for (const appearance of ["filled", "filled_borderless"]) {
      document.documentElement.dataset.buttonStyle = appearance;
      for (const [name, tone, color] of [["Needs work", "warning", "warning"], ["Approve", "success", "success"], ["Save", "edit", "primary"], ["Cancel", "neutral", "primary"]]) {
        const button = screen.getByRole("button", { name });
        button.blur();
        style.textContent += "\n";
        const background = getComputedStyle(button).background;
        fireEvent.mouseOver(button);
        button.focus();
        // Refresh jsdom's computed-style cache after changing focus.
        style.textContent += "\n";
        expect(getComputedStyle(button).background).toBe(background);
        expect(getComputedStyle(button).color).toBe("rgb(70, 90, 180)");
        expect(getComputedStyle(button).borderColor).toBe(appearance === "filled" ? "rgb(70, 90, 180)" : "rgba(0, 0, 0, 0)");
        expect(button).toHaveAttribute("data-action-tone", tone);
        expect(getComputedStyle(button).getPropertyValue("--app-action-color")).toBe(`var(--${color})`);
        button.blur();
        fireEvent.mouseOut(button);
      }
    }
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});

it("applies the minimal action style to form and confirmation buttons", () => {
  // Use the application's unlayered appearance rules; Tailwind utilities are built by Vite.
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = ".app-shell { --muted-foreground: rgb(128, 128, 128); } .example-navigation { height: 36px; padding: 8px 12px; color: rgb(255, 255, 255); } .example-selector { background-color: rgb(240, 240, 240); border-color: rgb(100, 100, 100); }" + css.slice(css.indexOf(".app-icon-button,")).replace(/var\(--input\)/g, "rgb(100, 100, 100)");
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  document.documentElement.dataset.buttonStyle = "quiet";
  let applied = false;

  try {
    render(<>
      <Button actionTone="edit" onClick={() => { applied = true; }}>Apply</Button>
      <Button actionTone="edit">Save</Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="outline" actionTone="add">Add item</Button>
      <CreateButton />
      <Button variant="outline" actionTone="delete">Delete item</Button>
      <Button variant="outline" actionTone="delete"><Trash2 aria-hidden="true" />Remove</Button>
      <Button variant="default" aria-pressed="true">Selected filter</Button>
      <Button variant="outline" actionTone="neutral" aria-pressed="true">Rewrite example</Button>
      <Button variant="outline" role="combobox" className="example-selector">Select sprint</Button>
      <div className="app-dialog-content"><div className="app-dialog-sections">
        <ToggleGroup type="single" defaultValue="allow"><ToggleGroupItem value="allow">Allow</ToggleGroupItem><ToggleGroupItem value="deny">Deny</ToggleGroupItem></ToggleGroup>
      </div></div>
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

    for (const name of ["Apply", "Cancel", "Keep item", "Remove item", "Rewrite example"]) {
      const button = screen.getByText(name);
      expect(getComputedStyle(button).backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(button).borderColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(button).paddingLeft).toBe(button.closest(".app-dialog-actions") ? "12px" : "6px");
      expect(getComputedStyle(button).minHeight).toBe("32px");
    }
    expect(getComputedStyle(screen.getByText("Remove item")).getPropertyValue("--app-action-color")).toBe("var(--destructive)");
    expect(getComputedStyle(screen.getByText("Keep item").closest(".app-dialog-actions")!).gap).toBe("0.5rem");
    expect(getComputedStyle(screen.getByText("Keep item").closest(".app-dialog-actions")!).marginBlockStart).toBe("0px");
    expect(getComputedStyle(screen.getByText("Keep item").closest(".app-dialog-actions")!).marginInline).toBe("0.25rem");
    const allow = screen.getByText("Allow");
    expect(getComputedStyle(allow).minHeight).toBe("32px");
    expect(getComputedStyle(allow).paddingTop).toBe("4px");
    expect(getComputedStyle(allow.closest(".app-dialog-sections")!).gap).toBe("1rem");
    expect(getComputedStyle(allow.closest(".app-dialog-content")!).gap).toBe("1rem");
    fireEvent.click(screen.getByText("Deny"));
    expect(screen.getByText("Deny")).toHaveAttribute("data-state", "on");
    const selector = screen.getByText("Select sprint");
    const navigation = screen.getByText("Example section");
    expect(getComputedStyle(navigation).height).toBe("36px");
    expect(getComputedStyle(navigation).paddingLeft).toBe("12px");
    expect(getComputedStyle(navigation).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(selector).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(selector).borderColor).toBe("rgba(0, 0, 0, 0)");
    fireEvent.pointerEnter(selector);
    style.textContent += "\n";
    expect(getComputedStyle(selector).color).toBe("var(--primary)");
    fireEvent.click(screen.getByRole("button", { name: "Keep item" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(applied).toBe(true);
    screen.getByRole("button", { name: "Apply" }).blur();
    fireEvent.mouseOut(screen.getByRole("button", { name: "Apply" }));
    style.textContent += "\n";
    fireEvent.pointerLeave(selector);
    document.documentElement.dataset.buttonStyle = "filled";
    expect(getComputedStyle(allow.closest(".app-dialog-sections")!).gap).toBe("1rem");
    expect(getComputedStyle(allow.closest(".app-dialog-content")!).gap).toBe("1rem");
    expect(getComputedStyle(selector).backgroundColor).toBe("rgb(240, 240, 240)");
    expect(getComputedStyle(selector).borderColor).toBe("rgb(100, 100, 100)");
    expect(getComputedStyle(screen.getByRole("button", { name: "Create" }).querySelector("svg")!).marginLeft).toBe("-3px");
    expect(getComputedStyle(screen.getByRole("button", { name: "Remove" }).querySelector("svg")!).marginLeft).toBe("-3px");
    expect(getComputedStyle(navigation).height).toBe("36px");
    expect(getComputedStyle(navigation).paddingLeft).toBe("12px");
    expect(getComputedStyle(navigation).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(screen.getByRole("button", { name: "Apply" })).borderWidth).toBe("1px");
    for (const name of ["Apply", "Save", "Cancel", "Add item", "Delete item", "Create", "Remove"]) {
      const appearance = getComputedStyle(screen.getByRole("button", { name }));
      expect(appearance.borderColor, name).toBe("rgb(100, 100, 100)");
    }
    const apply = screen.getByRole("button", { name: "Apply" });
    const save = screen.getByRole("button", { name: "Save" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(getComputedStyle(save).background).toBe("var(--app-action-background, var(--secondary))");
    expect(getComputedStyle(save).backgroundColor).toBe(getComputedStyle(cancel).backgroundColor);
    expect(getComputedStyle(screen.getByRole("button", { name: "Rewrite example" })).background).toBe(getComputedStyle(save).background);
    expect(getComputedStyle(save).color).toBe(getComputedStyle(cancel).color);
    expect(getComputedStyle(screen.getByRole("button", { name: "Add item" })).getPropertyValue("--app-action-color")).toBe("var(--success)");
    expect(getComputedStyle(screen.getByRole("button", { name: "Delete item" })).getPropertyValue("--app-action-color")).toBe("var(--destructive)");
    expect(screen.getByRole("button", { name: "Selected filter" })).not.toHaveClass("app-action-text");
    fireEvent.mouseOver(apply);
    apply.focus();
    style.textContent += "\n";
    expect(getComputedStyle(apply).color).toBe("var(--app-action-color)");
    expect(getComputedStyle(apply).background).toBe(getComputedStyle(save).background);
    expect(apply).toHaveAttribute("data-action-tone", "edit");
    cancel.focus();
    style.textContent += "\n";
    expect(getComputedStyle(cancel).color).not.toBe("var(--primary-foreground)");
    expect(cancel).not.toHaveAttribute("data-action-tone");
    expect(getComputedStyle(cancel).backgroundColor).toBe(getComputedStyle(save).backgroundColor);
    apply.focus();
    apply.setAttribute("data-action-tone", "add");
    style.textContent += "\n";
    expect(getComputedStyle(apply).color).toBe("var(--app-action-color)");
    expect(getComputedStyle(apply).background).toBe("var(--app-action-background, var(--secondary))");
  } finally {
    style.remove();
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
  }
});

it("keeps Filled section-header actions distinct and filter actions compact", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../../index.css"), "utf8");
  const style = document.createElement("style");
  // jsdom does not resolve CSS variables in border-color; keep the real cascade with a synthetic token.
  style.textContent = ".example-number-control { border: 1px solid rgb(100, 100, 100); }" + (css.slice(css.indexOf(":root,"), css.indexOf("@layer base")) + css.slice(css.indexOf(".app-icon-button,"))).replace(/var\(--input\)/g, "rgb(100, 100, 100)").replace(/var\(--border\)/g, "rgb(100, 100, 100)").replace(/var\(--app-action-color\)/g, "rgb(70, 90, 180)");
  document.head.append(style);
  const previousStyle = document.documentElement.dataset.buttonStyle;
  const previousTheme = document.documentElement.dataset.theme;
  const previousPanelStyle = document.documentElement.dataset.panelStyle;
  document.documentElement.dataset.buttonStyle = "filled";
  document.documentElement.dataset.panelStyle = "bordered";
  document.documentElement.dataset.theme = "light";
  try {
    render(<><Card className="pr-filter-group"><CardHeader variant="section" style={{ background: "var(--muted)" }}>
      <CreateButton label="Add" aria-label="Add filter" />
      <Button variant="outline" size="icon" actionTone="delete" aria-label="Expand section"><Trash2 aria-hidden="true" /></Button>
      <Button variant="outline">Cancel</Button>
      <Button variant="outline" size="icon" actionTone="success" aria-label="Example review results"><Sparkles aria-hidden="true" /></Button>
    </CardHeader><Button size="icon" variant="ghost" actionTone="edit" className="app-instruction-edit" aria-label="Edit example instructions"><Trash2 aria-hidden="true" /></Button><Button size="sm" variant="ghost" actionTone="delete" aria-label="Remove filter"><Trash2 aria-hidden="true" />Remove</Button></Card>
      <Card role="status">No matching example items.</Card>
      <Card data-pr-status-marker="neutral" className="border-l-4 border-l-transparent" aria-label="Viewed example PR">Viewed example PR</Card>
      <EmptyState titleId="example-empty-title" title="No example items" description="Add an example item." icon={<Trash2 />} />
      <Input className="example-number-control" inputMode="numeric" aria-label="Example number" defaultValue="3" />
    </>);
    const addFilter = screen.getByRole("button", { name: "Add filter" });
    const editInstructions = screen.getByRole("button", { name: "Edit example instructions" });
    expect(getComputedStyle(editInstructions).height).toBe("24px");
    expect(getComputedStyle(editInstructions).width).toBe("24px");
    const panel = addFilter.closest('[data-slot="card"]')!;
    expect(getComputedStyle(panel).borderWidth).toBe("1px");
    expect(getComputedStyle(panel).borderColor).toBe("rgb(100, 100, 100)");
    const viewedCard = screen.getByLabelText("Viewed example PR");
    expect(getComputedStyle(viewedCard).borderLeftWidth).toBe("1px");
    expect(getComputedStyle(viewedCard).borderLeftColor).toBe("rgb(100, 100, 100)");
    expect(getComputedStyle(viewedCard).paddingLeft).toBe("3px");
    const numberControl = screen.getByRole("textbox", { name: "Example number" });
    expect(getComputedStyle(numberControl).borderColor).toBe("rgb(100, 100, 100)");
    for (const message of screen.getAllByRole("status")) {
      expect(getComputedStyle(message).borderWidth).toBe("1px");
      expect(getComputedStyle(message).borderColor).toBe("rgb(100, 100, 100)");
    }
    // jsdom retains custom properties in the background shorthand.
    expect(getComputedStyle(addFilter).background).toBe("var(--app-action-background, var(--secondary))");
    expect(getComputedStyle(addFilter.parentElement!).getPropertyValue("--app-action-background")).toBe("var(--card)");
    const cancel = screen.getByRole("button", { name: "Cancel" });
    fireEvent.mouseOver(cancel);
    cancel.focus();
    // jsdom caches computed styles across focus changes until CSS is refreshed.
    style.textContent += "\n";
    expect(getComputedStyle(cancel).background).toBe("var(--app-action-background, var(--secondary))");
    expect(getComputedStyle(cancel).borderColor).toBe("rgb(70, 90, 180)");
    cancel.blur();
    const iconAction = screen.getByRole("button", { name: "Expand section" });
    fireEvent.mouseOver(iconAction);
    iconAction.focus();
    style.textContent += "\n";
    expect(getComputedStyle(iconAction).background).toBe("var(--app-action-background, var(--secondary))");
    expect(getComputedStyle(iconAction).borderColor).toBe("rgb(70, 90, 180)");
    iconAction.blur();
    fireEvent.mouseOut(iconAction);
    style.textContent += "\n";
    for (const button of [addFilter, screen.getByRole("button", { name: "Expand section" })]) {
      expect(getComputedStyle(button).borderWidth).toBe("1px");
      expect(getComputedStyle(button).borderStyle).toBe("solid");
      expect(getComputedStyle(button).borderColor).toBe("rgb(100, 100, 100)");
    }
    document.documentElement.dataset.buttonStyle = "filled_borderless";
    style.textContent += "\n";
    expect(getComputedStyle(numberControl).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(numberControl).borderWidth).toBe("1px");
    expect(getComputedStyle(panel).borderWidth).toBe("1px");
    document.documentElement.dataset.panelStyle = "borderless";
    style.textContent += "\n";
    expect(getComputedStyle(panel).borderWidth).not.toBe("1px");
    for (const message of screen.getAllByRole("status")) {
      expect(getComputedStyle(message).borderWidth).not.toBe("1px");
    }
    for (const button of [addFilter, iconAction, cancel]) {
      expect(getComputedStyle(button).borderColor).toBe("rgba(0, 0, 0, 0)");
      expect(getComputedStyle(button).background).toBe("var(--app-action-background, var(--secondary))");
    }
    expect(getComputedStyle(addFilter).background).not.toBe(getComputedStyle(addFilter.parentElement!).background);
    for (const button of [addFilter, screen.getByRole("button", { name: "Remove filter" })]) {
      expect(getComputedStyle(button).height).toBe("24px");
      expect(getComputedStyle(button).paddingRight).toBe("8px");
      expect(getComputedStyle(button).fontSize).toBe("13px");
      expect(getComputedStyle(button.querySelector("svg")!).width).toBe("14px");
    }
    document.documentElement.dataset.buttonStyle = "quiet";
    const reviewResults = screen.getByRole("button", { name: "Example review results" });
    style.textContent += "\n";
    expect(getComputedStyle(numberControl).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(numberControl).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(reviewResults).color).toBe(getComputedStyle(iconAction).color);
    expect(getComputedStyle(reviewResults).getPropertyValue("--app-action-color")).toBe("var(--success)");
    fireEvent.mouseOver(reviewResults);
    reviewResults.focus();
    style.textContent += "\n";
    expect(getComputedStyle(reviewResults).color).toBe("rgb(70, 90, 180)");
    expect(getComputedStyle(addFilter).height).toBe("28px");
    expect(getComputedStyle(editInstructions).height).toBe("28px");
    expect(getComputedStyle(editInstructions).width).toBe("28px");
    editInstructions.setAttribute("aria-invalid", "true");
    style.textContent = style.textContent.replace(/var\(--destructive\)/g, "rgb(180, 40, 40)");
    expect(getComputedStyle(editInstructions).borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(editInstructions).color).toBe("rgb(180, 40, 40)");
    expect(getComputedStyle(editInstructions).borderWidth).toBe("1px");
    expect(getComputedStyle(addFilter).minHeight).toBe("28px");
    expect(getComputedStyle(addFilter).paddingRight).toBe("6px");
    expect(getComputedStyle(addFilter).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  } finally {
    style.remove();
    if (previousPanelStyle === undefined) delete document.documentElement.dataset.panelStyle;
    else document.documentElement.dataset.panelStyle = previousPanelStyle;
    if (previousStyle === undefined) delete document.documentElement.dataset.buttonStyle;
    else document.documentElement.dataset.buttonStyle = previousStyle;
    if (previousTheme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = previousTheme;
  }
});
