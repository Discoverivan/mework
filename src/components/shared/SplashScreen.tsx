interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  const { t } = useI18n();
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
import { useI18n } from "@/i18n/context";
