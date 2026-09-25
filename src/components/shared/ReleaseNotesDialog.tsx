import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/i18n/context";
import type { ReleaseNote } from "@/release-notes";

interface ReleaseNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releases: ReleaseNote[];
}

export function ReleaseNotesDialog({ open, onOpenChange, releases }: ReleaseNotesDialogProps) {
  const { language, t } = useI18n();
  const noteLanguage = language === "russian" ? "ru" : "en";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("releaseNotes.title")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-5">
            {releases.map((release) => (
              <section key={release.version} aria-label={t("releaseNotes.version", { version: release.version })}>
                <h3 className="text-sm font-semibold text-foreground">{t("releaseNotes.version", { version: release.version })}</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {release.entries.map((entry, index) => <li key={index}>{entry[noteLanguage]}</li>)}
                </ul>
              </section>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>{t("releaseNotes.done")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
