# Correct edits, by example

Each example shows the CLI call, the MCP call and the equivalent hand edit. Prefer the first two.

## Add a todo

```sh
taskpack --actor claude-code todo add witrynka "Kupić kołki 8 mm"
```

MCP: `add_todo {"project": "witrynka", "text": "Kupić kołki 8 mm"}`

By hand, in `projects/witrynka/todos.md`, after the last open item:

```diff
 - [ ] Papier ścierny 180 / 240 <!-- id:td_w4pa by:user at:2026-09-18 -->
+- [ ] Kupić kołki 8 mm <!-- by:claude-code at:2026-09-24 -->
 - [x] Odebrać deski dębowe z tartaku <!-- id:td_w5de by:user at:2026-09-08 done:2026-09-12 -->
```

## Tick a todo or a step

```sh
taskpack --actor claude-code todo done td_w1gl
taskpack --actor claude-code task update witrynka/drzwiczki --check st_d2pw   # or --check 2
```

By hand: change `[ ]` to `[x]` and add `done:<date>` inside the existing comment. Do not touch other text on the line.

```diff
-- [ ] Wyfrezować wpust — prawe drzwiczki <!-- id:st_d2pw -->
+- [x] Wyfrezować wpust — prawe drzwiczki <!-- id:st_d2pw done:2026-09-24 -->
```

## Change a task status

```sh
taskpack --actor claude-code task update witrynka/drzwiczki --status waiting
```

By hand: change only the `status:` line of the frontmatter. For `done` also add `done_at: <timestamp>`.

## Record a decision or a note

```sh
taskpack --actor claude-code task update witrynka/drzwiczki --decision "Listwy na kołeczkach, bez silikonu."
```

By hand: append a bullet at the end of `## Decyzje` (`## Decisions`); create the section after Notes if it is missing.

```markdown
## Decyzje

- Szkło hartowane 4 mm, nie 3 mm. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
- Listwy na kołeczkach, bez silikonu. <!-- by:claude-code at:2026-09-24 -->
```

## Create a task

```sh
taskpack --actor claude-code task create witrynka "Montaż zawiasów" -w 3 --due 2026-10-05 -s "Wybrać zawiasy" -s "Nawiercić puszki 35 mm"
```

By hand: a new file `projects/witrynka/tasks/montaz-zawiasow.md` (slug: lowercase ASCII, `-` between words):

```markdown
---
title: Montaż zawiasów
status: todo
weight: 3
due: 2026-10-05
created: 2026-09-24
created_by: claude-code
---

## Kroki

- [ ] Wybrać zawiasy <!-- by:claude-code at:2026-09-24 -->
- [ ] Nawiercić puszki 35 mm <!-- by:claude-code at:2026-09-24 -->
```

## Update the summary

```sh
taskpack --actor claude-code summary set witrynka --now "Prawe drzwiczki: wpust" --blocker "" --next "Listwy przytrzymujące"
```

`""` removes a line; omitted parts stay as they are.

## Ask the user

```sh
taskpack --actor claude-code question ask witrynka "Olej czy wosk na blat?" -o Olej -o Wosk
```

The answer comes back in a later pack under "answers to your questions".

## Mistakes the validator rejects

- `status: W toku` (statuses are English keys) → `status: in_progress`.
- `weight: 7` → 1–5.
- A stray line inside a checklist (`todos.md`, `## Kroki`): every line must be a `- [ ]` / `- [x]` item, a comment or an indented continuation.
- `color: #C2410C` without quotes (YAML comment) → `color: "#C2410C"`.
- A session file whose `agent:` differs from the actor in its file name.
- More than 5 `pinned: true` images in `images.yaml`.
