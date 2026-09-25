# Taskpack workspace format

> Format version **1** · status: v1 · authoritative contract for the app, the CLI, the MCP server and agents editing files directly.
> Machine-readable counterpart: Zod schemas in [`packages/core/src/format/`](../packages/core/src/format/). Where this document and the schemas disagree, fix one of them. Worked examples: [`examples/workspace-pl`](../examples/workspace-pl) and [`examples/workspace-en`](../examples/workspace-en).

A Taskpack workspace is a folder of plain Markdown and YAML files. The files are the source of truth; everything in `.taskpack/` is derived and can be deleted at any time.

## 1. General rules

1. **Encoding:** UTF-8, LF line endings, a trailing newline.
2. **Keys and enum values are always English** (`status: in_progress`, `category: drawing`, `by:claude`), whatever the workspace language.
3. **Section headings are in the workspace language** (`taskpack.yaml: lang`). The parser accepts any alias from the table in §3, case-insensitively, so a mixed PL/EN workspace is valid. Taskpack itself writes the first alias of the workspace language.
4. **YAML is parsed as YAML 1.2 (core schema).** Dates stay strings: `due: 2026-09-28` is the string `"2026-09-28"`. Colours must be quoted (`color: "#C2410C"`), otherwise `#` starts a comment.
5. **Dates:** `YYYY-MM-DD`. **Timestamps:** ISO 8601 with offset, e.g. `2026-09-22T21:40:00+02:00` (a timestamp without offset is read as local time). Fields that accept "date or timestamp" say so below.
6. **Unknown keys** in frontmatter/YAML and **unknown sections** produce a *warning*, not an error. Invalid values of known keys are *errors*.
7. **Never delete files** in `projects/`. Cancel tasks with `status: canceled`; unpin images instead of removing them.
8. **Edit in place.** Change one checkbox or one frontmatter field at a time; do not reflow or rewrite the rest of the file. Taskpack round-trips files without touching unchanged bytes.

### 1.1 Slugs

Project folders and task files are named by a **slug**, which is also their id (`taskpack://witrynka/drzwiczki`).

- Pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters.
- Derived from the name: lowercase, Polish diacritics transliterated (`ą→a ć→c ę→e ł→l ń→n ó→o ś→s ź→z ż→z`, other accents stripped, `×→x`), every other run of characters becomes one `-`.
  `Drzwiczki — wpust pod szybę` → `drzwiczki-wpust-pod-szybe`. Short slugs are fine (`drzwiczki`).
- Renaming a project or task does not require renaming the file; the title lives in frontmatter.

### 1.2 Actors

Who created or changed something. Used in `by:` metadata, `created_by`, `author`, `agent` and client definitions.

| Value | Meaning |
|---|---|
| `user` | The human, via UI, editor or CLI |
| `claude-code` | Claude Code (terminal / IDE) |
| `claude` | Claude Desktop or claude.ai |
| `chatgpt` | ChatGPT (desktop, web) |
| `codex` | OpenAI Codex |
| `cursor` | Cursor |
| `other` | Any other agent or tool |

### 1.3 Item ids and metadata comments

Todos, steps, notes, decisions and questions carry metadata in a trailing HTML comment, invisible in rendered Markdown:

```markdown
- [ ] Zamówić szkło hartowane 4 mm <!-- id:td_w1gl by:claude at:2026-09-22T21:32:00+02:00 -->
```

- Format: `<!-- key:value key:value -->` at the end of the line; values contain no spaces.
- Keys: `id`, `by` (actor), `at` (date or timestamp, when created), `done` (date or timestamp, when ticked). Questions add `project`, `task`, `status` (§4.3).
- **Ids are optional.** An item without an `id:` is valid and still has an id: its **implicit id**, derived from the file it is in, its text and how many id-less items with the same text come before it in that list (e.g. `td_k3m9x2`). Context packs show it, and the CLI and MCP tools accept it like any other id, so nothing has to rewrite the file after a hand edit. The next time Taskpack writes that file for any reason, it stores exactly that id in the item's comment; from then on the id no longer depends on the text.
  - Until then, changing the text of an id-less item (or moving it to another file) gives it a new implicit id; an agent holding the old one gets "not found" and should reload the pack.
  - Format: 1–3 letter prefix + `_` + 3–24 chars of `[a-z0-9]`. Prefixes: `td_` todo, `st_` step, `q_` question. Ids Taskpack creates for new items are random (`td_w1gl`); implicit ids have 6 characters.
