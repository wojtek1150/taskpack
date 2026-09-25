# `taskpack-mcp`

Local MCP server for a Taskpack workspace, over stdio. Built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server`); all SDK-specific code is in [`src/server.ts`](src/server.ts), the tools themselves (thin wrappers around `@taskpack/core` operations) in [`src/tools.ts`](src/tools.ts).

```sh
pnpm build
node packages/mcp/dist/index.js [--home <dir>] [--actor <actor>]   # env: TASKPACK_HOME, TASKPACK_ACTOR
```

Without `--actor` / `TASKPACK_ACTOR` the actor is inferred from the client's `clientInfo.name` (`claude-code`, `claude`, `chatgpt`, `codex`, `cursor`, else `other`). Client configs: `taskpack mcp config <claude-desktop|cursor|codex>`; Claude Code gets `.mcp.json` in the workspace from `taskpack init`.

Tools, resources, prompts and the per-client tool switches: [agent-kit/GUIDE.md](../../agent-kit/GUIDE.md#mcp-server-reference).
