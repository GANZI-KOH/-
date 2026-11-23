/**
 * Normalizes LaTeX delimiters (\[...\] and \(...\)) into $$...$$ and $...$
 * outside of fenced code blocks so remark-math + rehype-katex render reliably.
 */
export function normalizeMathMarkdown(markdown: string): string {
  if (!markdown) return "";

  const segments = markdown.split(/(```[\s\S]*?```)/g);
  return segments
    .map((segment, index) => {
      // Odd segments are fenced code blocks; leave them untouched
      if (index % 2 === 1) {
        return segment;
      }
      return segment
        .replace(/\\\[([\s\S]*?)\\\]/g, (_match, expr: string) => `\n$$\n${expr.trim()}\n$$\n`)
        .replace(/\\\((.*?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`);
    })
    .join("");
}
