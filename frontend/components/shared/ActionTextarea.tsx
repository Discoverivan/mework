import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { directPointerHover } from "@/lib/direct-pointer-hover";
import { cn } from "@/lib/utils";

type Props = Omit<ComponentProps<typeof Textarea>, "value" | "className"> & {
  value: string;
  action: ReactNode;
  className?: string;
};

// Measure rendered lines at full width, then move the action below any text
// that would otherwise run underneath it.
export function ActionTextarea({ action, className, value, ...props }: Props) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const actionElement = actionRef.current;
    if (!field || !actionElement) return;
    const mirror = document.createElement("div");
    mirror.setAttribute("aria-hidden", "true");
    mirror.style.cssText = "position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;box-sizing:border-box;";
    document.body.append(mirror);
    const measure = () => {
      if (!field.clientWidth) return;
      const style = getComputedStyle(field);
      for (const property of ["font-family", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "word-spacing", "tab-size", "padding-top", "padding-bottom", "padding-left", "padding-right"]) {
        mirror.style.setProperty(property, style.getPropertyValue(property));
      }
      mirror.style.width = `${field.clientWidth}px`;
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
      const actionTopInset = 4;
      const gap = 4;
      const paddingHeight = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const initialHeight = Math.max(lineHeight, actionElement.offsetHeight) + paddingHeight;
      const actionLeft = field.clientWidth - actionElement.offsetWidth - actionTopInset;
      field.parentElement?.style.setProperty("--textarea-action-width", `${actionElement.offsetWidth}px`);
      const heightForText = (text: string) => {
        mirror.textContent = text + "\u200b";
        const range = document.createRange();
        range.selectNodeContents(mirror);
        const lines = Array.from(range.getClientRects());
        const bounds = mirror.getBoundingClientRect();
        const height = Math.max(parseFloat(style.minHeight) || 0, mirror.offsetHeight, initialHeight);
        const required = Math.max(height, ...lines
          .filter(line => line.right - bounds.left + gap > actionLeft)
          .map(line => line.bottom - bounds.top + gap + actionElement.offsetHeight + actionTopInset));
        // Round to text lines so growth also happens before a soft wrap or Enter.
        return height + Math.max(0, Math.ceil((required - height) / lineHeight)) * lineHeight;
      };
      field.style.height = `${heightForText(value)}px`;
    };
    measure();
    let resizeFrame = 0;
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(measure);
    });
    observer?.observe(field);
    observer?.observe(actionElement);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(resizeFrame);
      document.fonts?.removeEventListener("loadingdone", measure);
      mirror.remove();
    };
  }, [value, props.placeholder]);

  return <div data-slot="textarea-composer" className={cn("relative rounded-md border border-input bg-card", className)} {...directPointerHover<HTMLDivElement>({})}>
    <Textarea {...props} ref={fieldRef} value={value} rows={1} className="block min-h-10 min-w-0 resize-none overflow-hidden rounded-none border-0! bg-transparent py-1 text-sm leading-8 placeholder:text-transparent" />
    {!value && props.placeholder ? <span aria-hidden="true" className="pointer-events-none absolute left-3 right-[calc(var(--textarea-action-width,160px)+12px)] top-1 truncate text-sm leading-8 text-muted-foreground">{props.placeholder}</span> : null}
    <div ref={actionRef} data-slot="textarea-action" className="absolute bottom-1 right-1 flex max-w-[calc(100%-8px)]">{action}</div>
  </div>;
}
