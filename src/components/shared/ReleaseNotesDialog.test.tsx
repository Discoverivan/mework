import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

describe("ReleaseNotesDialog", () => {
  it("renders Markdown and navigates right to an older release", () => {
    const onNavigate = vi.fn();
    render(<ReleaseNotesDialog open onOpenChange={vi.fn()} mode="history"
      releases={[{ version: "0.2.2", markdown: "## Added\n\n- **Faster search.** Results appear as you type.", language: "en" }]}
      navigation={{ olderVersion: "0.2.1", loading: false, onNavigate }} />);

    expect(screen.getByText("Faster search.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Release notes" }).parentElement)
      .toContainElement(screen.getByRole("button", { name: "Older release" }));
    expect(screen.queryByRole("button", { name: "Got it" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Older release" }));
    expect(onNavigate).toHaveBeenCalledWith("0.2.1");
  });
});
