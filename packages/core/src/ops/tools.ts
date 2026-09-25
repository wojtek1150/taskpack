import YAML, { isMap } from 'yaml';
import { z } from 'zod';
import { TOOL_NAMES, type ToolName } from '../format/enums.js';
import { configFile } from '../layout.js';
import { type Context, mutate, type Written } from '../workspace.js';
import { parseInput } from './common.js';

export const setToolsInput = z.object({
  /** Tools to switch on (`true`) or off (`false`) globally; others stay as they are. */
  tools: z.partialRecord(z.enum(TOOL_NAMES), z.boolean()),
});

export interface SetToolsResult {
  /** Effective switch of every tool after the change (missing = enabled). */
  tools: Record<ToolName, boolean>;
  changed: ToolName[];
}

const SUMMARY = {
  pl: (on: string[], off: string[]) =>
    [on.length ? `narzędzia włączone: ${on.join(', ')}` : '', off.length ? `wyłączone: ${off.join(', ')}` : '']
      .filter(Boolean)
      .join('; '),
  en: (on: string[], off: string[]) =>
    [on.length ? `tools enabled: ${on.join(', ')}` : '', off.length ? `disabled: ${off.join(', ')}` : '']
      .filter(Boolean)
      .join('; '),
};

/** Switch MCP tools in `taskpack.yaml: tools` (node-level YAML edit; comments and other keys untouched). */
export function setTools(ctx: Context, input: z.input<typeof setToolsInput>): Written<SetToolsResult> {
  const args = parseInput(setToolsInput, input);
  return mutate(ctx, (tx) => {
    const file = configFile(tx.ws.home);
    const text = tx.open(file);
    const doc = YAML.parseDocument(text.toString(), { schema: 'core' });
    const current = tx.ws.config.tools;
    const changed = (Object.entries(args.tools) as [ToolName, boolean][]).filter(
      ([name, on]) => (current[name] ?? true) !== on,
    );
    if (changed.length) {
      if (!isMap(doc.get('tools'))) doc.set('tools', doc.createNode({}));
      for (const [name, on] of changed) doc.setIn(['tools', name], on);
      text.lines = doc.toString({ lineWidth: 0 }).split(text.eol);
      tx.log({
        op: 'config.tools',
        entity: file,
        summary: SUMMARY[tx.lang](
          changed.filter(([, on]) => on).map(([n]) => n),
          changed.filter(([, on]) => !on).map(([n]) => n),
        ),
      });
    }
    const tools = Object.fromEntries(
      TOOL_NAMES.map((name) => [name, args.tools[name] ?? current[name] ?? true]),
    ) as Record<ToolName, boolean>;
    return { tools, changed: changed.map(([n]) => n) };
  });
}
