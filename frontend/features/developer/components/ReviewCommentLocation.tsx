import { Hint } from "@/components/ui/tooltip";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/i18n/context";
import { cn } from "@/lib/utils";
import type { PullRequestReviewComment } from "@/shared/contracts/developer";
import { reviewCommentPath } from "./review-comment-path";

function commentDiffUrl(pullRequestUrl: string | undefined, comment: PullRequestReviewComment): string | undefined {
  const file = reviewCommentPath(comment.file);
  if (!pullRequestUrl || !file) return undefined;
  try {
    const url = new URL(pullRequestUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return undefined;
    if (!/\/pull-requests\/\d+(?:\/.*)?$/.test(url.pathname)) return undefined;
    url.pathname = url.pathname.replace(/(\/pull-requests\/\d+)(?:\/.*)?$/, "$1/diff");
    url.search = "";
    // Bitbucket Server/DC: ?t= selects the new (TO) side, ?f= the old (FROM) side.
    // AI findings use new-file line numbers; publication resolves the actual line type from the PR diff.
    const line = comment.line != null && Number.isSafeInteger(comment.line) && comment.line > 0 ? `?t=${comment.line}` : "";
    url.hash = `${file.split("/").map(encodeURIComponent).join("/")}${line}`;
    return url.href;
  } catch {
    return undefined;
  }
}

export function CommentLocation({ comment }: { comment: PullRequestReviewComment }) {
  const segments = reviewCommentPath(comment.file).split("/");
  const filename = segments.pop();
  return <>{segments.map((segment, index) => <span key={index}>{segment}/<wbr /></span>)}<span className="inline-block max-w-full break-all">{filename}{comment.line != null ? `:${comment.line}` : ""}</span></>;
}

export function ReviewCommentLocation({ comment, pullRequestUrl, onOpen }: {
  comment: PullRequestReviewComment;
  pullRequestUrl?: string;
  onOpen?: () => void;
}) {
  const { t } = useI18n();
  const diffUrl = commentDiffUrl(pullRequestUrl, comment);
  const location = `${reviewCommentPath(comment.file)}${comment.line != null ? `:${comment.line}` : ""}`;
  const locationClass = "block min-w-0 font-mono text-sm font-medium text-primary";
  return <CardHeader variant="section" className="min-w-0 px-4 py-2">
    <CardTitle className="min-w-0 text-sm font-medium leading-5 tracking-normal">
      {diffUrl ? <Hint content={t("pr.dialog.openCommentLocation", { location })}>
        <a href={diffUrl} target="_blank" rel="noopener noreferrer" className={cn(locationClass, "rounded-sm hover:[&_span]:underline focus-visible:[&_span]:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")} onClick={onOpen}>
          <CommentLocation comment={comment} />
        </a>
      </Hint> : <span className={locationClass}><CommentLocation comment={comment} /></span>}
    </CardTitle>
  </CardHeader>;
}
