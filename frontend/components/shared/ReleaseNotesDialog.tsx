import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MarkdownContent } from "./MarkdownContent";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/context";
import type { ReleaseNote } from "@/release-notes";

interface ReleaseNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releases: ReleaseNote[];
  mode?: "update" | "history";
  navigation?: {
    newerVersion?: string;
    olderVersion?: string;
    loading: boolean;
    onNavigate: (version: string) => void;
  };
}

export function ReleaseNotesDialog({ open, onOpenChange, releases, mode = "update", navigation }: ReleaseNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2">
        <ReleaseNotesContent releases={releases} mode={mode} navigation={navigation} />
      </DialogContent>
    </Dialog>
  );
}

function ReleaseNotesContent({ releases, mode, navigation }: Pick<ReleaseNotesDialogProps, "releases" | "navigation"> & { mode: "update" | "history" }) {
  const { t } = useI18n();
  const [selectedVersion, setSelectedVersion] = useState<string>();
  const selectedIndex = Math.max(0, releases.findIndex((release) => release.version === selectedVersion));
  const release = releases[selectedIndex];
  const pageNavigation = navigation ?? {
    newerVersion: releases[selectedIndex - 1]?.version,
    olderVersion: releases[selectedIndex + 1]?.version,
    loading: false,
    onNavigate: setSelectedVersion,
  };

  return (
    <>
      <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8 text-left">
        <DialogTitle>{t(mode === "history" ? "releaseNotes.open" : "releaseNotes.title")}</DialogTitle>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" disabled={!pageNavigation.newerVersion || pageNavigation.loading}
            onClick={() => pageNavigation.newerVersion && pageNavigation.onNavigate(pageNavigation.newerVersion)}
            aria-label={t("releaseNotes.newerVersion")} title={t("releaseNotes.newerVersion")}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" disabled={!pageNavigation.olderVersion || pageNavigation.loading}
            onClick={() => pageNavigation.olderVersion && pageNavigation.onNavigate(pageNavigation.olderVersion)}
            aria-label={t("releaseNotes.olderVersion")} title={t("releaseNotes.olderVersion")}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </DialogHeader>
      <DialogBody key={release?.version}>
        <div className="flex flex-col gap-4" aria-busy={pageNavigation.loading}>
          {release ? (
            <section aria-label={t("releaseNotes.version", { version: release.version })}>
              <h3 className="text-sm font-semibold text-foreground">{t("releaseNotes.version", { version: release.version })}</h3>
              <MarkdownContent className="mt-2" onOpenLink={(href) => { void openUrl(href); }}>
                {release.markdown}
              </MarkdownContent>
            </section>
          ) : null}
        </div>
      </DialogBody>
    </>
  );
}