- Agents writing files directly should add at least `by:` and `at:` so the change is attributed; they should not invent `id:` values.

### 1.4 Weight

Tasks have `weight` 1–5 = **impact × urgency**, rounded to the scale:

| Weight | Meaning | Example |
|---|---|---|
| 5 | Blocks other work or has a hard deadline this week | Carcass glue-up everything else depends on |
| 4 | Important and soon; blocks a milestone | Door rebate — blocks assembly |
| 3 | Important, not urgent (or urgent, low impact) | Compare insurance offers before the renewal |
| 2 | Nice to do soon | Book a car inspection |
| 1 | Someday / low stakes | Pick a code highlighting theme |

The board sorts each column by weight, descending, unless the user reordered cards (`order`).

## 2. Workspace layout

Default location `~/Taskpack`; override with the `TASKPACK_HOME` environment variable or `--home`.

```
~/Taskpack/
├─ taskpack.yaml                     settings (§4.1)                         required
├─ inbox.md                        todos without a project (§4.2)          optional
├─ questions.md                    agent → user questions (§4.3)           optional
├─ AGENTS.md  CLAUDE.md            agent instructions (agent kit, `taskpack init` / `taskpack kit update`)
├─ .claude/  .mcp.json             agent kit: skills, subagents, hooks + MCP config (generated)
├─ projects/
│  └─ <project-slug>/
│     ├─ project.md                project metadata + summary (§5.1)       required
│     ├─ todos.md                  quick checklist (§5.2)                  optional
│     ├─ tasks/<task-slug>.md      tasks (§5.3)
│     ├─ sessions/YYYY-MM-DD-<actor>[-n].md   agent session notes (§5.4)
│     ├─ notes/YYYY-MM-DD-<slug>.md           free-form notes (§5.5)
│     └─ images/
│        ├─ images.yaml            image metadata (§5.6)                   required if images/ has files
│        └─ *.png|jpg|webp|svg|pdf …
└─ .taskpack/                        DERIVED, never edit, safe to delete (§6)
```

## 3. Heading and label aliases

Canonical key → accepted text (case-insensitive, trailing `:` ignored). Source: `packages/core/src/format/i18n.ts`.

| Key | EN | PL | Used in |
|---|---|---|---|
| `summary` | Summary | Podsumowanie | `project.md` `##` |
| `now` | Now | Teraz | summary label |
| `blocker` | Blocker, Blocked by | Bloker, Blokuje | summary label |
| `next` | Next | Potem, Dalej, Następnie | summary label |
| `description` | Description | Opis | task `##` |
| `steps` | Steps | Kroki | task `##` |
| `notes` | Notes | Notatki | task `##` |
| `decisions` | Decisions | Decyzje | task `##` |
| `todo` | Todo, To-do, Todos | Todo, Do zrobienia | `todos.md` `#` title |
| `inbox` | Inbox | Inbox, Skrzynka | `inbox.md` `#` title |
| `questions` | Questions | Pytania | `questions.md` `#` title |
| `options` | Options | Opcje | question `###` |
| `answer` | Answer | Odpowiedź | question `###` |

## 4. Workspace-level files

### 4.1 `taskpack.yaml`

