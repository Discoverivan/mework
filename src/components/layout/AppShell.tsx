import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Theme = "light" | "dark";

export type AppSection = "inbox" | "product-create-task" | "product-planning" | "product-daily" | "developer-pull-requests" | "settings-general" | "settings-integrations" | "settings-projects";

interface AppShellProps {
  children: ReactNode;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onNavigate?: (section: AppSection) => void;
}

const navigation = [
  { section: "inbox", label: "Inbox", href: "#inbox" },
] as const;

const productNavigation = [
  { section: "product-create-task", label: "Create task", href: "#product/create-task" },
  { section: "product-daily", label: "Daily", href: "#product/daily" },
  { section: "product-planning", label: "Planning", href: "#product/planning" },
] as const;

const developerNavigation = [
  { section: "developer-pull-requests", label: "Pull Request Review", href: "#developer/pull-requests" },
] as const;

const settingsNavigation = [
  { section: "settings-general", label: "General", href: "#settings/general" },
  { section: "settings-integrations", label: "Integrations", href: "#settings/integrations" },
  { section: "settings-projects", label: "Team settings", href: "#settings/projects" },
] as const;

export function AppShell({ children, theme, onThemeChange, onNavigate }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside aria-label="Primary navigation">
        <strong>Mework</strong>
        <nav>
          {navigation.map((item) => (
            <Button key={item.label} asChild variant="ghost" className="justify-start">
              <a
                href={item.href}
                onClick={() => {
                  if (item.section) onNavigate?.(item.section);
                }}
              >
                {item.label}
              </a>
            </Button>
          ))}
          <div className="settings-nav-group" aria-labelledby="developer-nav-title">
            <span id="developer-nav-title" className="settings-nav-heading">Developer</span>
            <div className="settings-nav-children">
              {developerNavigation.map((item) => (
                <Button key={item.label} asChild variant="ghost" className="justify-start">
                  <a
                    href={item.href}
                    onClick={() => onNavigate?.(item.section)}
                  >
                    {item.label}
                  </a>
                </Button>
              ))}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="product-nav-title">
            <span id="product-nav-title" className="settings-nav-heading">Product</span>
            <div className="settings-nav-children">
              {productNavigation.map((item) => (
                <Button key={item.label} asChild variant="ghost" className="justify-start">
                  <a
                    href={item.href}
                    onClick={() => onNavigate?.(item.section)}
                  >
                    {item.label}
                  </a>
                </Button>
              ))}
            </div>
          </div>
          <div className="settings-nav-group" aria-labelledby="settings-nav-title">
            <span id="settings-nav-title" className="settings-nav-heading">Settings</span>
            <div className="settings-nav-children">
              {settingsNavigation.map((item) => (
                <Button key={item.label} asChild variant="ghost" className="justify-start">
                  <a
                    href={item.href}
                    onClick={() => onNavigate?.(item.section)}
                  >
                    {item.label}
                  </a>
                </Button>
              ))}
            </div>
          </div>
        </nav>
        <div className="theme-picker">
          <Label htmlFor="theme-select">Theme</Label>
          <Select value={theme} onValueChange={(value) => onThemeChange(value as Theme)}>
            <SelectTrigger id="theme-select" aria-label="Theme">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">White</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </aside>
      <main aria-label="Mework" className="app-content">
        {children}
      </main>
    </div>
  );
}
