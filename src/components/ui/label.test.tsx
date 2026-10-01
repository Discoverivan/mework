import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Label } from "./label";

it("aligns field and inline labels with their descriptions and controls", () => {
  render(<>
    <Label htmlFor="name">Name</Label>
    <input id="name" />
    <Label htmlFor="enabled" alignment="inline">Enabled</Label>
    <input id="enabled" type="checkbox" />
  </>);

  expect(screen.getByText("Name")).not.toHaveClass("pl-1");
  expect(screen.getByText("Enabled")).not.toHaveClass("pl-1");
  expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeInTheDocument();
});