```yaml
version: 1                 # format version, required
lang: pl                   # pl | en, required: language of headings, summaries, agent output
git:
  autocommit: session      # session (default: one commit per agent session) | off
pack:                      # context pack budget (get_project / taskpack pack)
  max_tokens: 2500
  max_open_todos: 15
  max_images: 5            # 0–5
  max_image_kb: 700
  session_chars: 400
tools:                     # MCP tools enabled globally; missing = enabled
  set_summary: true
  attach_image: true
clients:                   # known agent clients (replaces the v2 Connection table)
  - name: Claude Code      # display label, e.g. "Session · Claude Code"
    actor: claude-code     # actor value used for attribution
    via: mcp               # mcp | cli | files | ui
    tools:                 # per-client overrides of `tools`
      set_summary: false
```

Tool names: `list_projects get_project get_task get_images search add_todo create_task create_project update_task set_summary log_session attach_image ask_user toggle_todo`.

### 4.2 `inbox.md`

Optional `# Inbox` title, then a GFM checklist in the same format as `todos.md` (§5.2). Every non-blank line must be a checklist item, an HTML comment or an indented continuation line.

### 4.3 `questions.md`

Questions an agent asks the user (MCP `ask_user`), shown in the UI focus strip. Optional `# Questions` title, then one `##` section per question; the heading **is** the question.

```markdown
## Send a reminder about the headphones refund?
<!-- id:q_7h2k by:claude at:2026-09-23T09:15:00+02:00 project:finances task:headphones-refund status:open -->

Context paragraph for the user.

### Options
- Yes, send it
- I will reply myself

### Answer
```

- Metadata comment (required): `by` and `at` required; `id`, `project` (slug), `task` (slug), `status` optional.
- `status`: `open` (waiting for the user) → `answered` (user wrote an answer) → `delivered` (the agent received it). An `answered`/`delivered` question must have a non-empty Answer.
- `### Options` (≤ 4 bullets) and `### Answer` are optional.

## 5. Project files

### 5.1 `projects/<slug>/project.md`

```markdown
---
name: Witrynka               # required, ≤ 200 chars
kind: physical               # required: physical | digital | life
kind_label: stolarka         # free label shown next to kind, ≤ 40
color: "#C2410C"             # accent, #RRGGBB
cover_color: "#7C2D12"       # card cover background
monogram: "</>"              # ≤ 4 chars on the card cover
target: 2026-10-31           # target date
target_label: koniec października
progress_mode: auto          # auto (default, computed from tasks) | manual
progress: 45                 # 0–100, required when progress_mode: manual
archived: false
order: 1                     # sidebar/list order: number or fractional-index string
created: 2026-09-01          # date or timestamp
---
Description: one or two paragraphs before the first `##` heading.

## Podsumowanie
<!-- by:claude at:2026-09-22T21:40:00+02:00 -->

Free-form summary paragraph(s): where the project stands.

- **Teraz:** what is being worked on now
- **Bloker:** what blocks progress (omit if nothing)
- **Potem:** what comes next
```

- The Summary section is optional. Its metadata comment records who updated it last and when.
- **Creating a project** (UI "New project", `taskpack project create`, MCP `create_project`): Taskpack writes `projects/<slug>/project.md` with `name`, `kind`, the optional `kind_label`, `color` (upper case), `target`, `target_label`, then `order` (highest numeric `order` of the other projects + 1, only when they are numbered) and `created`, followed by the description. The slug comes from the name (§1.1), with `-2`, `-3`… when taken; `inbox` is reserved. `todos.md` and the other files appear when something is first written to them.
- **Editing** (`taskpack project update`, the project page) changes one frontmatter line per field (an optional field set to nothing is removed) and replaces the description, i.e. the text before the first `##`. **Archiving** sets `archived: true`; restoring removes the line. Archived projects are hidden from the board, the sidebar, `list_projects` and `taskpack status`; their files stay.
- Labels are bullet lines `- **<label>:** text`; each of Now / Blocker / Next is optional. Other labels are warnings.
- The folder name is the project slug. Auto progress = Σ(weight × steps done / steps) / Σ weight over tasks that are not `canceled`; a `done` task counts as 1.

### 5.2 `projects/<slug>/todos.md`

