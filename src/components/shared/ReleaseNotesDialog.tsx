import { Fragment, useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n/context";
import type { ReleaseNote } from "@/release-notes";

interface ReleaseNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releases: ReleaseNote[];
}

export function ReleaseNotesDialog({ open, onOpenChange, releases }: ReleaseNotesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <ReleaseNotesContent releases={releases} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function ReleaseNotesContent({ releases, onOpenChange }: Pick<ReleaseNotesDialogProps, "releases" | "onOpenChange">) {
  const { language, t } = useI18n();
  const noteLanguage = language === "russian" ? "ru" : "en";
  const contentRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const dividerRefs = useRef<(HTMLElement | null)[]>([]);

  useLayoutEffect(() => {
    let active = true;
    const updateDividerWidths = () => {
      dividerRefs.current.forEach((divider, index) => {
        const previousSection = sectionRefs.current[index];
        const source = previousSection?.querySelector("li:last-child") ?? previousSection?.querySelector("h3");
        if (!divider || !source) return;
        const range = document.createRange();
        range.selectNodeContents(source);
        if (typeof range.getClientRects !== "function") return;
        const lines = Array.from(range.getClientRects()).filter((rect) => rect.width > 0);
        const lastLine = lines[lines.length - 1];
        if (!lastLine) return;
        const dividerLeft = divider.getBoundingClientRect().left;
        divider.style.width = `${Math.ceil(Math.max(0, lastLine.right - dividerLeft))}px`;
      });
    };

    updateDividerWidths();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateDividerWidths);
    if (contentRef.current) observer?.observe(contentRef.current);
    window.addEventListener("resize", updateDividerWidths);
    void document.fonts?.ready.then(() => {
      if (active) updateDividerWidths();
    });
    return () => {
      active = false;
      observer?.disconnect();
      window.removeEventListener("resize", updateDividerWidths);
    };
  }, [language, releases]);

  return (
    <>
      <DialogHeader className="pb-2">
        <DialogTitle>{t("releaseNotes.title")}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div ref={contentRef} className="flex flex-col gap-4">
          {releases.map((release, index) => (
            <Fragment key={release.version}>
              {index > 0 ? <Separator ref={(element) => { dividerRefs.current[index - 1] = element; }} className="w-0 max-w-full" /> : null}
              <section ref={(element) => { sectionRefs.current[index] = element; }} aria-label={t("releaseNotes.version", { version: release.version })}>
                <h3 className="text-sm font-semibold text-foreground">{t("releaseNotes.version", { version: release.version })}</h3>
                <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-muted-foreground">
                  {release.entries.map((entry, entryIndex) => <li key={entryIndex}>{entry[noteLanguage]}</li>)}
                </ul>
              </section>
            </Fragment>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" onClick={() => onOpenChange(false)}>{t("releaseNotes.done")}</Button>
      </DialogFooter>
    </>
  );
}
