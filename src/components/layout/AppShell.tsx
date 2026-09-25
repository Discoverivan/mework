import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BarChart3,
  CalendarDays,
  Command,
  DatabaseZap,
  GitPullRequest,
  Monitor,
  Settings2,
  Moon,
  Search,
  SquarePen,
  Sparkles,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/context";
import type { ThemePreference } from "@/features/settings/general/api";

export type AppSection =
  | "product-create-task"
  | "product-task-tracker"
  | "product-daily"
  | "product-confluence-search"
  | "developer-pull-requests"
  | "developer-my-pull-requests"
  | "developer-command-board"
  | "settings-general"
  | "settings-ai"
  | "settings-integrations"
  | "settings-projects"
  | "settings-statistics";

type NavigationItem = {
  section: AppSection;
  labelKey: "nav.createTask" | "nav.taskTracker" | "nav.sprintTasks" | "nav.confluenceSearch" | "nav.prsToReview" | "nav.yourPrs" | "nav.commandBoard" | "nav.general" | "nav.aiSettings" | "nav.dataIntegrations" | "nav.teamSettings" | "nav.statistics";
  href: string;
  icon: LucideIcon;
};

interface AppShellProps {
  children: ReactNode;
  themePreference?: ThemePreference;
  onThemeChange?: (theme: ThemePreference) => void;
  themeChanging?: boolean;
  version?: string;
  updateAvailableVersion?: string | null;
  onOpenUpdateSettings?: () => void;
  onNavigate?: (section: AppSection) => void;
  activeSection?: AppSection;
  unreadPullRequestCount?: number;
  unreadAuthoredPullRequestCount?: number;
  unreadTaskTrackerCount?: number;
}

const productNavigation: NavigationItem[] = [
  { section: "product-create-task", labelKey: "nav.createTask", href: "#product/create-task", icon: SquarePen },
  { section: "product-task-tracker", labelKey: "nav.taskTracker", href: "#product/task-tracker", icon: Monitor },
  { section: "product-daily", labelKey: "nav.sprintTasks", href: "#product/daily", icon: CalendarDays },
  { section: "product-confluence-search", labelKey: "nav.confluenceSearch", href: "#product/confluence-search", icon: Search },
];

const developerNavigation: NavigationItem[] = [
  { section: "developer-pull-requests", labelKey: "nav.prsToReview", href: "#developer/pull-requests", icon: GitPullRequest },
  { section: "developer-my-pull-requests", labelKey: "nav.yourPrs", href: "#developer/my-pull-requests", icon: GitPullRequest },
  { section: "developer-command-board", labelKey: "nav.commandBoard", href: "#developer/command-board", icon: Command },
];

const settingsNavigation: NavigationItem[] = [
  { section: "settings-general", labelKey: "nav.general", href: "#settings/general", icon: Settings2 },
  { section: "settings-ai", labelKey: "nav.aiSettings", href: "#settings/ai", icon: Sparkles },
  { section: "settings-integrations", labelKey: "nav.dataIntegrations", href: "#settings/integrations", icon: DatabaseZap },
  { section: "settings-projects", labelKey: "nav.teamSettings", href: "#settings/projects", icon: UsersRound },
  { section: "settings-statistics", labelKey: "nav.statistics", href: "#settings/statistics", icon: BarChart3 },
];

const GITHUB_RELEASES_URL = "https://github.com/Discoverivan/mework/releases";

