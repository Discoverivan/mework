import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReleaseNotesDialog } from "./ReleaseNotesDialog";

describe("ReleaseNotesDialog", () => {
  it("shows changes from skipped versions and closes when acknowledged", () => {
    const onOpenChange = vi.fn();
    const originalRectMethod = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: function (this: Range) {
        return [{ width: 250, right: 270 }, { width: 94, right: 114 }] as unknown as DOMRectList;
      },
    });
    try {
      render(<ReleaseNotesDialog open onOpenChange={onOpenChange} releases={[
        { version: "0.2.2", entries: [{ en: "Find saved items faster.", ru: "Быстрее находите сохранённое." }] },
        { version: "0.2.1", entries: [{ en: "Review changes together.", ru: "Просматривайте изменения вместе." }] },
      ]} />);

      expect(screen.getByText("Find saved items faster.")).toBeInTheDocument();
      expect(screen.getByText("Review changes together.")).toBeInTheDocument();
      const separators = document.querySelectorAll('[data-orientation="horizontal"]');
      expect(separators).toHaveLength(1);
      expect(separators[0]).toHaveStyle({ width: "114px" });
      fireEvent.click(screen.getByRole("button", { name: "Got it" }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      if (originalRectMethod) Object.defineProperty(Range.prototype, "getClientRects", originalRectMethod);
      else Reflect.deleteProperty(Range.prototype, "getClientRects");
    }
  });
});
