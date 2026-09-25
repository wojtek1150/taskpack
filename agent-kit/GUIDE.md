# Using Taskpack with AI agents

Taskpack keeps your projects as Markdown/YAML files in a workspace folder (`~/Taskpack` by default). Agents reach it in three ways, all backed by the same `@taskpack/core` code (validation, context packs, activity log):

1. **Folder access**: the agent opens the workspace and edits files, guided by `AGENTS.md` / `CLAUDE.md` and the skills (Claude Code, Codex, ChatGPT desktop, Cursor, Claude Desktop with a folder).
2. **Local MCP server** `taskpack-mcp` over stdio: Claude Code, Claude Desktop, Cursor, Codex.
3. **The `taskpack` CLI**: for any agent with a shell, and for the Claude Code hooks.

Polish summary: [below](#po-polsku).

## Setup

```sh
pnpm install && pnpm build
pnpm taskpack init --lang en --example     # workspace + agent kit (AGENTS.md, CLAUDE.md, .claude/, .mcp.json) + git
```

`init` installs the [agent kit](README.md). After pulling a new Taskpack version: `pnpm taskpack kit update`. After moving the Taskpack repository or the workspace: `pnpm taskpack kit repair --home <workspace>` (the workspace's launcher tells you when it is needed; see [agent-kit/README.md](README.md#moving-taskpack-or-the-workspace)).

Everything an agent writes is attributed (`by:claude-code` on todos, `agent:` in session notes). The actor comes from `--actor` / `TASKPACK_ACTOR`, or for MCP from the client's name (`claude-code`, `claude`, `chatgpt`, `codex`, `cursor`, `other`).

## Claude Code

Open Claude Code **in the workspace folder** (`cd ~/Taskpack && claude`). The kit gives it:

- `CLAUDE.md` → `AGENTS.md`: what the workspace is, `taskpack://x` = `projects/x/`, context first, editing rules, write in the workspace language, end with a session note;
- `.mcp.json`: the `taskpack` MCP server (Claude Code asks once to approve a project-scoped server);
- `.claude/settings.json`: `TASKPACK_ACTOR=claude-code` for every command, plus five hooks, each a single `"${CLAUDE_PROJECT_DIR}/.claude/taskpack" hook <name>` call (the workspace shim, which finds Node.js even without it on `PATH`; see [moving](README.md#moving-taskpack-or-the-workspace)):

| Hook | Event (matcher) | What it does |
|---|---|---|
| `session-start` | `SessionStart` | Adds a ≤ 300-token dashboard: projects, progress, next steps, questions waiting for you, and answers you gave that no agent has picked up yet |
| `prompt` | `UserPromptSubmit` | `taskpack://project[/task]` in your message → the context pack is attached (≤ 9,000 chars) |
| `guard` | `PreToolUse` (`Edit\|Write\|MultiEdit\|NotebookEdit\|Bash`) | Exit 2 (blocks) on writes to `.taskpack/`, on `rm`/`git rm`/`find -delete` in `projects/`, and on a `Write` that drops a file's frontmatter |
| `after-edit` | `PostToolUse` (`Edit\|Write\|MultiEdit`) | Validates the edited file; on errors exit 2 with the localized list so Claude fixes them. Otherwise records the edit in the activity log as `claude-code`; a new session note is also committed (autocommit, `Taskpack-Session` trailer) so the session can be undone. The file is not touched: items written without an id already have an implicit one (see [format §1.3](common/dot-claude/skills/taskpack-workspace/reference/format.md#13-item-ids-and-metadata-comments)) |
| `stop` | `Stop` | If project files changed in this session and no session note was written, blocks once (`decision: block`) asking for `/taskpack-wrap`. Respects `stop_hook_active`, and asks only once per batch of changes |

Commands: `/taskpack-start <project>`, `/taskpack-add <project> <todo>`, `/taskpack-status`, `/taskpack-wrap`. Skills load automatically: `taskpack-workspace`, `taskpack-session`, `taskpack-capture`, `taskpack-images`. Subagents: `taskpack-librarian`, `taskpack-scribe`, `taskpack-planner`.

Hooks never rewrite a file Claude just edited, so Claude's view of the file stays current.

Hook contract used (checked 2026-09-24 against the [hooks reference](https://code.claude.com/docs/en/hooks)): JSON on stdin with `session_id`, `cwd`, `hook_event_name` and per-event fields (`prompt`, `tool_name`, `tool_input.file_path` (absolute), `tool_input.command`, `stop_hook_active`); `hookSpecificOutput.additionalContext` with a required `hookEventName`; exit 2 + stderr blocks `PreToolUse` and is shown to Claude after `PostToolUse`; `Stop` blocks with top-level `{"decision":"block","reason":…}`; context strings are capped at 10,000 characters; matchers made of letters and `|` are exact tool names.

## Claude Desktop

**Desktop extension (one click):**

```sh
pnpm kit:mcpb        # builds dist/taskpack.mcpb
```

Double-click `dist/taskpack.mcpb` (or drag it onto Claude Desktop, or Settings → Extensions → Install extension…). Claude Desktop shows the install dialog and asks for the **Taskpack workspace** folder (default `~/Taskpack`). The extension runs the bundled `taskpack-mcp` with `--home <that folder>` and `TASKPACK_ACTOR=claude`, so everything it writes is `by:claude`. Nothing else to configure; remove any manual `taskpack` entry from `claude_desktop_config.json` to avoid two servers.

How it is built (`scripts/build-mcpb.mjs`):

- **Format:** an MCP Bundle, `manifest_version: "0.3"` ([MANIFEST.md](https://github.com/modelcontextprotocol/mcpb/blob/main/MANIFEST.md), repository formerly `anthropics/dxt`, then `anthropics/mcpb`; `.dxt` files were renamed `.mcpb`). The manifest (`packages/cli/src/mcpb.ts`) uses `server.type: "node"`, `entry_point: server/dist/index.js`, `mcp_config` `{ command: "node", args: ["${__dirname}/server/dist/index.js", "--home", "${user_config.workspace}"], env: { TASKPACK_ACTOR: "claude" } }`, a `user_config.workspace` of type `directory` (required, default `${HOME}/Taskpack`), the 14 tools, and `compatibility` `{ platforms: [<build platform>], runtimes: { node: ">=22.0.0" } }`. The host substitutes `${__dirname}`, `${user_config.*}` and `${HOME}` (MANIFEST.md, "Variable substitution").
- **Contents:** the built `@taskpack/mcp` plus its production dependencies copied from the installed tree (pnpm's store is symlinked and `pnpm deploy` leaves out the compiled native modules). `better-sqlite3` 13 ships prebuilt binaries for every platform, but `sharp` installs only the build machine's `@img/sharp-*` binaries, so **the bundle works on the platform and CPU it was built on** (`compatibility.platforms` says so; the CPU cannot be declared). Build it on each platform you want to support. About 19 MB.
- **Validation:** the official CLI, `@anthropic-ai/mcpb` 2.1.2 (a dev dependency, so it works offline after `pnpm install`): `mcpb validate` on the manifest, then `mcpb pack`. The script then starts the bundled server outside the repository and checks it answers `initialize`. A unit test checks the manifest against the package's 0.3 schema. The CLI's schemas go up to 0.4, which only adds the `uv` server type.

**MCP by hand:**

```sh
pnpm taskpack mcp config claude-desktop            # print the snippet
pnpm taskpack mcp config claude-desktop --write    # merge into claude_desktop_config.json (shows a diff, asks, keeps a backup)
```

Config file: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), `%APPDATA%\Claude\claude_desktop_config.json` (Windows) ([source](https://modelcontextprotocol.io/docs/develop/connect-local-servers)). Restart Claude Desktop. Then write “we're working on taskpack://my-project”: the server instructions tell Claude to call `get_project` first. The prompts `start_session` and `wrap_up` are available in the “+” menu.

**Folder access (Cowork):** point Claude Desktop at the workspace folder and ask it to read `AGENTS.md` first. Also upload the skill packages from `pnpm kit:build` (`dist/skills/*.zip`) in Customize → Skills, since `.claude/skills` in a folder may not be read (see below).

## ChatGPT desktop and Codex

- **Folder + `AGENTS.md`** is the main path: open the workspace folder in Codex (CLI, IDE extension or app); Codex reads `AGENTS.md`. The agent then runs the CLI through the workspace shim, `.claude/taskpack …`, with `--actor codex` / `--actor chatgpt`, or edits files by the format.
- **MCP for Codex:** `pnpm taskpack mcp config codex [--write]` adds `[mcp_servers.taskpack]` to `~/.codex/config.toml` ([source](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)).

## Cursor

Open the workspace folder; `AGENTS.md` carries the instructions. MCP: `pnpm taskpack mcp config cursor [--write]` adds the server to `~/.cursor/mcp.json` ([source](https://cursor.com/docs/context/mcp)); for this workspace only, copy the snippet into `.cursor/mcp.json` in the workspace instead.

## Moving Taskpack or your workspace

You can move or rename both folders: the Taskpack repository (the app you cloned) and the workspace (your data, `~/Taskpack` by default). At most one command fixes things afterwards.

### How it is wired

```
Claude Code hooks ─┐
.mcp.json ─────────┤   workspace-relative paths
AGENTS.md (agents) ┘
        │
        ▼
<workspace>/.claude/taskpack       shim (POSIX sh): finds Node.js ≥ 22
        │  $TASKPACK_NODE → node on PATH → `node` in taskpack-kit.json → nvm, volta, fnm, asdf, mise, Homebrew, /usr/local, /usr/bin
        ▼
<workspace>/.claude/taskpack.mjs   launcher: always acts on the workspace it is in
        │  reads `repo` from <workspace>/.claude/taskpack-kit.json (or $TASKPACK_REPO)
        ▼
<repo>/packages/cli/dist/index.js   (or packages/mcp/dist/index.js with --mcp)

Claude Desktop / Cursor / Codex configs ──▶ absolute path of <workspace>/.claude/taskpack --mcp
```

- Nothing inside the workspace stores an absolute path to the workspace itself.
- Absolute paths are stored in three places only:
  - `repo` in `.claude/taskpack-kit.json`: where Taskpack is;
  - `node` in the same file: a fallback Node.js, recorded by `kit update` / `kit repair`;
  - the MCP entries in the Claude Desktop, Cursor and Codex config files: where the workspace is.
- No config file points at a Node.js binary any more. The shim looks for one each time, so a Node upgrade or a switch between nvm versions does not break anything as long as some Node ≥ 22 is installed.

### What to do

| You moved or changed… | What breaks | Fix |
|---|---|---|
| **the workspace** (e.g. `~/Taskpack` → `~/Documents/Taskpack`) | Nothing in Claude Code (it asks once more to approve the project's `taskpack` MCP server, because approvals are per folder) or for folder-based agents. Claude Desktop, Cursor and Codex still start the server from the old path. | `pnpm taskpack kit repair --home ~/Documents/Taskpack` (run in the Taskpack repository). If you use `TASKPACK_HOME`, update it too. |
| **the Taskpack repository** (or deleted it and cloned it again elsewhere) | Every hook, the MCP server and the CLI in the workspace, because `repo` points at the old place. | In the new repository: `pnpm install && pnpm build && pnpm taskpack kit repair --home <workspace>`. |
| **both** | Both of the above. | The same single command, run in the new repository with the new workspace path. |
| **Node.js** (upgrade, reinstall, another version manager) | Nothing while the shim can find some Node ≥ 22 (see the search order above). | Only if it cannot: run `pnpm taskpack kit repair --home <workspace>` from a terminal where `node` works (records that `node`), or set `TASKPACK_NODE`. |

`kit repair` does two things:

1. It runs `kit update`, which records the current repository as `repo`, and the `node` running the command as `node`. It refreshes the kit files and keeps your own text and edited kit files.
2. For each client that already has a Taskpack entry (Claude Desktop, Cursor, Codex), it shows a diff against the current paths, asks, keeps a `*.taskpack-backup-*` copy and writes. `--yes` skips the question.

It never adds Taskpack to a client that did not have it; use `taskpack mcp config <client> --write` for that. Restart Claude Desktop, and reload Cursor or Codex, after a repair.

### How you notice

The shim and the launcher fail with one line that says what to do:

```
taskpack: Taskpack is not at /old/path/personal-todo-board anymore (moved, deleted or not built). In the Taskpack repository run: pnpm build && pnpm taskpack kit repair --home "/Users/you/Taskpack"
taskpack: Node.js 22 or newer not found (tried: /Users/you/.nvm/versions/node/v20.11.0/bin/node …). Install Node 22+, or set TASKPACK_NODE=/path/to/node, or run `pnpm taskpack kit repair` in the Taskpack repository from a terminal where node works.
```

- **Claude Code** shows it as a hook error (`SessionStart hook error … Failed with non-blocking status code: taskpack: …`). Work is not blocked, but the Taskpack hooks are off until you fix it.
- **Agents using the CLI** get the same message; `AGENTS.md` tells them to show it to you and stop.
- **Claude Desktop** shows the Taskpack server as failed. The message is in `~/Library/Logs/Claude/mcp-server-taskpack.log` (macOS) or `%APPDATA%\Claude\logs\mcp-server-taskpack.log`.
- **Cursor and Codex** show the server as failed to start in their MCP settings or logs.

A moved workspace is noticed only by Claude Desktop, Cursor and Codex: their server fails to start because the shim path is gone.

### Overrides

- `TASKPACK_NODE=/path/to/node`: the Node.js the shim uses, before anything else.
- `TASKPACK_NODE_DISCOVERY=0`: do not search the common install locations (only `TASKPACK_NODE`, `PATH` and the recorded `node`).
- `TASKPACK_REPO=/path/to/taskpack`: the repository the launcher uses, instead of `repo` in the manifest. Useful for testing a second checkout.

Set them in your shell for the CLI, in `.claude/settings.json` → `env` for Claude Code hooks, or in the `env` of a client's MCP entry.



### Requirements

- Node.js 22 or newer, somewhere the shim can find it. That covers `node` on `PATH`, the recorded `node`, `TASKPACK_NODE`, and the defaults of nvm, volta, fnm, asdf, mise and Homebrew, plus `/usr/local/bin` and `/usr/bin`. Claude Code or Claude Desktop started from the Dock or Finder, without your shell's `PATH`, still works.
- `/bin/sh` and standard tools (`sed`, `ls`, `sort`), i.e. macOS or Linux. On Windows the shim cannot run: `taskpack mcp config` then writes `node <workspace>\.claude\taskpack.mjs --mcp` (absolute `node`), and agents use `node .claude/taskpack.mjs`. Claude Code hooks on Windows are not supported yet.
- The repository must be built (`pnpm build`), because the launcher runs `packages/*/dist`.

## MCP server reference

`taskpack-mcp [--home <dir>] [--actor <actor>]` (env: `TASKPACK_HOME`, `TASKPACK_ACTOR`), built on the MCP TypeScript SDK v2 (`@modelcontextprotocol/server` 2.0.0, the stable line implementing the 2026-07-28 spec and serving 2025-era clients too).

- Tools: `list_projects`, `get_project` (context pack; `since` for changes only; answers it returns are marked `delivered`), `get_task` (also the answers to questions about that task, marked `delivered` too), `get_images`, `search` (projects, tasks, todos, notes, sessions, image captions and questions), `add_todo`, `toggle_todo`, `create_task`, `create_project`, `update_task`, `set_summary`, `log_session`, `attach_image`, `ask_user`. None of them deletes anything; `create_project` only adds `projects/<slug>/project.md`. Each has an input and output schema, structured content plus a short text, and annotations (`readOnlyHint`, `destructiveHint: false`, `idempotentHint`). Write tools take an optional `request_id`: a retry with the same id returns the first result.
- Tools switched off in `taskpack.yaml` (`tools:` globally, `clients[].tools` per actor) are hidden from that client and refused; `taskpack.yaml` is re-read on every call.
- Resources: `taskpack://{project}` (context pack), `taskpack://{project}/{task}` and `taskpack://{project}/images/{id}` (the agent JPEG of an image, `id` = file name in `images/`, plus its caption); the list shows active projects and tasks in progress.

### Images over MCP

- **`get_project`** attaches the pinned ("current") images, in pinned order, as MCP image content: `{ "type": "image", "data": "<base64>", "mimeType": "image/jpeg" }`. The picture is the agent variant (`.taskpack/agent/<sha256>.jpg`: longest side ≤ 1024 px, quality ≈ 78, aimed at ≤ 150 KB, EXIF and GPS removed, orientation applied). **`get_task`** does the same for the task's images, pinned first. `include_images: false` switches it off.
- **Budget** from `taskpack.yaml`: `pack.max_images` (default 5, at most 5) pictures and `pack.max_image_kb` (default 700) KB of base64 in total per result. An image that does not fit, or has no preview (PDF, HEIC without a decoder), comes as `{ "type": "resource_link", "uri": "taskpack://<p>/images/<file>", "name": "<file>", "title": …, "description": <caption>, "mimeType": "image/jpeg" }`; the agent can read that resource or call `get_images` with its id.
- **Captions always come as text:** before each image or link there is a line `[n/N] <title> — <caption> (taskpack://<p>/images/<file>)`, so clients that drop images still pass the facts to the model. The witrynka example (24 images, 5 pinned) stays under 1 MB and within the 2 500-token text budget (tested).
- **`get_images(project, all?, category?, ids?)`:** without `ids` metadata only (title, category, caption, pinned, tasks, `ref`, `created_by`), the pinned images by default, every image with `all`. With `ids` (file names or `taskpack://…/images/<file>`, at most 5) the pictures within the same byte budget.
- **`attach_image(project, title, category, caption?, pin?, task?, source)`** adds an image as the calling actor (`created_by` in `images.yaml`; the gallery shows "from Claude"). `source` is one of:
  - `{ data_base64, mime }`: at most 4 MB decoded; the bytes must match `mime`.
  - `{ url }`: downloaded by the server. https only; the host's every DNS address must be public (loopback, private, link-local, CGNAT, multicast, ULA and IPv4-mapped forms are refused) and the connection goes to the checked address; at most 3 redirects, each checked again; 10 MB; 10 s.
  - `{ svg }`: an SVG document (≤ 1 MB), stored as `.svg` and rasterized for previews.
  - `{ path }`: an absolute local file path, accepted only from local coding agents (`claude-code`, `codex`, `cursor`) on the stdio server. Chat apps (Claude Desktop/claude.ai, ChatGPT) must send bytes, a URL or SVG.

  Types: JPEG, PNG, WebP, GIF, SVG, HEIC, PDF (detected from the content, not the name), up to 25 MB. `pin: true` fails with a friendly message when 5 images are pinned already. The plan's `upload_id` flow is replaced by `{path}`.
- Prompts: `start_session(project)`, `wrap_up(project)`, in the workspace language.

### Questions (`ask_user`)

An agent asks with `ask_user` (or `taskpack question ask`); the question goes to `questions.md` with `status: open`. It shows in the app on the board's focus strip, in **Questions** (sidebar, with a count of open ones), on **Today** and on the task page. Answering (an option or free text) writes `### Answer` and sets `status: answered`. The next `get_project` / `get_task` of that project or task returns it under "User's answers to your questions" and sets `status: delivered`; the SessionStart dashboard lists answers not delivered yet.

## Undoing an agent session

Each agent session is one git commit of the workspace (trailer `Taskpack-Session`, see [format §6.1](common/dot-claude/skills/taskpack-workspace/reference/format.md#61-git-history-and-undoing-a-session)). To undo one:

- **App:** "Undo" on the session in the project timeline or in Notes. The dialog lists the files that will be restored; if there are uncommitted edits it offers to commit them first as "Manual changes". After the undo the session stays in the timeline, marked "undone". The button is disabled, with the reason, when the workspace is not a git repository or `git.autocommit` is `off`.
- **CLI:** `taskpack session undo <projects/p/sessions/file.md | p/sessions/file | p>` (a project alone = its latest agent session); `--dry-run` shows the commits and files, `--commit-pending` commits uncommitted edits first.

It is `git revert` into one new commit: nothing is deleted from history. A conflict with later changes aborts cleanly with the files named. Agents are told not to undo sessions themselves.

## Manual test checklist

Not automated (the tests use an in-process MCP client, the built stdio server and the hook commands with sample stdin; they do not drive the real apps):

1. `pnpm taskpack init --lang pl --example --home /tmp/g && cd /tmp/g && claude` → the session-start dashboard appears in the first answer's context (ask “co masz w kontekście z Taskpacka?”). Approve the `taskpack` MCP server.
2. “pracujemy nad taskpack://witrynka, dopisz 2 todo i zakończ sesję” → two todos with `by:claude-code` in `projects/witrynka/todos.md`, a new `sessions/<date>-claude-code.md`, one git commit (`git -C /tmp/g log -1`).
3. Ask Claude to delete `projects/witrynka/todos.md` → blocked by the guard. Ask it to write `status: W toku` into a task → the edit is rejected with the validation message and Claude fixes it.
4. Change a todo, then say “that's all” without wrapping up → Claude is asked once for `/taskpack-wrap`.
5. `/taskpack-start witrynka`, `/taskpack-status`, `/taskpack-add witrynka Kupić kołki`, `/taskpack-wrap` behave as described.
6. Claude Desktop: `pnpm taskpack mcp config claude-desktop --write --home /tmp/g`, restart, “pracujemy nad taskpack://witrynka, dopisz 2 todo i zakończ sesję” → todos with `by:claude`, a session note with `via: mcp`.
7. Claude Desktop with the folder `/tmp/g` attached (and the zips from `pnpm kit:build` uploaded) → same scenario through files; run `pnpm taskpack validate --home /tmp/g` afterwards.
8. Codex in `/tmp/g` → reads AGENTS.md, uses the CLI with `--actor codex`; with `taskpack mcp config codex --write`, the same through MCP.
9. Cursor with `taskpack mcp config cursor --write` → tools listed in Cursor's MCP settings; a todo gets `by:cursor`.
10. Move the workspace (`mv /tmp/g /tmp/g2`) and reopen Claude Code there: hooks and MCP still work. Rename the Taskpack repository folder: the next hook shows `Taskpack is not at … anymore` with the repair command; after `pnpm build && pnpm taskpack kit repair --home /tmp/g2` everything works again, including Claude Desktop.

11. Images: “taskpack://witrynka, co jest na przypiętym rysunku wymiarów?” in Claude Code and Claude Desktop → the answer describes the drawing (180 × 80 × 38, split in the middle), i.e. the client passed the image block to the model. Then “narysuj szkic zawiasu jako SVG i dodaj do galerii, przypnij” → with 5 current images the pin is refused with the limit message; after unpinning one, the sketch appears in the open gallery with “od Claude”.
12. Claude Code: “dodaj ~/Desktop/<photo>.jpg do witrynki jako postęp” → `attach_image` with `{path}` (or `taskpack image add`), the photo is in the gallery without EXIF in `.taskpack/agent/`.
13. `pnpm kit:mcpb`, then open `dist/taskpack.mcpb` in Claude Desktop, pick `/tmp/g` → the Taskpack extension is listed and enabled; “pracujemy nad taskpack://witrynka, dopisz todo i zakończ sesję” writes `by:claude`. In the app, "Cofnij" on that session restores the files.

## Not verified

- Whether **Claude Desktop with folder access (Cowork)** reads `.claude/skills` and `CLAUDE.md` from the attached folder. The zips from `pnpm kit:build` are the fallback.
- Whether the **ChatGPT desktop app** runs local stdio MCP servers. OpenAI's Codex MCP page says the desktop app shares the Codex configuration; I have not tried it. Folder access + `AGENTS.md` is the path we rely on.
- Whether **Cursor** reads `AGENTS.md` automatically in every mode (it is documented for rules; not tried here).
- The **skill upload format**: the help article shows the skill folder as the zip root and limits `name` to 64 and `description` to 200 characters; its example spells the file `skill.md`, while Claude Code and the Agent Skills spec use `SKILL.md`. The zips use `SKILL.md`. Not uploaded as part of this work.
- Whether claude.ai, Claude Desktop and ChatGPT **show MCP image content to the model** and how they treat `resource_link` (the MCP spec defines both; clients differ). Captions are always sent as text for that reason.
- **HEIC:** the prebuilt `sharp` 0.35 binaries decode HEIF only with the AV1 codec (AVIF), not HEVC, so HEIC photos are refused with a message asking for JPEG. A `sharp` built against a system libvips with libde265 would convert them; not tried.
- The `clientInfo.name` values real clients send (used to infer the actor when `TASKPACK_ACTOR` is not set). The generated configs always set `TASKPACK_ACTOR`, so inference is only a fallback.
- Claude Desktop on **Linux** (no official build): `taskpack mcp config claude-desktop` uses `~/.config/Claude/`.
- **Installing `dist/taskpack.mcpb` in Claude Desktop** was not tried here: the bundle passes `mcpb validate`, packs, and its server starts and answers `initialize` from the staged folder, but the install dialog, the folder picker and the Node.js version Claude Desktop runs it with were not checked. If Claude Desktop's built-in Node is older than 22, the extension will not start.
- The skill zips for the command skills (`taskpack-start`, `taskpack-add`, `taskpack-status`, `taskpack-wrap`) were not uploaded; outside Claude Code they are model-invoked skills.

## Po polsku

Taskpack trzyma projekty w plikach w folderze workspace'u (`~/Taskpack`). Agenci pracują na nim przez dostęp do folderu (`AGENTS.md`, `CLAUDE.md`, skille), przez lokalny serwer MCP `taskpack-mcp` albo przez CLI `taskpack`.

- **Start:** `pnpm install && pnpm build && pnpm taskpack init --lang pl --example`. `init` instaluje zestaw dla agentów; po aktualizacji Taskpacka: `pnpm taskpack kit update`; po przeniesieniu repo Taskpack albo workspace'u: `pnpm taskpack kit repair --home <workspace>` (launcher w workspace sam podpowie tę komendę).
- **Claude Code:** uruchom w folderze workspace'u (`cd ~/Taskpack && claude`), zatwierdź serwer MCP `taskpack`. Hooki pokazują dashboard na starcie, doklejają context pack dla `taskpack://…`, blokują zapisy do `.taskpack/` i usuwanie plików w `projects/`, walidują każdą edycję i raz przypominają o `/taskpack-wrap`. Komendy: `/taskpack-start`, `/taskpack-add`, `/taskpack-status`, `/taskpack-wrap`.
- **Claude Desktop:** najprościej rozszerzenie: `pnpm kit:mcpb`, potem dwuklik na `dist/taskpack.mcpb` i wybór folderu workspace'u (działa na platformie, na której je zbudowano). Albo ręcznie: `pnpm taskpack mcp config claude-desktop --write` (pokazuje diff, pyta, robi kopię), restart aplikacji. Przy dostępie do folderu wgraj też paczki skilli z `pnpm kit:build` (Customize → Skills).
- **Codex / ChatGPT desktop:** folder + `AGENTS.md`; MCP dla Codexa: `pnpm taskpack mcp config codex --write`.
- **Cursor:** folder + `AGENTS.md`; MCP: `pnpm taskpack mcp config cursor --write`.
- **Przeniesienie:** workspace możesz przenieść bez żadnych zmian w Claude Code. Konfiguracje Claude Desktop, Cursora i Codexa naprawia `pnpm taskpack kit repair --home <nowe miejsce>`. Po przeniesieniu repo Taskpack hooki pokażą błąd „Taskpack is not at … anymore” z gotową komendą: w nowym repo `pnpm build && pnpm taskpack kit repair --home <workspace>`. Node.js nie musi być w `PATH` (nvm, fnm, volta, asdf, aplikacja uruchomiona z Docka): skrypt `.claude/taskpack` sam szuka Node ≥ 22; w razie potrzeby ustaw `TASKPACK_NODE`. Szczegóły: sekcja [Moving Taskpack or your workspace](#moving-taskpack-or-your-workspace).
- **Obrazy:** `get_project` i `get_task` dołączają aktualne obrazy jako obrazki MCP (JPEG ≤ 1024 px, budżet z `taskpack.yaml: pack`: domyślnie 5 obrazów i 700 KB base64), resztę jako `resource_link`; podpisy zawsze idą tekstem. `attach_image` przyjmuje `{data_base64, mime}`, `{url}` (tylko https, bez adresów prywatnych), `{svg}` albo `{path}` (tylko lokalni agenci, np. Claude Code). Z CLI: `taskpack image add|pin|unpin|list|thumbs`.
- **Pytania:** agent pyta przez `ask_user`; odpowiadasz w aplikacji (widok Pytania, pasek „Teraz”, Dziś), odpowiedź wraca do agenta w następnym `get_project` / `get_task`.
- **Cofanie sesji:** przycisk „Cofnij” przy sesji w osi czasu projektu albo `taskpack session undo <notatka | projekt>`; to `git revert` w jednym nowym commicie, notatka sesji zostaje z polem `undone`.
- Wszystko, co agent zapisze, ma atrybucję (`by:claude-code`, `agent:` w notatce sesji). Treści agent pisze w języku workspace'u (`taskpack.yaml: lang`).
- Czego nie sprawdziłem: patrz sekcja „Not verified” wyżej (Cowork i `.claude/skills`, lokalne MCP w ChatGPT desktop, `AGENTS.md` w Cursorze, format uploadu skilli).
