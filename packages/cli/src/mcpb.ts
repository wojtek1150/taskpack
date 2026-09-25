/**
 * `manifest.json` of the Claude Desktop extension (`pnpm kit:mcpb` → `dist/taskpack.mcpb`).
 *
 * Format: MCP Bundle manifest 0.3 (https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md;
 * schemas in `@anthropic-ai/mcpb` 2.1.2, which validates 0.1–0.4; 0.4 only adds the `uv` server type).
 * The host replaces `${__dirname}` (the unpacked bundle), `${user_config.<key>}` and `${HOME}` in
 * `mcp_config` and in `user_config` defaults.
 */

export const MCPB_MANIFEST_VERSION = '0.3';

export interface McpbManifestOptions {
  version: string;
  /** Platforms the bundled native modules (better-sqlite3, sharp) were built for. */
  platforms: NodeJS.Platform[];
  tools: readonly { name: string; description: string }[];
}

export function mcpbManifest(opts: McpbManifestOptions): Record<string, unknown> {
  return {
    manifest_version: MCPB_MANIFEST_VERSION,
    name: 'taskpack',
    display_name: 'Taskpack',
    version: opts.version,
    description:
      'Your local Taskpack projects in Claude: context packs, todos, tasks, session notes, images and questions.',
    long_description:
      'Taskpack keeps personal projects as Markdown files in a workspace folder. This extension runs the Taskpack MCP server on your computer over stdio: Claude reads a project with get_project when you mention taskpack://<project>, writes todos, steps and a session note, and asks you questions that show up in the Taskpack app. Nothing leaves your machine.',
    author: { name: 'Taskpack' },
    license: 'MIT',
    keywords: ['projects', 'todo', 'markdown', 'local-first'],
    server: {
      type: 'node',
      entry_point: 'server/dist/index.js',
      mcp_config: {
        command: 'node',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: MCPB host placeholders, substituted by Claude Desktop
        args: ['${__dirname}/server/dist/index.js', '--home', '${user_config.workspace}'],
        // Attribution: everything written through this extension is `by:claude`.
        env: { TASKPACK_ACTOR: 'claude' },
      },
    },
    user_config: {
      workspace: {
        type: 'directory',
        title: 'Taskpack workspace',
        description: 'The folder with taskpack.yaml (created by `taskpack init`, ~/Taskpack by default).',
        required: true,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: MCPB host placeholders, substituted by Claude Desktop
        default: '${HOME}/Taskpack',
      },
    },
    tools: opts.tools.map(({ name, description }) => ({ name, description })),
    compatibility: {
      platforms: opts.platforms,
      runtimes: { node: '>=22.0.0' },
    },
  };
}
