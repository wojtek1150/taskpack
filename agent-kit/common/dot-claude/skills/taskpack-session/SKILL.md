---
name: taskpack-session
description: Start and wrap-up ritual for a Taskpack working session. Use when starting work on a taskpack:// project, or to wrap up, podsumuj sesję, zakończ, notatka sesji.
when_to_use: 'Start: "pracujemy nad taskpack://x", "let''s work on the app launch", "zacznijmy", "co dalej w projekcie". End: "wrap up", "podsumuj sesję", "kończymy", "that''s it for today", "zapisz sesję", or before the conversation ends after project files changed.'
---

# Taskpack session ritual

A session is one stretch of work with the user on one project. Every session starts from the project's context and ends with a session note, so the next agent (or the next you) can pick up where this one stopped.

Write everything in the workspace language (`taskpack.yaml: lang`).

## Start

1. **Load the context pack**, nothing else first:
   - MCP: `get_project {"project": "<slug>"}` (a task: `get_task`);
   - CLI: `taskpack pack <slug>` (see AGENTS.md for the exact command);
   - files only: read `project.md`, `todos.md`, open tasks and the newest file in `sessions/`.
   For a large project in Claude Code, delegate the reading to the `taskpack-librarian` subagent and work from its brief.
2. **Summarize in 3–5 lines**: where the project stands (Summary: Now / Blocker / Next), what is overdue or blocked, what the last session left open.
3. **Surface answers and questions**: answers the user gave to earlier agent questions ("answers to your questions") must be acted on now; mention open questions still waiting for the user.
4. **Propose one next step**, usually the next step of the highest-weight `in_progress` task, and ask whether to go ahead. Do not start a large change without the user's go-ahead.

Remember when the session started; use `get_project` with `since` (or `taskpack pack <slug> --since <timestamp>`) later in a long conversation instead of loading the full pack again.

## During the session

- Record outcomes as they happen, not only at the end: new todos, ticked steps, decisions, notes (see the `taskpack-capture` skill for turning talk into items).
- One write per fact; do not re-add what the pack already lists.

## Wrap-up

Do this when the user says so, when the work is done, or before the conversation ends if you changed project files. In Claude Code, `/taskpack-wrap` runs it, and the `taskpack-scribe` subagent can do steps 1 and 4 for you.

1. **Collect what changed** in this session: your tool calls, or `taskpack pack <slug> --since <session start>` (the activity log).
2. **Capture what is missing**: todos, steps, decisions and notes that were agreed but not written yet.
3. **Update the Summary** when the state changed (`set_summary` / `taskpack summary set <slug> --now … --blocker … --next …`). Now = what is being worked on; Blocker = what stops progress (empty it when resolved); Next = the next milestone.
4. **Write the session note** once per project changed:
   - MCP `log_session {"project": "<slug>", "summary": "…"}`, CLI `taskpack session log <slug> --summary "…"`;
   - the change list is derived from the activity log; add `changes` only for what the log cannot know ("zadzwoniono do sklepu w sprawie stelaża");
   - by hand only when there is no CLI/MCP: `projects/<slug>/sessions/YYYY-MM-DD-<actor>.md` (see the format reference).
5. **Tell the user** in 2–3 lines what was recorded and what the next step is.

## A good session summary

2–5 sentences: what was done, what was decided and why, what is next or blocked. No lists of every edit (the change chips cover that), no greetings.

> Przywracanie zakupów działa na dwóch telefonach z kontem testowym. Zdecydowaliśmy, że paywall pojawia się dopiero po trzecim wypieku, żeby nie straszyć przy pierwszym uruchomieniu. Następny krok: teksty na paywallu; zgłoszenie wciąż czeka na umowę Paid Apps.