Quick items without status or weight (tasks are the bigger things). Optional `# Todo` title, then a checklist:

```markdown
# Todo

- [ ] Zamówić szkło hartowane 4 mm — 2 szt. 62 × 46 cm <!-- id:td_w1gl by:claude at:2026-09-22T21:32:00+02:00 -->
- [x] Naostrzyć dłuta <!-- id:td_w6dl by:user at:2026-09-15 done:2026-09-20 -->
- [ ] Item without metadata is fine
```

`- [ ]` open, `- [x]` done (`*` bullets and `[X]` accepted). File order is display order.

### 5.3 `projects/<slug>/tasks/<task-slug>.md`

```markdown
---
title: Drzwiczki — wpust pod szybę   # required, ≤ 200
status: in_progress                  # inbox (default) | todo | in_progress | waiting | done | canceled
weight: 4                            # 1–5, default 3 (§1.4)
due: 2026-09-28                      # date
estimate: "~4 h"                     # free text, ≤ 40
order: 1                             # board order within the column: number or fractional-index string
blocked_note: blokuje montaż         # what it blocks / waits for, shown next to the status
created: 2026-09-14                  # date or timestamp
created_by: user                     # actor
done_at: 2026-09-19                  # date or timestamp, set when status becomes done
---

## Opis

What and why. (Text before the first `##` is also read as the description.)

## Kroki

- [x] Wyfrezować wpust — lewe drzwiczki <!-- id:st_d1lw done:2026-09-21 -->
- [ ] Wyfrezować wpust — prawe drzwiczki <!-- id:st_d2pw -->

## Notatki

- Observation or context. <!-- by:user at:2026-09-22 -->

## Decyzje

- Szkło hartowane 4 mm, nie 3 mm. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
```

- All sections are optional; order is free. The first unticked step is the task's **next step**.
- Steps follow the checklist rules of §5.2. Notes and Decisions are bullet lists; a line that does not start with `-` continues the previous bullet.
- Board columns: `inbox`, `todo`, `in_progress`, `waiting`. `done` is hidden (counted in "done this week"), `canceled` is hidden and excluded from progress.
- Tasks do not list their images. Attach an image to a task in `images/images.yaml` (`tasks: [<task-slug>]`, §5.6); a task's images are the entries that name it, in `order`.

### 5.4 `projects/<slug>/sessions/YYYY-MM-DD-<actor>[-n].md`

One file per agent working session, written at the end of the session (`log_session`, `/taskpack-wrap`). Add `-2`, `-3`… for more sessions of the same agent on the same day.

```markdown
---
agent: claude                              # actor, must match the file name
started: 2026-09-22T20:55:00+02:00         # timestamp, date must match the file name
ended: 2026-09-22T21:40:00+02:00           # timestamp
via: mcp                                   # mcp | cli | files | ui
changes:                                   # short change list shown as chips
  - +2 todo
  - "przypięto: Wymiary"
  - podsumowanie zaktualizowane
---

Session summary in the workspace language (required, non-empty; the context pack trims it to `pack.session_chars`).
```

- `undone` (timestamp, optional): set by Taskpack when the session was undone (§6.1). The note stays as a record; its changes are reverted.

### 5.5 `projects/<slug>/notes/YYYY-MM-DD-<slug>.md`

```markdown
---
title: Sęk na lewym boku     # optional
author: user                 # required actor
created: 2026-09-20          # required, date or timestamp
task: korpus                 # optional task slug the note belongs to
---

Note body (required, non-empty).
```

### 5.6 `projects/<slug>/images/images.yaml`

```yaml
images:
  - file: render-front.svg        # required, plain file name inside images/, must exist
    title: Render — front         # required, ≤ 200
    category: visualization       # required: visualization | drawing | inspiration | progress | other
    caption: Widok z przodu …     # what an agent should know about the picture, ≤ 1000
    pinned: true                  # "current" image, sent to agents in the context pack
    pinned_order: 1               # optional: position among the pinned images (1 = the big tile)
    order: 1                      # number or fractional-index string
    tasks: [drzwiczki]            # task slugs the image is attached to (the only place this link is stored)
    created_by: claude            # optional actor who added the image (UI: "from Claude")
    created: 2026-09-22T21:40:00+02:00   # optional, when it was added
