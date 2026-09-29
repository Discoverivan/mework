import { Fragment, useLayoutEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
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
  const { language, t } = useI18n();
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
      <DialogHeader className="flex-row items-center justify-between gap-3 space-y-0 pr-8 text-left">
        <DialogTitle>{t(mode === "history" ? "releaseNotes.open" : "releaseNotes.title")}</DialogTitle>
        {navigation ? <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" disabled={!navigation.newerVersion || navigation.loading}
            onClick={() => navigation.newerVersion && navigation.onNavigate(navigation.newerVersion)}
            aria-label={t("releaseNotes.newerVersion")} title={t("releaseNotes.newerVersion")}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" disabled={!navigation.olderVersion || navigation.loading}
            onClick={() => navigation.olderVersion && navigation.onNavigate(navigation.olderVersion)}
            aria-label={t("releaseNotes.olderVersion")} title={t("releaseNotes.olderVersion")}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div> : null}
      </DialogHeader>
      <DialogBody>
        <div ref={contentRef} className="flex flex-col gap-4" aria-busy={navigation?.loading}>
          {releases.map((release, index) => (
            <Fragment key={release.version}>
              {index > 0 ? <Separator ref={(element) => { dividerRefs.current[index - 1] = element; }} className="w-0 max-w-full" /> : null}
              <section ref={(element) => { sectionRefs.current[index] = element; }} aria-label={t("releaseNotes.version", { version: release.version })}>
                <h3 className="text-sm font-semibold text-foreground">{t("releaseNotes.version", { version: release.version })}</h3>
                <div className="mt-2 text-sm text-muted-foreground [&_h2]:mb-2 [&_h2]:font-semibold [&_h3]:mb-2 [&_h3]:font-semibold [&_p]:mb-2 [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1">
                  <ReactMarkdown skipHtml allowedElements={["h2", "h3", "h4", "p", "ul", "ol", "li", "strong", "em", "code", "pre", "a", "blockquote", "br"]}
                    components={{ a: ({ href, children }) => href?.startsWith("https://")
                      ? <a href={href} className="underline underline-offset-2" onClick={(event) => { event.preventDefault(); void openUrl(href); }}>{children}</a>
                      : <span>{children}</span> }}>
                    {release.markdown}
                  </ReactMarkdown>
                </div>
              </section>
            </Fragment>
          ))}
        </div>
      </DialogBody>
    </>
  );
}
