import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreateTaskPage } from "./CreateTaskPage";

describe("CreateTaskPage", () => {
  it("opens the empty AI description modal and submits the prompt", () => {
    render(<CreateTaskPage />);

    expect(screen.getByRole("heading", { name: "Create task" })).toBeInTheDocument();
    expect(screen.getByText("Product", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Describe your task")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Describe your task"), {
      target: { value: "Let admins filter events by actor and date." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create with AI" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Let admins filter events by actor and date.")).toBeInTheDocument();
  });
});