```

- **At most 5 images may be pinned** (error above 5).
- **Pinned order:** pinned images are shown and sent to agents by `pinned_order`, falling back to a numeric `order` for entries without it (hand-written files), then file order. Taskpack sets `pinned_order` when it pins an image (after the current ones), rewrites it when you reorder the current images, and removes it on unpin. The first pinned image is the big tile in the gallery.
- **Adding images:** Taskpack (UI upload, `taskpack image add`, MCP `attach_image`) copies the file under a slugified, unused name (`Zdjęcie 1.JPG` → `zdjecie-1.jpg`, then `zdjecie-1-2.jpg`), appends an entry with `order` = highest numeric order + 1, `pinned: false` unless asked, `created_by` and `created`, and never rewrites other entries. Accepted types, detected from the content: JPEG, PNG, WebP, GIF, SVG, HEIC, PDF; at most 25 MB. Agents writing files directly add the file and the entry the same way.
- Every image file in `images/` should have an entry (warning otherwise); every entry's file must exist (error). No duplicate `file` values.
- `images.yaml` is the single source of truth for images and their task attachments; task files never reference images.
- Agents read images only through `images.yaml` (captions give context without loading the picture).

## 6. `.taskpack/` (derived)

Created and owned by Taskpack; never edit, never commit, safe to delete (`taskpack reindex` rebuilds it):

- `index.sqlite` — search (FTS5) and board cache,
- `thumbs/<sha256>.webp` — gallery thumbnails, longest side 480 px,
- `agent/<sha256>.jpg` — the pictures agents get over MCP: longest side ≤ 1024 px, quality ≈ 78, stepped down (quality, then size) to stay ≤ 150 KB, white background for transparency,
- `activity.jsonl` — activity log with actors.

Image variants are named by the SHA-256 of the original file, so a renamed file keeps them and identical files share them. Both are rotated by the EXIF orientation and carry no metadata (EXIF, GPS and other metadata are dropped); the original in `images/` is never changed. They are made on first use (gallery, MCP, `taskpack image thumbs`) and `taskpack reindex` makes the missing ones. SVGs are rasterized; animated GIFs use the first frame. PDFs and HEIC files that the installed `sharp` cannot decode get a generated placeholder card (`<sha256>.placeholder.*`).

`activity.jsonl` has one JSON object per change made through Taskpack (CLI, MCP, UI):
`{ ts, actor, op, project?, entity?, summary, count?, request_id?, result? }`, e.g.
`{"ts":"2026-09-24T10:12:00+02:00","actor":"claude-code","op":"todo.add","project":"witrynka","entity":"td_k3m9","summary":"+1 todo","count":1}`.
Ops: `project.create`, `project.edit`, `project.archive`, `project.unarchive`, `todo.add`, `todo.done`, `todo.undone`, `task.create`, `task.status`, `task.edit`, `step.add`, `step.check`, `step.uncheck`, `task.note`, `task.decision`, `summary.set`, `question.ask`, `question.answer`, `question.delivered`, `session.log`, `config.lang`, `image.add`, `image.pin`, `image.unpin`, `image.edit`, `image.reorder`, `note.add`, `session.undo`, `file.edit` (a file an agent edited directly, recorded by the Claude Code after-edit hook; a hand-written session note is recorded as `session.log`). `question.delivered` is bookkeeping and never becomes a session change.
It feeds the session change list (writes of one actor in one project less than 2 h apart, since its last `session.log`), `taskpack pack --since` and request-id deduplication (same actor + `request_id` within 24 h returns the stored `result`). Deleting it loses only that history; the workspace files stay complete.

When Taskpack writes a file it changes only the lines of the edit, plus the metadata comment of items in that file that have no id yet, which get their implicit id (§1.3). New todos go after the last open todo; new steps, notes and decisions at the end of their section; a missing section is inserted in the order Description, Steps, Notes, Decisions, with a heading in the workspace language.

### 6.1 Git history and undoing a session

`taskpack init` makes the workspace a git repository (`.taskpack/` is ignored). With `git.autocommit: session` (default), writing a session note commits the whole workspace: `log_session` / `taskpack session log`, and a session note an agent writes by hand in Claude Code (the after-edit hook). The commit's subject is the summary's first line and its trailers say who and what:

```
Wpust gotowy, szkło zamówione.

