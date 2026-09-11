import { useEffect, useState } from "react";
import { AppShell, type AppSection, type Theme } from "./components/layout/AppShell";
import { SplashScreen } from "./components/shared/SplashScreen";
import { UpdateBanner } from "./components/shared/UpdateBanner";
import { AppRoutes, type AppRoute } from "./app/routes";
import { PresenterView } from "./features/daily/PresenterView";
import { getAiSettings, refreshAllIntegrationsHealth } from "./features/settings/api";
import { INTEGRATIONS_HEALTH_REFRESHED_EVENT } from "./features/settings/health-events";
import "./App.css";
import "./presenter.css";
import "./daily-status.css";

function systemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function routeFromHash(hash: string): AppRoute {
  if (hash === "#product/create-task") return "product-create-task";
  if (hash === "#product/planning") return "product-planning";
  if (hash === "#product/daily") return "product-daily";
  if (hash === "#product/daily/presenter") return "product-daily-presenter";
  if (hash === "#developer/pull-requests") return "developer-pull-requests";
  if (hash === "#settings/general") return "settings-general";
  if (hash === "#settings/projects") return "settings-projects";
  if (hash === "#settings" || hash === "#settings/integrations") return "settings-integrations";
  return "inbox";
}

function App() {
  const initialRoute = routeFromHash(typeof window !== "undefined" ? window.location.hash : "");
  const [theme, setTheme] = useState<Theme>(systemTheme);
  const [route, setRoute] = useState<AppRoute>(initialRoute);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      refreshAllIntegrationsHealth(),
      getAiSettings(),
    ]).then(([integrationsResult]) => {
      if (!active) return;
      if (integrationsResult.status === "fulfilled") {
        window.dispatchEvent(
          new CustomEvent(INTEGRATIONS_HEALTH_REFRESHED_EVENT, { detail: integrationsResult.value }),
        );
      }
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(section: AppSection) {
    setRoute(section);
  }

  if (route === "product-daily-presenter") {
    return <PresenterView />;
  }

  return (
    <>
      <AppShell theme={theme} onThemeChange={setTheme} onNavigate={navigate}>
        <AppRoutes route={route} />
      </AppShell>
      <SplashScreen visible={!ready} />
      <UpdateBanner enabled={ready} />
    </>
  );
}

export default App;
