import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell product navigation", () => {
  it("renders the available destinations with icons and no removed sections", () => {
    render(
      <AppShell theme="light" onThemeChange={vi.fn()} version="0.1.9" activeSection="developer-pull-requests" unreadPullRequestCount={3} unreadAuthoredPullRequestCount={5}>
        <div>Content</div>
      </AppShell>,
    );

    expect(document.querySelector(".app-brand img")).toHaveAttribute("src", "/mework-icon.png");
    expect(document.querySelectorAll("nav a svg")).toHaveLength(8);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" })).toHaveAttribute("href", "#product/create-task");
    expect(screen.getByRole("link", { name: "Daily" })).toHaveAttribute("href", "#product/daily");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveAttribute("href", "#developer/pull-requests");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveClass("bg-accent", "text-accent-foreground", "px-3");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" })).toHaveAttribute("href", "#developer/my-pull-requests");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Command Board" })).toHaveAttribute("href", "#developer/command-board");
    expect(screen.getByRole("link", { name: "Command Board" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Daily" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Planning" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "mework v0.1.9, open General settings" })).toHaveAttribute("href", "#settings/general");
  });

  it("opens General settings from the sidebar version link", () => {
    const onNavigate = vi.fn();
    render(
      <AppShell theme="light" onThemeChange={vi.fn()} version="0.1.9" onNavigate={onNavigate}>
        <div>Content</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("link", { name: "mework v0.1.9, open General settings" }));
    expect(onNavigate).toHaveBeenCalledWith("settings-general");
  });

  it("uses an icon-only theme toggle with an accessible action label", () => {
    const onThemeChange = vi.fn();
    render(
      <AppShell theme="light" onThemeChange={onThemeChange} activeSection="developer-pull-requests">
        <div>Content</div>
      </AppShell>,
    );

    const themeToggle = screen.getByRole("button", { name: "Switch to dark theme" });
    expect(themeToggle).toHaveClass("theme-toggle");
    expect(themeToggle).not.toHaveTextContent("White");
    fireEvent.click(themeToggle);
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });
});
