import { v0_3 } from '@anthropic-ai/mcpb/schemas';
import { describe, expect, it } from 'vitest';
// Test-only reach into the MCP package: the CLI itself does not depend on it.
import { TOOLS } from '../../mcp/src/tools.js';
import { MCPB_MANIFEST_VERSION, mcpbManifest } from '../src/mcpb.js';

describe('Claude Desktop extension manifest', () => {
  const manifest = mcpbManifest({ version: '1.0.0', platforms: ['darwin'], tools: TOOLS });

  it('passes the official MCPB 0.3 schema (@anthropic-ai/mcpb, offline)', () => {
    const result = v0_3.McpbManifestSchema.safeParse(manifest);
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(manifest.manifest_version).toBe(MCPB_MANIFEST_VERSION);
  });

  it('runs the bundled server on the chosen workspace as `claude`, listing every tool', () => {
    expect(manifest.server).toEqual({
      type: 'node',
      entry_point: 'server/dist/index.js',
      mcp_config: {
        command: 'node',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: MCPB host placeholders, substituted by Claude Desktop
        args: ['${__dirname}/server/dist/index.js', '--home', '${user_config.workspace}'],
        env: { TASKPACK_ACTOR: 'claude' },
      },
    });
    expect(manifest.user_config).toMatchObject({ workspace: { type: 'directory', required: true } });
    expect((manifest.tools as { name: string }[]).map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });
});
