---
name: taskpack-workspace
description: Taskpack workspace file format, statuses and the 1–5 weight rubric. Use to read or edit Taskpack files, taskpack:// refs, projekt, task, todo, waga, status.
when_to_use: Any change to projects/*/project.md, todos.md, tasks/*.md, sessions/, notes/, images.yaml, inbox.md or questions.md; questions like "jak zapisać task", "what status", "jaka waga", "format pliku", "taskpack://witrynka".
---

# Taskpack workspace format

A Taskpack workspace is a folder of Markdown/YAML files: the user's projects. The files are the source of truth. Full contract: [reference/format.md](reference/format.md). Worked edits: [reference/examples.md](reference/examples.md).

Write content in the workspace language (`taskpack.yaml: lang`, `pl` or `en`). Keys, statuses and categories are always English; section headings are in the workspace language.

## Where things live

| Thing | File | Id / ref |
|---|---|---|
| Project | `projects/<slug>/project.md` (frontmatter + description + `## Summary`/`## Podsumowanie`) | `taskpack://<slug>` |
| Todo | `projects/<slug>/todos.md` checklist, or `inbox.md` | `td_…` in the line comment |
| Task | `projects/<slug>/tasks/<task>.md` | `taskpack://<slug>/<task>` |
| Step | `## Steps` / `## Kroki` checklist inside a task | `st_…` |
| Session note | `projects/<slug>/sessions/YYYY-MM-DD-<actor>[-n].md` | `sessions/…` |
| Note | `projects/<slug>/notes/YYYY-MM-DD-<slug>.md` | |
| Image | `projects/<slug>/images/<file>` + entry in `images/images.yaml` | file name |
| Question to the user | `questions.md`, one `##` per question | `q_…` |

Never edit `.taskpack/` (derived) and never delete files.

## Prefer the tools

If the `taskpack` MCP server is connected, use its tools (`add_todo`, `update_task`, `set_summary`, …). If you have a shell, use the `taskpack` CLI (see AGENTS.md for the exact command). Both validate, keep formatting, add ids and record the actor. Edit files by hand only when neither is available, and then:

1. change only the lines you mean to change (one checkbox, one frontmatter field);
2. keep the `---` frontmatter and every `<!-- … -->` metadata comment;
3. add `<!-- by:<actor> at:<date or timestamp> -->` to items you create;
4. run `taskpack validate <file>` afterwards if you can (in Claude Code a hook does it for you).

## Line formats

```markdown
- [ ] Open todo or step <!-- id:td_w1gl by:claude at:2026-09-22T21:32:00+02:00 -->
- [x] Done todo <!-- id:td_w6dl by:user at:2026-09-15 done:2026-09-20 -->
- A note or decision bullet <!-- by:claude-code at:2026-09-24 -->
```

Ids are optional: never invent an `id:` when writing by hand. An item without one has an implicit id right away (shown in the pack, accepted by tools); Taskpack stores it the next time it writes the file. Changing the text of such an item before that changes its id. Actors: `user claude-code claude chatgpt codex cursor other`.

## Task frontmatter

```yaml
title: Drzwiczki — wpust pod szybę   # required
status: in_progress                  # inbox | todo | in_progress | waiting | done | canceled
weight: 4                            # 1–5
due: 2026-09-28                      # optional date
estimate: "~4 h"                     # optional
blocked_note: blokuje montaż         # optional: what it blocks / waits for
```

Sections (all optional, headings in the workspace language): Description/Opis, Steps/Kroki, Notes/Notatki, Decisions/Decyzje. The first unticked step is the task's next step.

## Statuses

| Status | Use when |
|---|---|
| `inbox` | captured, not triaged yet (default for new tasks) |
| `todo` | decided to do, not started |
| `in_progress` | being worked on now (keep this short: 1–3 per project) |
| `waiting` | blocked on someone or something; say what in `blocked_note` |
| `done` | finished (set `done_at`; the CLI/MCP does it) |
| `canceled` | dropped; hidden and excluded from progress. Use instead of deleting |

## Weight rubric (impact × urgency)

| Weight | Meaning |
|---|---|
| 5 | Blocks other work or has a hard deadline this week |
| 4 | Important and soon; blocks a milestone |
| 3 | Important, not urgent (or urgent, low impact). Default |
| 2 | Nice to do soon |
| 1 | Someday / low stakes |

Todo vs task: a todo is one quick action (buy, call, send). A task has several steps, a status or a deadline worth tracking.

## Summary section of project.md

```markdown
## Podsumowanie
<!-- by:claude at:2026-09-22T21:40:00+02:00 -->

One or two sentences on where the project stands.

- **Teraz:** what is being worked on now
- **Bloker:** what blocks progress (omit if nothing)
- **Potem:** what comes next
```

English workspaces use `## Summary` with `Now`, `Blocker`, `Next`.
