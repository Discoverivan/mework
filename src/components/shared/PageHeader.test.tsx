import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders a compact title without an eyebrow section label", () => {
    const { container } = render(
      <PageHeader
        title="Pull Request Review"
        titleId="page-title"
        description="Review open pull requests."
        meta={<span>Last updated: just now</span>}
        actions={<button type="button">Update now</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pull Request Review" })).toHaveAttribute("id", "page-title");
    expect(screen.getByText("Review open pull requests.")).toBeInTheDocument();
    expect(screen.getByText("Last updated: just now")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update now" })).toBeInTheDocument();
    expect(container.querySelector(".eyebrow")).not.toBeInTheDocument();
    expect(container.querySelector(".page-header")).toHaveClass("page-header");
  });
});
