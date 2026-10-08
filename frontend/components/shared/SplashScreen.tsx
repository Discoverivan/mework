import { useLayoutEffect } from "react";
import { useI18n } from "@/i18n/context";

interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  const { t } = useI18n();
  const startupSplash = document.getElementById("startup-splash");

  // Keep the pre-React DOM and its running animation until startup finishes.
  useLayoutEffect(() => {
    if (!startupSplash) return;
    startupSplash.hidden = !visible;
    startupSplash.setAttribute("aria-label", t("splash.loading"));
    const heading = startupSplash.querySelector("strong");
    const description = startupSplash.querySelector(".splash-copy span");
    const progress = startupSplash.querySelector('[role="progressbar"]');
    if (heading) heading.textContent = t("splash.loading");
    if (description) description.textContent = t("splash.checking");
    progress?.setAttribute("aria-label", t("splash.applicationLoading"));
    progress?.setAttribute("aria-valuetext", t("splash.loadingApplication"));
  }, [startupSplash, t, visible]);

  if (startupSplash) return null;
  if (!visible) return null;

  return (
    <div className="splash-screen" role="status" aria-label={t("splash.loading")} aria-busy="true">
      <div className="splash-panel">
        <img className="splash-logo" src="/mework-icon.png" alt="mework" />
        <div className="splash-copy">
          <strong>{t("splash.loading")}</strong>
          <span>{t("splash.checking")}</span>
        </div>
        <div
          className="splash-progress-track"
          role="progressbar"
          aria-label={t("splash.applicationLoading")}
          aria-valuetext={t("splash.loadingApplication")}
        >
          <div className="splash-progress-bar" />
        </div>
      </div>
    </div>
  );
}
