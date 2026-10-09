import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";

it("keeps pointer and keyboard menu interaction separate while allowing selection", async () => {
  const selected = vi.fn();
  render(<DropdownMenu>
    <DropdownMenuTrigger>Example actions</DropdownMenuTrigger>
    <DropdownMenuContent>
      <DropdownMenuItem>First example</DropdownMenuItem>
      <DropdownMenuItem onSelect={selected}>Second example</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Example actions" }), { button: 0, ctrlKey: false });
  const first = screen.getByRole("menuitem", { name: "First example" });
  expect(first).toHaveAttribute("data-keyboard-navigation", "false");
  expect(first).not.toHaveAttribute("data-pointer-hover");
  fireEvent.pointerMove(first);
  expect(first).toHaveAttribute("data-pointer-hover", "true");
  first.focus();
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const second = screen.getByRole("menuitem", { name: "Second example" });
  await waitFor(() => expect(second).toHaveFocus());
  expect(second).toHaveAttribute("data-keyboard-navigation", "true");
  fireEvent.keyDown(second, { key: "Enter" });
  expect(selected).toHaveBeenCalledOnce();
});
