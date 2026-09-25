# Correct edits, by example

Each example shows the CLI call, the MCP call and the equivalent hand edit. Prefer the first two.

## Add a todo

```sh
taskpack --actor claude-code todo add premiera-proof "Sprawdzić przywracanie na drugim telefonie"
```

MCP: `add_todo {"project": "premiera-proof", "text": "Sprawdzić przywracanie na drugim telefonie"}`

By hand, in `projects/premiera-proof/todos.md`, after the last open item:

```diff
 - [ ] Przejrzeć polskie tłumaczenie <!-- id:td_w4pa by:user at:2026-09-18 -->
+- [ ] Sprawdzić przywracanie na drugim telefonie <!-- by:claude-code at:2026-09-24 -->
 - [x] Opłacić Apple Developer Program <!-- id:td_w5de by:user at:2026-09-08 done:2026-09-12 -->
```

## Tick a todo or a step

```sh
taskpack --actor claude-code todo done td_w1gl
taskpack --actor claude-code task update premiera-proof/zakup-w-aplikacji --check st_d2pw   # or --check 2
```

By hand: change `[ ]` to `[x]` and add `done:<date>` inside the existing comment. Do not touch other text on the line.

```diff
-- [ ] Przywracanie zakupów <!-- id:st_d2pw -->
+- [x] Przywracanie zakupów <!-- id:st_d2pw done:2026-09-24 -->
```

## Change a task status

```sh
taskpack --actor claude-code task update premiera-proof/zakup-w-aplikacji --status waiting
```

By hand: change only the `status:` line of the frontmatter. For `done` also add `done_at: <timestamp>`.

## Record a decision or a note

```sh
taskpack --actor claude-code task update premiera-proof/zakup-w-aplikacji --decision "Paywall dopiero po trzecim wypieku."
```

By hand: append a bullet at the end of `## Decyzje` (`## Decisions`); create the section after Notes if it is missing.

```markdown
## Decyzje

- Jednorazowy zakup za 12,99 €, bez subskrypcji. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
- Paywall dopiero po trzecim wypieku. <!-- by:claude-code at:2026-09-24 -->
```

## Create a task

```sh
taskpack --actor claude-code task create premiera-proof "Zgłoszenie do recenzji" -w 3 --due 2026-10-05 -s "Archiwum w Xcode" -s "Notatki dla recenzenta"
```

By hand: a new file `projects/premiera-proof/tasks/zgloszenie-do-recenzji.md` (slug: lowercase ASCII, `-` between words):

```markdown
---
title: Zgłoszenie do recenzji
status: todo
weight: 3
due: 2026-10-05
created: 2026-09-24
created_by: claude-code
---

## Kroki

- [ ] Archiwum w Xcode <!-- by:claude-code at:2026-09-24 -->
- [ ] Notatki dla recenzenta <!-- by:claude-code at:2026-09-24 -->
```

## Update the summary

```sh
taskpack --actor claude-code summary set premiera-proof --now "Teksty na paywallu" --blocker "" --next "Ekrany powitalne"
```

`""` removes a line; omitted parts stay as they are.

## Ask the user

```sh
taskpack --actor claude-code question ask premiera-proof "Paywall po trzecim czy po piątym wypieku?" -o "Po trzecim" -o "Po piątym"
```

The answer comes back in a later pack under "answers to your questions".

## Mistakes the validator rejects

- `status: W toku` (statuses are English keys) → `status: in_progress`.
- `weight: 7` → 1–5.
- A stray line inside a checklist (`todos.md`, `## Kroki`): every line must be a `- [ ]` / `- [x]` item, a comment or an indented continuation.
- `color: #C2410C` without quotes (YAML comment) → `color: "#C2410C"`.
- A session file whose `agent:` differs from the actor in its file name.
- More than 5 `pinned: true` images in `images.yaml`.
