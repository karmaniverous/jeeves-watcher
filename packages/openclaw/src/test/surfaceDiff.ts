/**
 * @module test/surfaceDiff
 * Renders the agent-facing differences between two plugin tool surfaces (tool name, description, parameters, catalog mode, options) as Markdown, for the reviewed delta report. Pure.
 */

/** One registered tool, as the surface fixtures record it. */
export interface ToolSurface {
  name: string;
  description: string;
  parameters: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
    additionalProperties?: unknown;
    [key: string]: unknown;
  };
  catalogMode?: unknown;
  options?: unknown;
}

const json = (value: unknown): string => '`' + JSON.stringify(value) + '`';

/**
 * Differences in one tool's parameters, as Markdown list items.
 *
 * @param before - Baseline parameters.
 * @param after - Current parameters.
 * @returns List items (empty when identical).
 */
function parameterLines(
  before: ToolSurface['parameters'],
  after: ToolSurface['parameters'],
): string[] {
  const lines: string[] = [];
  const beforeProps = before.properties ?? {};
  const afterProps = after.properties ?? {};
  const keys = [
    ...new Set([...Object.keys(beforeProps), ...Object.keys(afterProps)]),
  ];
  for (const key of keys) {
    const was = beforeProps[key];
    const now = afterProps[key];
    if (was === undefined)
      lines.push(`- parameter \`${key}\` added: ${json(now)}`);
    else if (now === undefined)
      lines.push(`- parameter \`${key}\` removed (was ${json(was)})`);
    else if (JSON.stringify(was) !== JSON.stringify(now))
      lines.push(`- parameter \`${key}\`: ${json(was)} -> ${json(now)}`);
  }
  const rest = (p: ToolSurface['parameters']) =>
    Object.fromEntries([
      ...Object.entries(p).filter(([key]) => key !== 'properties'),
      ['required', [...(p.required ?? [])].sort()],
    ]) as Record<string, unknown>;
  const restBefore = rest(before);
  const restAfter = rest(after);
  for (const key of [
    ...new Set([...Object.keys(restBefore), ...Object.keys(restAfter)]),
  ]) {
    const was = restBefore[key];
    const now = restAfter[key];
    if (JSON.stringify(was) !== JSON.stringify(now))
      lines.push(`- schema \`${key}\`: ${json(was)} -> ${json(now)}`);
  }
  return lines;
}

/**
 * Render the delta report between a baseline surface and the current one.
 *
 * @param before - Baseline tools, in registration order.
 * @param after - Current tools, in registration order.
 * @param renames - Each renamed baseline tool and its current name.
 * @returns Markdown: one section per tool that changed, then removed and added tools.
 */
export function renderSurfaceDiff(
  before: readonly ToolSurface[],
  after: readonly ToolSurface[],
  renames: Readonly<Record<string, string>>,
): string {
  const out: string[] = [];
  const current = new Map(after.map((tool) => [tool.name, tool]));
  const matched = new Set<string>();
  for (const old of before) {
    const name = renames[old.name] ?? old.name;
    const now = current.get(name);
    if (now === undefined) {
      out.push(`## ${old.name}`, '', '- removed', '');
      continue;
    }
    matched.add(name);
    const lines: string[] = [];
    if (name !== old.name) lines.push(`- renamed to \`${name}\``);
    if (old.description !== now.description)
      lines.push(
        `- description: ${json(old.description)} -> ${json(now.description)}`,
      );
    lines.push(...parameterLines(old.parameters, now.parameters));
    if (JSON.stringify(old.catalogMode) !== JSON.stringify(now.catalogMode))
      lines.push(
        `- catalogMode: ${json(old.catalogMode)} -> ${json(now.catalogMode)}`,
      );
    if (JSON.stringify(old.options) !== JSON.stringify(now.options))
      lines.push(`- options: ${json(old.options)} -> ${json(now.options)}`);
    out.push(
      `## ${old.name}`,
      '',
      ...(lines.length ? lines : ['- unchanged']),
      '',
    );
  }
  for (const tool of after) {
    if (!matched.has(tool.name))
      out.push(`## ${tool.name}`, '', `- added: ${json(tool)}`, '');
  }
  const order = (tools: readonly ToolSurface[], map: (n: string) => string) =>
    tools.map((tool) => map(tool.name)).join(', ');
  const beforeOrder = order(before, (n) => renames[n] ?? n);
  const afterOrder = order(after, (n) => n);
  out.push(
    '## Registration order',
    '',
    beforeOrder === afterOrder
      ? '- unchanged (baseline order, current names)'
      : `- ${beforeOrder} -> ${afterOrder}`,
    '',
  );
  return out.join('\n');
}
