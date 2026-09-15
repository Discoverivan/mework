interface SplashScreenProps {
  visible: boolean;
}

export function SplashScreen({ visible }: SplashScreenProps) {
  if (!visible) return null;

  return (
    <div className="splash-screen" role="status" aria-label="Loading mework" aria-busy="true">
      <div className="splash-panel">
        <img className="splash-logo" src="/mework-icon.png" alt="mework" />
        <div className="splash-copy">
          <strong>Loading mework</strong>
          <span>Checking integrations and AI providers…</span>
        </div>
        <div
          className="splash-progress-track"
          role="progressbar"
          aria-label="Application loading"
          aria-valuetext="Loading application"
        >
          <div className="splash-progress-bar" />
        </div>
      </div>
    </div>
  );
}
