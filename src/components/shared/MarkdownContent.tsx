import { useId } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";

interface MarkdownContentProps {
  children: string;
  className?: string;
  onOpenLink?: (href: string) => void;
}

function isExternalLink(href: string): boolean {
  return /^(?:https?:\/\/|mailto:)/i.test(href);
}

export function MarkdownContent({ children, className, onOpenLink }: MarkdownContentProps) {
  const { t } = useI18n();
  const id = useId();
  const footnoteLabelId = `${id}-footnote-label`;
  const linkClassName = "text-primary underline underline-offset-2";

  return (
    <div className={cn("min-w-0 max-w-full break-words text-sm text-foreground [&>*+*]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_h4]:font-semibold [&_h5]:font-semibold [&_h6]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li+li]:mt-1 [&_li>*+*]:mt-2 [&_li>ul]:mt-1 [&_li>ol]:mt-1 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote>*+*]:mt-2 [&_code]:font-mono [&_code]:text-xs [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_ul.contains-task-list]:list-none [&_input]:mr-1.5", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        remarkRehypeOptions={{ clobberPrefix: `${id}-`, footnoteLabel: t("markdown.footnotes"), footnoteBackLabel: t("markdown.footnoteBack") }}
        components={{
          hr: () => <Separator decorative={false} />,
          h2: ({ children: text, id: headingId, node: _node, ...props }) => <h2 {...props} id={headingId === "footnote-label" ? footnoteLabelId : headingId}>{text}</h2>,
          pre: ({ children: code }) => <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 whitespace-pre">{code}</pre>,
          table: ({ children: rows }) => <div className="max-w-full overflow-x-auto"><table className="w-full border-collapse text-sm [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2">{rows}</table></div>,
          // Keep remote images as links so untrusted Markdown cannot load trackers.
          img: ({ src, alt }) => src && isExternalLink(src)
            ? <a href={src} target="_blank" rel="noopener noreferrer" className={linkClassName} onClick={onOpenLink ? (event) => { event.preventDefault(); onOpenLink(src); } : undefined}>{alt || t("markdown.image")}</a>
            : <span>{alt || t("markdown.image")}</span>,
          p: ({ children: text }) => <p className="text-foreground">{text}</p>,
          a: ({ href, children: text, node: _node, ...props }) => {
            if (!href || (!href.startsWith("#") && !isExternalLink(href))) return <span>{text}</span>;
            const external = isExternalLink(href);
            return <a {...props} href={href} className={linkClassName}
              aria-describedby={props["aria-describedby"] === "footnote-label" ? footnoteLabelId : props["aria-describedby"]}
              target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined}
              onClick={external && onOpenLink ? (event) => { event.preventDefault(); onOpenLink(href); } : undefined}>{text}</a>;
          },
        }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
