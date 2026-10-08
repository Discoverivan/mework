import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { MarkdownContent } from "./MarkdownContent";

it("renders structured Markdown with isolated footnotes and inert HTML", () => {
  const onOpenLink = vi.fn();
  const source = [
    "# Example heading",
    "",
    "3. Parent item",
    "   - Nested item",
    "4. Next item",
    "",
    "> First quoted paragraph",
    ">",
    "> Second quoted paragraph",
    "",
    "---",
    "",
    "Compare List<String>.",
    "",
    '<script>alert("example")</script>',
    "",
    "```text",
    "first line",
    "  second line",
    "```",
    "",
    "| Left | Center |",
    "| :--- | :---: |",
    "| Value | ~~Old~~ |",
    "",
    "- [x] Completed item",
    "",
    "[Docs](https://example.invalid/docs) and [Email](mailto:reviewer@example.invalid).",
    "",
    "![Example diagram](https://example.invalid/diagram.png)",
    "",
    "First reference[^note]",
    "",
    "[^note]: Example footnote",
  ].join("\n");
  const { container } = render(<>
    <MarkdownContent onOpenLink={onOpenLink}>{source}</MarkdownContent>
    <MarkdownContent>{"Second reference[^note]\n\n[^note]: Another footnote"}</MarkdownContent>
  </>);

  expect(screen.getByRole("heading", { name: "Example heading", level: 1 })).toBeInTheDocument();
  expect(screen.getByText("Parent item").closest("ol")).toHaveAttribute("start", "3");
  expect(screen.getByText("Nested item").closest("ul")?.parentElement?.tagName).toBe("LI");
  expect(screen.getByText("Second quoted paragraph").closest("blockquote")).toBeInTheDocument();
  expect(screen.getByRole("separator")).toBeInTheDocument();
  expect(screen.getByText("Compare List<String>.")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getByText('<script>alert("example")</script>')).toBeInTheDocument();
  expect(container.querySelector("pre code")?.textContent).toBe("first line\n  second line\n");
  expect(screen.getByRole("columnheader", { name: "Center" })).toHaveStyle({ textAlign: "center" });
  expect(screen.getByText("Old").tagName).toBe("DEL");
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(screen.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:reviewer@example.invalid");
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByRole("link", { name: "Example diagram" })).toHaveAttribute("href", "https://example.invalid/diagram.png");
  fireEvent.click(screen.getByRole("link", { name: "Docs" }));
  expect(onOpenLink).toHaveBeenCalledWith("https://example.invalid/docs");

  const ids = Array.from(container.querySelectorAll("[id]"), (element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const reference of container.querySelectorAll("a[data-footnote-ref], a[data-footnote-backref]")) {
    expect(ids).toContain(reference.getAttribute("href")?.slice(1));
    if (reference.hasAttribute("aria-describedby")) expect(ids).toContain(reference.getAttribute("aria-describedby"));
  }
});
