import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";


describe("AppShell product navigation", () => {
  it("renders Product with Create task, Planning, and Daily destinations", () => {
    render(
      <AppShell theme="light" onThemeChange={vi.fn()}>
        <div>Content</div>
      </AppShell>,
    );

    const product = screen.getByText("Product");
    expect(product.tagName).toBe("SPAN");
    expect(product.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "Create task" })).toHaveAttribute("href", "#product/create-task");
    expect(screen.getByRole("link", { name: "Planning" })).toHaveAttribute("href", "#product/planning");
    expect(screen.getByRole("link", { name: "Daily" })).toHaveAttribute("href", "#product/daily");
    expect(screen.queryByRole("link", { name: "My actions" })).not.toBeInTheDocument();
  });
});
