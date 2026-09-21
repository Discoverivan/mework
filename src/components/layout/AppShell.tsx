import type { ReactNode } from "react";
import {
  CalendarDays,
  Command,
  GitPullRequest,
  Moon,
  PlugZap,
  Settings2,
  SquarePen,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type Theme = "light" | "dark";

export type AppSection =
  | "product-create-task"
  | "product-daily"
  | "developer-pull-requests"
  | "developer-my-pull-requests"
  | "developer-command-board"
  | "settings-general"
  | "settings-integrations"
  | "settings-projects";

type NavigationItem = {
  section: AppSection;
  label: string;
  href: string;
  icon: LucideIcon;
};

interface AppShellProps {
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  version?: string;
  onNavigate?: (section: AppSection) => void;
  activeSection?: AppSection;
  unreadPullRequestCount?: number;
  unreadAuthoredPullRequestCount?: number;
}

const productNavigation: NavigationItem[] = [
  { section: "product-create-task", label: "Create task", href: "#product/create-task", icon: SquarePen },
  { section: "product-daily", label: "Daily", href: "#product/daily", icon: CalendarDays },
];

const developerNavigation: NavigationItem[] = [
  { section: "developer-pull-requests", label: "Pull Request Review", href: "#developer/pull-requests", icon: GitPullRequest },
  { section: "developer-my-pull-requests", label: "My Pull Requests", href: "#developer/my-pull-requests", icon: GitPullRequest },
  { section: "developer-command-board", label: "Command Board", href: "#developer/command-board", icon: Command },
];

const settingsNavigation: NavigationItem[] = [
  { section: "settings-general", label: "General", href: "#settings/general", icon: Settings2 },
  { section: "settings-integrations", label: "Integrations", href: "#settings/integrations", icon: PlugZap },
  { section: "settings-projects", label: "Team settings", href: "#settings/projects", icon: UsersRound },
];

export function AppShell({
  children,
  theme,
  onThemeChange,
  version = "0.1.0",
  onNavigate,
  activeSection,
  unreadPullRequestCount = 0,
  unreadAuthoredPullRequestCount = 0,
}: AppShellProps) {
  function renderNavigationItem(item: NavigationItem) {
    const Icon = item.icon;
    const active = activeSection === item.section;
    const itemUnreadCount = item.section === "developer-pull-requests"
      ? unreadPullRequestCount
      : item.section === "developer-my-pull-requests"
        ? unreadAuthoredPullRequestCount
        : 0;
    const displayUnreadCount = itemUnreadCount > 99 ? "99+" : itemUnreadCount;
    const pullRequestLabel = itemUnreadCount > 0
      ? `${item.label}, ${itemUnreadCount} unread`
      : item.label;

    return (
      <Button
        key={item.label}
        asChild
        variant="ghost"
        className={cn("justify-start gap-2 px-3", active && "bg-accent text-accent-foreground")}
      >
        <a
          href={item.href}
          aria-label={pullRequestLabel}
          aria-current={active ? "page" : undefined}
          onClick={() => onNavigate?.(item.section)}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {itemUnreadCount > 0 ? (
            <span className="sidebar-unread-badge" aria-label={`${itemUnreadCount} unread pull requests`}>
              {displayUnreadCount}
            </span>
          ) : null}
        </a>
      </Button>
    );
  }

  return (
    <div className="app-shell">
      <aside aria-label="Primary navigation">
        <div className="app-brand">
          <img src="/mework-icon.png" alt="" aria-hidden="true" />
          <strong>mework</strong>
        </div>
        <nav>
          <div className="settings-nav-group" aria-labelledby="developer-nav-title">
            <span id="developer-nav-title" className="settings-nav-heading">Developer</span>
            <div className="settings-nav-children">
              {developerNavigation.map(renderNavigationItem)}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="product-nav-title">
            <span id="product-nav-title" className="settings-nav-heading">Product</span>
            <div className="settings-nav-children">
              {productNavigation.map(renderNavigationItem)}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="settings-nav-title">
            <span id="settings-nav-title" className="settings-nav-heading">Settings</span>
            <div className="settings-nav-children">
              {settingsNavigation.map(renderNavigationItem)}
            </div>
          </div>
        </nav>
        <div className="sidebar-footer">
          <Button
            asChild
            variant="ghost"
            className="sidebar-version"
          >
            <a
              href="#settings/general"
              aria-label={`mework v${version}, open General settings`}
              title="Open General settings"
              onClick={() => onNavigate?.("settings-general")}
            >
              mework v{version}
            </a>
          </Button>
          <div className="theme-picker">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="theme-toggle size-8"
              aria-label={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              title={theme === "light" ? "Switch to dark theme" : "Switch to light theme"}
              onClick={() => onThemeChange(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? (
                <Moon className="size-4" aria-hidden="true" />
              ) : (
                <Sun className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        </div>
      </aside>
      <main aria-label="mework" className="app-content">
        {children}
      </main>
    </div>
  );
}
