---
name: taskpack-wrap
description: Wrap up the Taskpack session - record missing todos and decisions, update the summary, write the session note (podsumuj sesję). /taskpack-wrap [project]
argument-hint: '[project]'
disable-model-invocation: true
---

Wrap up this Taskpack session. Project: `$ARGUMENTS`, or every project whose files changed in this session if empty.

Follow the **Wrap-up** part of the `taskpack-session` skill. You can hand steps 1 and 4 to the `taskpack-scribe` subagent.

1. Collect what changed in this session (your own tool calls; `taskpack pack <project> --since <session start>`; or `git -C . diff --stat` in the workspace).
2. Record what was agreed but is not written yet: todos, steps, decisions, notes (`taskpack-capture` skill).
3. Update the project Summary (Now / Blocker / Next) if the state changed.
4. Write one session note per changed project: MCP `log_session`, or `taskpack session log <project> --summary "…"`. 2–5 sentences: done, decided and why, next or blocked. The change list is derived automatically.
5. Tell the user in 2–3 lines what was recorded and what comes next.

Write in the workspace language (`taskpack.yaml: lang`). If nothing changed and nothing was agreed, say so and do not write an empty session note.
