---
name: taskpack-start
description: Start a Taskpack session on a project - load its context, summarize the state, propose the next step. /taskpack-start <project>
argument-hint: <project>
disable-model-invocation: true
---

Start a Taskpack working session on project `$ARGUMENTS` (a slug or `taskpack://` reference; if empty, run the `taskpack status` command from AGENTS.md, show the projects and ask which one).

Follow the **Start** part of the `taskpack-session` skill:

1. Load the context pack: MCP `get_project` if the `taskpack` server is connected, otherwise `taskpack pack $ARGUMENTS` (exact command in AGENTS.md). For a large project, ask the `taskpack-librarian` subagent for a brief instead.
2. Summarize in 3–5 lines: state (Now / Blocker / Next), overdue or blocked items, what the last session left open.
3. Act on answers to earlier questions; mention questions still waiting for the user.
4. Propose one concrete next step and ask whether to start.

Note the current time as the session start. Answer in the workspace language (`taskpack.yaml: lang`).
