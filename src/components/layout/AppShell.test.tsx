import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell product navigation", () => {
  it("renders the available destinations with icons and no removed sections", () => {
    const onThemeChange = vi.fn();
    render(
      <AppShell themePreference="system" onThemeChange={onThemeChange} version="0.1.9" activeSection="developer-pull-requests" unreadPullRequestCount={3} unreadAuthoredPullRequestCount={5}>
        <div>Content</div>
      </AppShell>,
    );

    expect(document.querySelector(".app-brand img")).toHaveAttribute("src", "/mework-icon.png");
    expect(document.querySelectorAll("nav a svg")).toHaveLength(13);
    expect(screen.getByText("Product")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" })).toHaveAttribute("href", "#product/create-task");
    expect(screen.getByRole("link", { name: "Task tracker" })).toHaveAttribute("href", "#product/task-tracker");
    expect(screen.getByRole("link", { name: "Sprint tasks" })).toHaveAttribute("href", "#product/daily");
    expect(screen.getByRole("link", { name: "Knowledge search" })).toHaveAttribute("href", "#product/confluence-search");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveAttribute("href", "#developer/pull-requests");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "PRs to review, 3 unread" })).toHaveClass("bg-accent", "text-accent-foreground", "px-3");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" })).toHaveAttribute("href", "#developer/my-pull-requests");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" })).not.toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Your PRs, 5 unread" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Command board" })).toHaveAttribute("href", "#developer/command-board");
    expect(screen.getByRole("link", { name: "Command board" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create task" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Task tracker" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sprint tasks" }).querySelector("svg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "AI settings" })).toHaveAttribute("href", "#settings/ai");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "#settings/application-info");
    expect(screen.getByRole("link", { name: "Data integrations" })).toHaveAttribute("href", "#settings/integrations");
    expect(screen.getByRole("link", { name: "Team settings" })).toHaveAttribute("href", "#settings/projects");
    expect(screen.getByRole("link", { name: "Statistics" })).toHaveAttribute("href", "#settings/statistics");
    const settingsLinks = Array.from(document.querySelectorAll(".settings-nav-group[aria-labelledby='settings-nav-title'] .settings-nav-children a"));
    expect(settingsLinks.slice(-2).map((link) => link.textContent)).toEqual(["Statistics", "About"]);
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Inbox" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Planning" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open About mework and check for updates" })).toHaveTextContent("v0.1.9");
    const themePicker = screen.getByRole("combobox", { name: "Theme" });
    expect(themePicker).toHaveAttribute("data-state", "closed");
    expect(themePicker.querySelector("svg.lucide-monitor")).toBeInTheDocument();
    expect(themePicker.querySelector("svg.lucide-sun")).toBeInTheDocument();
    fireEvent.click(themePicker);
    fireEvent.click(screen.getByRole("option", { name: "Dark" }));
    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("opens About mework from the version and marks an available update", () => {
    const onOpenApplicationInfo = vi.fn();
    render(
      <AppShell
        onThemeChange={vi.fn()}
        version="0.1.9"
        updateAvailableVersion="0.2.0"
        onOpenApplicationInfo={onOpenApplicationInfo}
      >
        <div>Content</div>
      </AppShell>,
    );

    const versionButton = screen.getByRole("button", {
      name: "Update 0.2.0 available. Open About mework",
    });
    expect(versionButton).toHaveTextContent("v0.1.9");
    expect(versionButton.querySelector(".sidebar-update-dot")).toBeInTheDocument();
    fireEvent.click(versionButton);
    expect(onOpenApplicationInfo).toHaveBeenCalledOnce();
  });

  it("opens About mework from development builds", () => {
    const onOpenApplicationInfo = vi.fn();
    render(
      <AppShell version="dev" onOpenApplicationInfo={onOpenApplicationInfo}>
        <div>Content</div>
      </AppShell>,
    );

    const developmentVersion = screen.getByRole("button", { name: "Open About mework and check for updates" });
    expect(developmentVersion).toHaveTextContent("dev");
    fireEvent.click(developmentVersion);
    expect(onOpenApplicationInfo).toHaveBeenCalledOnce();
  });

});
