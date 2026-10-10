import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { FieldValidationHint } from "./FieldValidationHint";

it("temporarily anchors a warning to its field and reopens it on hover", () => {
  vi.useFakeTimers();
  try {
    render(<FieldValidationHint warning="Choose an example model"><Button role="combobox" variant="outline" disabled aria-label="Example model">Choose</Button></FieldValidationHint>);
    const field = screen.getByRole("combobox", { name: "Example model" });
    expect(field).toHaveAttribute("aria-description", "Choose an example model");
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("status")).toHaveClass("text-warning");
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    fireEvent.pointerEnter(field);
    expect(screen.getByRole("status")).toHaveTextContent("Choose an example model");
    fireEvent.pointerDown(field);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
