---
name: taskpack-capture
description: Turn a conversation into Taskpack todos and tasks with weight, due date and steps, without duplicates. Use for dopisz, zapisz, add todo, remember this, zanotuj.
when_to_use: 'The user lists things to do, agrees on a plan, says "dopisz do listy", "zapisz to", "remember to", "add a task", "rozpisz na kroki", or the conversation produced decisions worth keeping in a taskpack:// project.'
---

# Capture: conversation → Taskpack items

Write items in the workspace language (`taskpack.yaml: lang`). Use the MCP tools or the CLI; hand edits only as a fallback (see `taskpack-workspace`).

## 1. Decide what each thing is

| It is… | Record as | Tool / command |
|---|---|---|
| one quick action (buy, call, send, check) | todo | `add_todo` / `taskpack todo add` |
| work with several steps, a deadline or a status worth tracking | task | `create_task` / `taskpack task create` |
| a sub-action of an existing task | step | `update_task add_steps` / `--add-step` |
| a choice that was made, with its reason | decision | `update_task decision` / `--decision` |
| an observation, measurement, link | note | `update_task note` / `--note` |
| something only the user can decide | question | `ask_user` / `taskpack question ask` |
| not tied to any project | inbox todo | project `inbox` |
| a whole new project the user asked for | project | `create_project` / `taskpack project create` (check `list_projects` first) |

Do not record chit-chat, things already done in this conversation that have no follow-up, or your own intermediate reasoning.

## 2. Deduplicate before writing

1. Load the pack if you have not (`get_project`), and read open todos, open tasks and their steps.
2. For each candidate, look for the same intent in other words ("zgłosić build do TestFlight" = "wysłać wersję testerom"). If you are not sure, `search` / `taskpack search <word>`.
3. Same intent already there → do not add. If the new information refines it (quantity, size, date), add a note or a step to the existing task instead, or tell the user.
4. Several todos in one project → one `add_todo` with `items` (max 20).

## 3. Write good items

- Start with a verb, be specific: "Wysłać build 1.0 (14) do zewnętrznej grupy w TestFlight", not "TestFlight".
- Keep numbers, sizes, names and links the user gave.
- One action per todo.
- Task title: the outcome ("Paywall — jednorazowy zakup"); steps: concrete actions in order, 2–8 of them.

## 4. Weight, status, due

- Weight 1–5 = impact × urgency (rubric in `taskpack-workspace`). When unsure use 3 and say so.
- New tasks: `inbox` if the user only mentioned them; `todo` if they decided to do them; `in_progress` only if work starts now.
- Set `due` only for real deadlines the user stated or agreed to. Do not invent dates.
- `estimate` only when the user gave one or asked for one.

## 5. Report

After writing, list in one short block what you added (with ids) and what you skipped as duplicates, so the user can correct it.
