---
name: taskpack-status
description: Show the Taskpack dashboard - projects with progress and next steps, questions waiting for the user. /taskpack-status
disable-model-invocation: true
---

Show the Taskpack dashboard.

Run the `taskpack status` command (exact command in AGENTS.md), or call MCP `list_projects` if there is no shell. Present it compactly: each active project with progress and its next step, then open questions waiting for the user. Point out anything overdue, blocked or without a next step, and suggest which project to pick up (`/taskpack-start <project>`). Answer in the workspace language (`taskpack.yaml: lang`).
