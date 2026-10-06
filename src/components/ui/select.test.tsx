import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { Label } from "./label";
import { Select, SelectTrigger, SelectValue } from "./select";
import { Input } from "./input";
import { Button } from "./button";
import { Textarea } from "./textarea";

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
  for (const label of ["Repository", "Name", "Assignee"]) {
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
