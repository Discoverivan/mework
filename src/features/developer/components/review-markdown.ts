import { fromMarkdown } from "mdast-util-from-markdown";

/** Repair misplaced opening fences in AI prose without rewriting code blocks. */
export function normalizeReviewMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/);

  // Reparse after each repair: a misplaced closing fence can initially consume
  // later prose as code, and repairing its opening restores that prose.
  for (;;) {
    const protectedLines = new Set<number>();
    const textPositions: NonNullable<ReturnType<typeof fromMarkdown>["position"]>[] = [];
    const visit = (node: ReturnType<typeof fromMarkdown> | ReturnType<typeof fromMarkdown>["children"][number], parentType?: string) => {
      if (node.type === "text" && node.position) textPositions.push(node.position);
      if ((node.type === "code" || (node.type === "html" && parentType !== "paragraph")) && node.position) {
        for (let line = node.position.start.line; line <= node.position.end.line; line += 1) protectedLines.add(line - 1);
      }
      if ("children" in node) node.children.forEach((child) => visit(child, node.type));
    };
    visit(fromMarkdown(lines.join("\n")));
    let repaired = false;

    for (let index = 0; index < lines.length; index += 1) {
      if (protectedLines.has(index)) continue;
      const misplaced = lines[index].match(/^([ \t]*(?:>[ \t]*)*)((?:[-+*]|\d+[.)])[ \t]+)?(.+\S)[ \t]+(`{3,}|~{3,})([\w.+-]*)[ \t]*$/);
      if (!misplaced) continue;
      const [, quotePrefix, listPrefix = "", prose, fence, language] = misplaced;
      const fenceColumn = lines[index].lastIndexOf(fence) + 1;
      // A valid inline code span may end with the same delimiter. Only repair
      // fences parsed as prose, leaving inline code and other syntax intact.
      if (!textPositions.some(({ start, end }) =>
        start.line <= index + 1 && end.line >= index + 1
        && (start.line < index + 1 || start.column <= fenceColumn)
        && (end.line > index + 1 || end.column >= fenceColumn + fence.length))) continue;
      const continuationPrefix = quotePrefix + " ".repeat(listPrefix.length);
      const hasClosingFence = lines.slice(index + 1).some((candidate) => {
        if (!candidate.startsWith(continuationPrefix)) return false;
        const closing = candidate.slice(continuationPrefix.length).match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
        return closing && closing[1][0] === fence[0] && closing[1].length >= fence.length;
      });
      if (!hasClosingFence) continue;
      lines.splice(index, 1, `${quotePrefix}${listPrefix}${prose}`, continuationPrefix.trimEnd(), `${continuationPrefix}${fence}${language}`);
      repaired = true;
      break;
    }
    if (!repaired) return lines.join("\n");
  }
}
