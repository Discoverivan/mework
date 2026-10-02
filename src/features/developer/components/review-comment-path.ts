export function reviewCommentPath(file: string): string {
  return file.trim().replace(/^(?:src|dst):\/\//, "");
}
