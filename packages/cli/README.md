# `taskpack` CLI

Command line for a Taskpack workspace. Every command is a thin wrapper around an operation in [`@taskpack/core`](../core), the same code the MCP server (Phase 2) and the local app (Phase 3) use, so validation, context packs and the activity log behave the same everywhere.

From the repository: `pnpm build`, then `pnpm taskpack <command>` (or `node packages/cli/dist/index.js`). `tpk` is a short alias bin of the same entry (`pnpm tpk <command>`). Relative paths are resolved from the folder you ran the command in (through `pnpm taskpack`, from pnpm's `INIT_CWD`).

## Global options

| Option | Default | Meaning |
|---|---|---|
| `--home <dir>` | `$TASKPACK_HOME`, else the workspace the current folder is in, else `~/Taskpack` | Workspace folder |
| `--actor <actor>` | `$TASKPACK_ACTOR`, else `user` | Who makes the change: `user`, `claude-code`, `claude`, `chatgpt`, `codex`, `cursor`, `other`. Written to `by:` metadata and `.taskpack/activity.jsonl` |
| `--lang <pl\|en>` | workspace language | Language of the output (files keep the workspace language) |
| `--json` | off | Machine-readable output (the operation's result object) |
| `--request-id <id>` | none | Retry-safe writes: the same actor + id within 24 h returns the first result and writes nothing |

Exit codes: `0` success, `1` Taskpack error (not found, invalid input, validation errors), `2` usage error, `3` unexpected error.

## Commands

```sh
taskpack init [--lang pl|en] [--example] [--example-date <YYYY-MM-DD>] [--no-git] [--no-kit]
```
Creates the workspace: `taskpack.yaml`, `inbox.md`, `questions.md`, `projects/`, a `.gitignore` for `.taskpack/`, the [agent kit](../../agent-kit/README.md) (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.mcp.json`), then `git init` and an initial commit. `--example` copies `examples/workspace-<lang>` and moves its dates so the sample looks current: the example is written for 2026-09-25 (`EXAMPLE_TODAY` in `@taskpack/core`), and every date is shifted by the days between that and today, or `--example-date`. Asks for the language when run in a terminal without `--lang` (defaults to `en` otherwise). Refuses a non-empty folder.

```sh
taskpack validate [path]            # whole workspace, or only issues of one file; exit 1 on errors
taskpack status                     # projects with progress and next step, open questions (~300 tokens)
taskpack pack <ref> [--since <iso>] [--max-tokens <n>] [--mark-delivered]
```
`pack` prints the context pack an agent gets for `taskpack://project` or `taskpack://project/task` (`project/task` and `project` work too): summary, open todos (15 max, then "+N more"), open tasks with their next step, recent sessions (trimmed), answers to agent questions and pinned image captions, within `taskpack.yaml: pack.max_tokens` (≈2,500 tokens, estimated as characters / 3.5). `--since` prints only the changes recorded after that time. `pack` is read-only; `--mark-delivered` marks the answers it printed as `delivered` (what MCP `get_project` does), so the next pack does not repeat them. `validate` messages follow `--lang`, else the workspace language.

```sh
taskpack todo add <project> [text…] [-i <more>]…   # `inbox` adds to inbox.md
taskpack todo done <td_id> [--undo]

taskpack task create <project> <title…> [-d <text>] [-w 1-5] [--status <s>] [--due YYYY-MM-DD]
                   [--estimate <text>] [-s <step>]… [--slug <slug>]
taskpack task update <project/task> [--status <s>] [-w 1-5] [--due YYYY-MM-DD|none] [--title <t>]
                   [-d <text>] [--estimate <t>] [--add-step <t>]… [--check <st_id|n>]…
                   [--uncheck <st_id|n>]… [--note <t>] [--decision <t>]

taskpack summary set <project> [--body <t>] [--now <t>] [--blocker <t>] [--next <t>]
```
Omitted summary parts keep their value; `""` removes one. Statuses: `inbox todo in_progress waiting done canceled`. Steps are addressed by id or 1-based position.

```sh
taskpack session log <project> --summary <text> [-c <change>]… [--via mcp|cli|files|ui] [--started <iso>]
```
Writes `projects/<project>/sessions/YYYY-MM-DD-<actor>[-n].md`. The change list is computed from the activity log (this actor's writes in this project, less than 2 h apart, since its previous session note) and `-c` only adds to it. With `git.autocommit: session` the workspace is then committed, with `Taskpack-Actor:` / `Taskpack-Project:` / `Taskpack-Session: <note>` trailers. That only happens when the workspace folder is the root of its own git repository.

```sh
taskpack session undo <ref> [--dry-run] [--commit-pending]
```
Undoes an agent session: `git revert --no-commit` of the commits whose `Taskpack-Session` trailer names the note, then one new commit (`Taskpack-Undo:` trailer) with the note kept and `undone: <timestamp>` set. `<ref>` is `projects/<p>/sessions/<file>.md`, `<p>/sessions/<file>` (also with `taskpack://`) or a project slug (its latest agent session not undone yet). `--dry-run` prints the commits and files and changes nothing. Refuses (exit 1, nothing changed) when the workspace is not a git repository or has no commit for that session, when it was undone already, when there are uncommitted changes (unless `--commit-pending`, which first commits them as "Manual changes"), and on a conflict with later changes (the revert is aborted). Never resets or rewrites history. See [format §6.1](../../agent-kit/common/dot-claude/skills/taskpack-workspace/reference/format.md#61-git-history-and-undoing-a-session).

```sh
taskpack project create <name…> --kind physical|digital|life [--kind-label <t>] [-d <text>] [--color #RRGGBB]
                      [--target YYYY-MM-DD] [--target-label <t>] [--slug <slug>]
taskpack project update <project> [--name <t>] [--kind <k>] [--kind-label <t>] [-d <text>] [--color <hex>]
                      [--target <date>] [--target-label <t>] [--archived | --no-archived]
taskpack project archive <project>
taskpack project unarchive <project>
```
`create` writes `projects/<slug>/project.md` (slug from the name, `-2`… when taken). `update` changes only the given fields; `none` removes an optional one (`--target none`). Archived projects disappear from the board, the sidebar, `status` and MCP `list_projects`; nothing is deleted.

```sh
taskpack question ask <project> <question…> [--task <slug>] [--context <t>] [-o <option>]…
taskpack question answer <q_id> <answer…>

taskpack search <query…> [-p <project>] [-t project|task|todo|note|session|image|question]… [-n <limit>]
taskpack reindex                    # rebuild .taskpack/index.sqlite and make missing image variants
taskpack lang <pl|en>               # set taskpack.yaml: lang
```
Search uses SQLite FTS5 (accent-insensitive including `ł`, prefix matching) over projects, tasks, todos, notes, sessions, image captions and questions (with their answers). The index is built on first search and refreshed after every write.

```sh
taskpack image add <project> <file…> [--title <t>] [--category <c>] [--caption <t>] [--pin] [--task <slug>]…
taskpack image pin <ref>             # taskpack://project/images/<file>, project/images/<file> or project/<file>
taskpack image unpin <ref>
taskpack image list <project> [--all]   # current (pinned) images in pinned order; --all: every image
taskpack image thumbs [project] [--force]
```
`add` copies each file (relative paths are resolved from where you run the command) into `projects/<project>/images/` under a slugified, unused name, appends its `images.yaml` entry with `created_by: <actor>` and prepares the variants. Types are detected from the content: JPEG, PNG, WebP, GIF, SVG, HEIC (when the installed sharp can decode it; otherwise a clear error), PDF (stored with a placeholder preview); 25 MB max. Categories: `visualization drawing inspiration progress other` (default `other`). At most 5 images can be pinned. `thumbs` renders missing thumbnails (`.taskpack/thumbs/<sha256>.webp`, 480 px) and agent variants (`.taskpack/agent/<sha256>.jpg`, ≤ 1024 px, ≤ ~150 KB, no EXIF); `--force` renders all again.

### Agent kit, hooks, MCP clients

```sh
taskpack kit update [--force]       # install/update the agent kit in the workspace (keeps your own text; --force also overwrites kit files you edited)
taskpack kit repair [--yes]         # after moving Taskpack or the workspace: update the kit and rewrite existing Taskpack entries in client configs (agent-kit/GUIDE.md#moving-taskpack-or-your-workspace)
taskpack kit build [-o <dir>]       # zip all kit skills, commands included, for Claude Desktop / claude.ai (default: dist/skills); `pnpm kit:build` builds first
taskpack hook <session-start|prompt|guard|after-edit|stop>   # Claude Code hooks: JSON on stdin (see agent-kit/GUIDE.md)
taskpack mcp config <claude-desktop|cursor|codex> [--write [--yes]]
```
`mcp config` prints the `taskpack-mcp` entry for that client's config file (`<workspace>/.claude/taskpack --mcp`, the workspace shim, which finds Node.js itself, and `TASKPACK_ACTOR`; on Windows `node <workspace>\.claude\taskpack.mjs --mcp`; without the kit: node + the MCP server path + `TASKPACK_HOME`). With `--write` it shows a diff of the merged file, asks for confirmation (or `--yes`), saves a `*.taskpack-backup-*` copy and writes; other servers and settings are kept. Files: Claude Desktop `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json`, Cursor `~/.cursor/mcp.json`, Codex `~/.codex/config.toml`.


Hook exit codes follow Claude Code: `0` (with JSON output where the hook adds context or asks Claude to continue), `2` to block (`guard`) or to report validation errors to Claude (`after-edit`).

## Example

```console
$ taskpack --actor claude-code todo add premiera-proof Sprawdzić przywracanie na drugim telefonie
Dodano todo: 1
  td_2mph  Sprawdzić przywracanie na drugim telefonie
$ taskpack --actor claude-code task update premiera-proof/zakup-w-aplikacji --check 2
Zaktualizowano task: taskpack://premiera-proof/zakup-w-aplikacji (zmiany: steps; postęp 67%)
$ taskpack --actor claude-code session log premiera-proof --summary "Przywracanie zakupów działa, zostały teksty na paywallu."
Zapisano sesję: projects/premiera-proof/sessions/2026-09-25-claude-code.md
  · +1 todo
  · kroki odhaczone: 1
commit: 1592e77
```

Using Taskpack from Claude Code, Claude Desktop, Codex and Cursor: [agent-kit/GUIDE.md](../../agent-kit/GUIDE.md).