export function AppShell({
  children,
  themePreference,
  onThemeChange,
  themeChanging = false,
  version,
  updateAvailableVersion,
  onOpenUpdateSettings,
  onNavigate,
  activeSection,
  unreadPullRequestCount = 0,
  unreadAuthoredPullRequestCount = 0,
  unreadTaskTrackerCount = 0,
}: AppShellProps) {
  const { resolvedTheme, themePreference: contextThemePreference, t } = useI18n();
  const selectedTheme = themePreference ?? contextThemePreference;
  const versionLabel = version === "dev" ? t("nav.developmentBuild") : version ? `v${version}` : undefined;
  const updateActionLabel = updateAvailableVersion
    ? t("nav.updateAvailable", { version: updateAvailableVersion })
    : t("nav.checkForUpdates");

  function renderNavigationItem(item: NavigationItem) {
    const label = t(item.labelKey);
    const Icon = item.icon;
    const active = activeSection === item.section;
    const itemUnreadCount = item.section === "developer-pull-requests"
      ? unreadPullRequestCount
      : item.section === "developer-my-pull-requests"
        ? unreadAuthoredPullRequestCount
        : item.section === "product-task-tracker"
          ? unreadTaskTrackerCount
          : 0;
    const displayUnreadCount = item.section === "product-task-tracker"
      ? itemUnreadCount
      : itemUnreadCount > 99 ? "99+" : itemUnreadCount;
    const navigationLabel = itemUnreadCount > 0
      ? `${label}, ${itemUnreadCount} ${t("nav.unread")}`
      : label;
    const unreadBadgeLabel = item.section === "product-task-tracker"
      ? t("nav.unreadTaskTrackerIssues", { count: itemUnreadCount })
      : t("nav.unreadPullRequests", { count: itemUnreadCount });

    return (
      <Button
        key={item.section}
        asChild
        variant="ghost"
        className={cn("justify-start gap-2 px-3", active && "bg-accent text-accent-foreground")}
      >
        <a
          href={item.href}
          aria-label={navigationLabel}
          aria-current={active ? "page" : undefined}
          onClick={() => onNavigate?.(item.section)}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {itemUnreadCount > 0 ? (
            <span className="sidebar-unread-badge" aria-label={unreadBadgeLabel}>
              {displayUnreadCount}
            </span>
          ) : null}
        </a>
      </Button>
    );
  }

  return (
    <div className="app-shell">
      <aside aria-label={t("nav.primary")}>
        <div className="app-brand">
          <img src="/mework-icon.png" alt="" aria-hidden="true" />
          <strong>mework</strong>
        </div>
        <nav>
          <div className="settings-nav-group" aria-labelledby="developer-nav-title">
            <span id="developer-nav-title" className="settings-nav-heading">{t("nav.developer")}</span>
            <div className="settings-nav-children">
              {developerNavigation.map(renderNavigationItem)}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="product-nav-title">
            <span id="product-nav-title" className="settings-nav-heading">{t("nav.product")}</span>
            <div className="settings-nav-children">
              {productNavigation.map(renderNavigationItem)}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="settings-nav-title">
            <span id="settings-nav-title" className="settings-nav-heading">{t("nav.settings")}</span>
            <div className="settings-nav-children">
              {settingsNavigation.map(renderNavigationItem)}
            </div>
          </div>
        </nav>
        <div className="sidebar-footer">
          <Select
            value={selectedTheme}
            onValueChange={(value) => onThemeChange?.(value as ThemePreference)}
            disabled={themeChanging}
          >
            <SelectTrigger
              className="theme-toggle theme-picker h-7 w-7 justify-center gap-0 border-0 bg-transparent p-0 shadow-none [&>span]:flex [&>span]:items-center [&>span]:justify-center [&>svg:last-child]:hidden"
              aria-label={t("nav.themePicker")}
              title={t("nav.themePicker")}
            >
              <SelectValue>
                {selectedTheme === "system" ? (
                  <span className="relative flex size-5 items-center justify-center" aria-hidden="true">
                    <Monitor className="size-4" />
                    <span className="absolute -right-0.5 -top-0.5 flex size-3 items-center justify-center rounded-full bg-background ring-1 ring-border">
                      {resolvedTheme === "dark" ? <Moon className="size-2 fill-current" /> : <Sun className="size-2" />}
                    </span>
                  </span>
                ) : selectedTheme === "dark" ? (
                  <Moon className="size-4" aria-hidden="true" />
                ) : (
                  <Sun className="size-4" aria-hidden="true" />
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent side="top" align="start">
              <SelectItem value="system"><span className="flex items-center gap-2"><Monitor className="size-4" aria-hidden="true" />{t("general.themeSystem")}</span></SelectItem>
              <SelectItem value="light"><span className="flex items-center gap-2"><Sun className="size-4" aria-hidden="true" />{t("general.themeLight")}</span></SelectItem>
              <SelectItem value="dark"><span className="flex items-center gap-2"><Moon className="size-4" aria-hidden="true" />{t("general.themeDark")}</span></SelectItem>
            </SelectContent>
          </Select>
          {version === "dev" ? (
            <Button
              type="button"
              variant="ghost"
              className="sidebar-version h-7 px-2 py-0 leading-none"
              aria-label={t("nav.openReleases")}
              title={`${t("nav.developmentBuild")} · ${t("nav.openReleases")}`}
              onClick={() => void openUrl(GITHUB_RELEASES_URL)}
            >
              dev
            </Button>
          ) : version && versionLabel ? (
            <Button
              type="button"
              variant="ghost"
              className="sidebar-version h-7 px-2 py-0 leading-none"
              aria-label={updateActionLabel}
              title={updateActionLabel}
              onClick={onOpenUpdateSettings}
            >
              {versionLabel}
              {updateAvailableVersion ? (
                <span className="sidebar-update-dot ml-1.5 inline-block size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              ) : null}
            </Button>
          ) : null}
        </div>
      </aside>
      <main aria-label="mework" className="app-content">
        {children}
      </main>
    </div>
  );
}