Taskpack-Actor: claude
Taskpack-Project: witrynka
Taskpack-Session: projects/witrynka/sessions/2026-09-22-claude.md
```

**Undoing a session** (the "Undo" button on a session in the app, `taskpack session undo <note | project>`) finds the commits whose `Taskpack-Session` trailer names the note (for older sessions, the Taskpack autocommit that added the note), reverts them with `git revert --no-commit`, restores the note with `undone: <timestamp>` and commits once more with the trailer `Taskpack-Undo: <note>`. History is never rewritten or reset, so the undo itself can be reverted with git. The undo is refused, with nothing changed, when:

- the workspace is not its own git repository or has no commit for that session (e.g. autocommit off);
- the session was undone already;
- there are uncommitted changes (edits from the app are not committed until the next session): the app, or `--commit-pending`, first commits them as "Manual changes";
- a later change touched the same lines (a revert conflict): the revert is aborted, HEAD and the files are as before, and the message names the files.

A session commit contains everything uncommitted at that moment, so manual edits made during an agent session are undone with it; the confirmation dialog lists every file.

## 7. Validation

`validateWorkspace(dir, { lang? })` in `@taskpack/core` (and `taskpack validate`) checks everything above and returns `{ ok, issues[] }`, where each issue has `file`, optional `line`, `severity` (`error` | `warning`) and `message` in the workspace language (or `lang`). A task file that fails validation is still a known task for references, so its `images.yaml` links and notes are not reported a second time. `ok` is false when there is at least one error. Both example workspaces validate with zero issues (`pnpm test`).

## 8. Worked example

A small, complete Polish workspace. The full versions are in `examples/workspace-pl` and `examples/workspace-en`.

```
~/Taskpack/
├─ taskpack.yaml
├─ inbox.md
├─ questions.md
└─ projects/witrynka/
   ├─ project.md
   ├─ todos.md
   ├─ tasks/drzwiczki.md
   ├─ tasks/korpus.md
   ├─ sessions/2026-09-22-claude.md
   ├─ notes/2026-09-20-sek.md
   └─ images/{images.yaml, wymiary.svg, detal-wpust.svg}
```

`taskpack.yaml`

```yaml
version: 1
lang: pl
git:
  autocommit: session
clients:
  - name: Claude Desktop
    actor: claude
    via: mcp
```

`inbox.md`

```markdown
# Inbox

- [ ] Oddzwonić do hydraulika <!-- id:td_i1hy by:user at:2026-09-23T08:10:00+02:00 -->
- [ ] Kupić baterie AA
```

`questions.md`

```markdown
# Pytania

## Zawiasy nakładane czy wpuszczane?
<!-- id:q_3m9p by:claude at:2026-09-22T21:35:00+02:00 project:witrynka status:delivered -->

Do drzwi w ramie 20 mm pasują oba typy. Nakładane są prostsze w montażu.

### Opcje
- Nakładane
- Wpuszczane

### Odpowiedź

Nakładane, w kolorze mosiądzu.
```

`projects/witrynka/project.md`

```markdown
---
name: Witrynka
kind: physical
kind_label: stolarka
color: "#C2410C"
target: 2026-10-31
target_label: koniec października
---
Dębowa witryna 180 × 80 × 38 cm na nóżkach. Dwoje drzwi przeszklonych, 3 półki z regulacją, wykończenie olejem woskowym.

