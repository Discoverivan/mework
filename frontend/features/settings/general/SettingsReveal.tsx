import type { ReactNode } from "react";
import "./SettingsReveal.css";

export function SettingsReveal({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return <div id={id} className="settings-section-reveal" data-expanded={open}>
    <div className="min-h-0 overflow-hidden" aria-hidden={!open} inert={!open}>{children}</div>
  </div>;
}
