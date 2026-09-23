import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { Label } from "./label";

it("indents field labels while keeping inline control labels aligned", () => {
  render(<>
    <Label htmlFor="name">Name</Label>
    <input id="name" />
    <Label htmlFor="enabled" alignment="inline">Enabled</Label>
    <input id="enabled" type="checkbox" />
  </>);

  expect(screen.getByText("Name")).toHaveClass("pl-1");
  expect(screen.getByText("Enabled")).not.toHaveClass("pl-1");
  expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeInTheDocument();
});
