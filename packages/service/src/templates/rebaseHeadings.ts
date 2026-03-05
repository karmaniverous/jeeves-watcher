/**
 * @module templates/rebaseHeadings
 * Rebase Markdown heading levels so the minimum heading depth starts at baseHeading+1.
 */

/**
 * Rebase Markdown headings.
 *
 * Finds all ATX headings (lines starting with one or more '#'),
 * computes the minimum heading level present, and shifts all headings
 * so that the minimum becomes baseHeading+1.
 */
export function rebaseHeadings(markdown: string, baseHeading: number): string {
  if (!markdown.trim()) return markdown;

  const lines = markdown.split(/\r?\n/);
  const headingLevels: number[] = [];

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+/);
    if (m) headingLevels.push(m[1].length);
  }

  if (headingLevels.length === 0) return markdown;

  const minLevel = Math.min(...headingLevels);
  const targetMin = Math.min(6, Math.max(1, baseHeading + 1));
  const delta = targetMin - minLevel;
  if (delta === 0) return markdown;

  const rebased = lines.map((line) => {
    const m = line.match(/^(#{1,6})(\s+.*)$/);
    if (!m) return line;
    const level = m[1].length;
    const newLevel = Math.min(6, Math.max(1, level + delta));
    return `${'#'.repeat(newLevel)}${m[2]}`;
  });

  return rebased.join('\n');
}
