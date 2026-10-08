import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { MarkdownContent } from "@/components/shared/MarkdownContent";
import { normalizeReviewMarkdown } from "./review-markdown";

it("repairs examples within list items while preserving existing code", () => {
  const source = [
    "Use ```some code ```",
    "",
    "```ts",
    "existing()",
    "```",
    "",
    "    Literal: ```text",
    "    keep()",
    "    ```",
    "",
    "- Suggested `retry` correction: ```ts",
    "  retry()",
    "  ```",
    "- Next item",
    "",
    "> ````markdown",
    "> Literal: ```ts",
    "> keep()",
    "> ```",
    "> ````",
    "",
    "Another correction: ```ts",
    "finish()",
    "```",
  ].join("\n");
  const { container } = render(<MarkdownContent>{normalizeReviewMarkdown(source)}</MarkdownContent>);

  const blocks = container.querySelectorAll("pre code");
  expect(blocks).toHaveLength(5);
  expect(screen.getByText("some code").tagName).toBe("CODE");
  expect(blocks[0].textContent).toBe("existing()\n");
  expect(blocks[1].textContent).toBe("Literal: ```text\nkeep()\n```\n");
  expect(screen.getByText("retry()").closest("li")).toContainElement(screen.getByText("retry"));
  expect(blocks[3].textContent).toBe("Literal: ```ts\nkeep()\n```\n");
  expect(screen.getByText("finish()").parentElement?.tagName).toBe("PRE");
});
