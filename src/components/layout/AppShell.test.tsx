import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell product navigation", () => {
  it("renders the available destinations with icons and no removed sections", () => {
    render(
      <AppShell theme="light" onThemeChange={vi.fn()} activeSection="developer-pull-requests" unreadPullRequestCount={3} unreadAuthoredPullRequestCount={5}>
        <div>Content</div>
      </AppShell>,
    );

    expect(document.querySelector(".app-brand img")).toHaveAttribute("src", "/mework-icon.png");
    expect(document.querySelectorAll("nav a svg")).toHaveLength(8);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" })).toHaveAttribute("href", "#product/create-task");
    expect(screen.getByRole("link", { name: "Daily" })).toHaveAttribute("href", "#product/daily");
    expect(screen.getByRole("link", { name: "Pull Request Review, 3 unread" })).toHaveAttribute("href", "#developer/pull-requests");
    expect(screen.getByRole("link", { name: "Pull Request Review, 3 unread" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Pull Request Review, 3 unread" })).toHaveClass("bg-accent", "text-accent-foreground", "px-3");
    expect(screen.getByRole("link", { name: "My Pull Requests, 5 unread" })).toHaveAttribute("href", "#developer/my-pull-requests");
    expect(screen.getByRole("link", { name: "My Pull Requests, 5 unread" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "My Pull Requests, 5 unread" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Command Board" })).toHaveAttribute("href", "#developer/command-board");
    expect(screen.getByRole("link", { name: "Command Board" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Daily" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Planning" })).not.toBeInTheDocument();
  });
});
