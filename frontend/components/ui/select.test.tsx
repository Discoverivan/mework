import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Label } from "./label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select";
import { Input } from "./input";
import { Button } from "./button";
import { Textarea } from "./textarea";

it("distinguishes automatic focus, pointer movement and keyboard selection", async () => {
  Element.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  render(<Select defaultValue="first" onValueChange={changed}>
    <SelectTrigger aria-label="Example choice"><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="first">First example</SelectItem>
      <SelectItem value="second">Second example</SelectItem>
    </SelectContent>
  </Select>);
  fireEvent.click(screen.getByRole("combobox", { name: "Example choice" }));
  const first = screen.getByRole("option", { name: "First example" });
  await waitFor(() => expect(first).toHaveFocus());
  expect(first).toHaveAttribute("data-keyboard-navigation", "false");
  expect(first).not.toHaveAttribute("data-pointer-hover");
  fireEvent.pointerMove(first);
  expect(first).toHaveAttribute("data-pointer-hover", "true");
  fireEvent.keyDown(first, { key: "ArrowDown" });
  const second = screen.getByRole("option", { name: "Second example" });
  await waitFor(() => expect(second).toHaveFocus());
  expect(second).toHaveAttribute("data-keyboard-navigation", "true");
  fireEvent.keyDown(second, { key: "Enter" });
  expect(changed).toHaveBeenCalledWith("second");
});

it("keeps the final option selectable in a long menu", () => {
  Element.prototype.scrollIntoView = vi.fn();
  const changed = vi.fn();
  render(<Select onValueChange={changed}>
    <SelectTrigger aria-label="Example model"><SelectValue placeholder="Choose example model" /></SelectTrigger>
    <SelectContent>{Array.from({ length: 50 }, (_, index) =>
      <SelectItem key={index} value={`example-${index}`}>Example option {index + 1}</SelectItem>,
    )}</SelectContent>
  </Select>);
  fireEvent.click(screen.getByRole("combobox", { name: "Example model" }));
  fireEvent.click(screen.getByRole("option", { name: "Example option 50" }));
  expect(changed).toHaveBeenCalledWith("example-49");
  expect(screen.getByRole("combobox", { name: "Example model" })).toHaveTextContent("Example option 50");
});

it("marks hover only over the fields themselves while keeping their labels", () => {
  const entered = vi.fn();
  render(<>
    <Label htmlFor="example-repository">Repository</Label>
    <Select><SelectTrigger id="example-repository" onPointerEnter={entered}><SelectValue placeholder="Choose" /></SelectTrigger></Select>
    <Label htmlFor="example-name">Name</Label>
    <Input id="example-name" />
    <Label htmlFor="example-description">Description</Label>
    <Textarea id="example-description" />
    <Label htmlFor="example-picker">Assignee</Label>
    <Button id="example-picker" role="combobox" variant="outline">Choose</Button>
  </>);
  for (const label of ["Repository", "Name", "Description", "Assignee"]) {
    const field = screen.getByLabelText(label);
    fireEvent.pointerEnter(screen.getByText(label));
    expect(field).not.toHaveAttribute("data-pointer-hover");
    fireEvent.pointerLeave(screen.getByText(label));
    fireEvent.pointerEnter(field);
    expect(field).toHaveAttribute("data-pointer-hover", "true");
    fireEvent.pointerLeave(field);
    expect(field).not.toHaveAttribute("data-pointer-hover");
  }
  expect(entered).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Name")).toHaveAttribute("autocomplete", "off");
  expect(screen.getByLabelText("Description")).toHaveAttribute("autocomplete", "off");
});
