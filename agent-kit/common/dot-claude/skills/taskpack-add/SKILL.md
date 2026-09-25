---
name: taskpack-add
description: Add a todo to a Taskpack project (or inbox), without duplicates. /taskpack-add <project> <todo text>
argument-hint: <project> <todo text>
disable-model-invocation: true
---

Add a todo. Project: `$0` (slug, `taskpack://` reference, or `inbox`). Text: everything after the project in `$ARGUMENTS`.

1. If the project is missing or unknown, list projects (`taskpack status` or MCP `list_projects`) and ask.
2. Check the project's open todos (the pack you already have, or `taskpack pack <project>`); if the same intent exists, say so instead of adding.
3. Add it: MCP `add_todo`, or `taskpack todo add <project> <text>` (exact command in AGENTS.md). Keep the user's wording; fix only obvious typos. Several items separated by `;` become separate todos.
4. Confirm with the new id in one line.
