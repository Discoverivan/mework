import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

describe("ReleaseNotesDialog", () => {
  it("shows changes from skipped versions and closes when acknowledged", () => {
    const onOpenChange = vi.fn();
    render(<ReleaseNotesDialog open onOpenChange={onOpenChange} releases={[
      { version: "0.2.2", entries: [{ en: "Find saved items faster.", ru: "Быстрее находите сохранённое." }] },
      { version: "0.2.1", entries: [{ en: "Review changes together.", ru: "Просматривайте изменения вместе." }] },
    ]} />);

    expect(screen.getByText("Find saved items faster.")).toBeInTheDocument();
    expect(screen.getByText("Review changes together.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
