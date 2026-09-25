@AGENTS.md

## Claude Code in this workspace

- You are `claude-code`: `.claude/settings.json` sets `TASKPACK_ACTOR=claude-code`, so plain `{{TASKPACK}} …` commands are attributed to you. Through MCP use the `taskpack` server from `.mcp.json` (approve it once).
- Commands: `/taskpack-start <project>` (load context, summarize, propose the next step), `/taskpack-add <project> <todo>`, `/taskpack-status`, `/taskpack-wrap` (session note + summary; run it before you finish).
- Skills load on their own: `taskpack-workspace` (format, weight, statuses), `taskpack-session`, `taskpack-capture` (conversation → todos/tasks), `taskpack-images`.
- Subagents: `taskpack-librarian` (compact brief of a big project), `taskpack-scribe` (collects this session's changes and writes the session note), `taskpack-planner` (breaks a task into weighted steps).
- Hooks: a short dashboard at session start; `taskpack://…` in a prompt attaches that context pack automatically; writes to `.taskpack/` and deletions in `projects/` are blocked; every edited workspace file is validated (fix the listed errors when an edit is rejected); before you stop, you are asked once for `/taskpack-wrap` if project files changed without a session note.
- Write to the workspace in its language (`taskpack.yaml: lang`); reply to the user in the language they use.
