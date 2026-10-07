import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { useState } from "react";

import { Button } from "./button";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

function ExamplePicker() {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button title="Example picker hint">Open example picker</Button></PopoverTrigger>
    <PopoverContent aria-label="Example picker">
      <Button onClick={() => setOpen(false)}>Select example item</Button>
    </PopoverContent>
  </Popover>;
}

it("dismisses a picker hint on activation and keeps it closed when selection restores focus", async () => {
  render(<ExamplePicker />);
  const trigger = screen.getByRole("button", { name: "Open example picker" });
  act(() => trigger.focus());
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Example picker hint");

  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "Example picker" })).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Select example item" }));
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

  fireEvent.keyDown(trigger, { key: "Tab" });
  act(() => { trigger.blur(); trigger.focus(); });
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Example picker hint");
});