## Podsumowanie
<!-- by:claude at:2026-09-22T21:40:00+02:00 -->

Korpus sklejony i wyszlifowany. Lewe drzwiczki mają wpust, prawe czekają. Szkło jeszcze niezamówione — to blokuje montaż.

- **Teraz:** Wpust w prawych drzwiczkach, listwy przytrzymujące szybę
- **Bloker:** Szkło 4 mm — wymiar potwierdzony, trzeba zamówić (realizacja ~5 dni)
- **Potem:** Półki, olejowanie, montaż zawiasów
```

`projects/witrynka/todos.md`

```markdown
# Todo

- [ ] Zamówić szkło hartowane 4 mm — 2 szt. 62 × 46 cm <!-- id:td_w1gl by:claude at:2026-09-22T21:32:00+02:00 -->
- [ ] Papier ścierny 180 / 240 <!-- id:td_w4pa by:user at:2026-09-18 -->
- [x] Naostrzyć dłuta <!-- id:td_w6dl by:user at:2026-09-15 done:2026-09-20 -->
```

`projects/witrynka/tasks/drzwiczki.md`

```markdown
---
title: Drzwiczki — wpust pod szybę
status: in_progress
weight: 4
due: 2026-09-28
estimate: "~4 h"
blocked_note: blokuje montaż
created_by: user
---

## Opis

Wpust 6 × 10 mm od wewnętrznej strony ramiaka. Szyba trzymana listwami, bez silikonu.

## Kroki

- [x] Wyfrezować wpust — lewe drzwiczki <!-- id:st_d1lw done:2026-09-21 -->
- [ ] Wyfrezować wpust — prawe drzwiczki <!-- id:st_d2pw -->
- [ ] Listwy przytrzymujące z odpadu dębu <!-- id:st_d3ls -->

## Decyzje

- Szkło hartowane 4 mm, nie 3 mm. <!-- by:claude at:2026-09-22T21:40:00+02:00 -->
```

`projects/witrynka/tasks/korpus.md`

```markdown
---
title: Korpus — klejenie i szlifowanie
status: done
weight: 5
done_at: 2026-09-19
---

## Kroki

- [x] Sklejenie korpusu <!-- id:st_k3kl done:2026-09-17 -->
- [x] Szlif 120 → 180 <!-- id:st_k4sz done:2026-09-19 -->
```

`projects/witrynka/sessions/2026-09-22-claude.md`

```markdown
---
agent: claude
started: 2026-09-22T20:55:00+02:00
ended: 2026-09-22T21:40:00+02:00
via: mcp
changes:
  - +2 todo
  - "przypięto: Wymiary"
  - podsumowanie zaktualizowane
---

Policzyliśmy szybę po odjęciu wpustu: **2 szt. 62 × 46 cm**. Decyzja: hartowane 4 mm zamiast 3 mm.
```

`projects/witrynka/notes/2026-09-20-sek.md`

```markdown
---
author: user
created: 2026-09-20
task: korpus
---

Lewy bok ma sęk na wysokości ~40 cm — obrócić deskę sękiem do tyłu, będzie za półką.
```

`projects/witrynka/images/images.yaml`

```yaml
images:
  - file: wymiary.svg
    title: Wymiary 180 × 80 × 38
    category: drawing
    caption: Wymiary zewnętrzne w cm; podział drzwi w połowie szerokości.
    pinned: true
    order: 1
    tasks: [drzwiczki]
  - file: detal-wpust.svg
    title: "Detal: wpust 6 × 10"
    category: drawing
    caption: Przekrój ramiaka z wpustem 6 × 10 mm od wewnątrz.
    pinned: true
    order: 2
    tasks: [drzwiczki]
```

The same workspace in English uses `## Summary`, `**Now:**`, `## Description`, `## Steps`, `## Decisions`, `### Options`, `### Answer`, with identical keys and enum values.
