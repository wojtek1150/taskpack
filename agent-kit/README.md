# agent-kit

The agent kit that `taskpack init` installs into a **workspace** (not into this repository): instructions, skills, subagents, hooks and MCP config that tell AI agents how to work with Taskpack. How to use it with each client: [GUIDE.md](GUIDE.md).

## Layout

```
agent-kit/
├─ VERSION                   kit version, printed in AGENTS.md
├─ en/  pl/                  language layer (same files in both; a test checks it)
│  ├─ AGENTS.md              generic instructions: Codex, ChatGPT desktop, Cursor, Claude…
│  └─ CLAUDE.md              `@AGENTS.md` + Claude Code specifics
└─ common/
   └─ dot-claude/            installed as `.claude/`
      ├─ taskpack              shim (POSIX sh, executable): finds Node.js ≥ 22, runs taskpack.mjs
      ├─ taskpack.mjs          workspace launcher: runs the Taskpack CLI (or MCP server with --mcp)
      ├─ settings.json       env (TASKPACK_ACTOR=claude-code) + hooks → `"$CLAUDE_PROJECT_DIR/.claude/taskpack" hook <name>`
      ├─ skills/
      │  ├─ taskpack-workspace/   format, statuses, weight rubric (+ reference/format.md, reference/examples.md)
      │  ├─ taskpack-session/     start and wrap-up ritual
      │  ├─ taskpack-capture/     conversation → todos/tasks, dedupe
      │  ├─ taskpack-images/      images.yaml: captions, categories, pin ≤ 5, task links
      │  └─ taskpack-start/ taskpack-wrap/ taskpack-status/ taskpack-add/   user commands (/taskpack-start …)
      └─ agents/
         ├─ taskpack-librarian.md  reads a project, returns a compact brief
         ├─ taskpack-scribe.md     collects the session's changes, writes the session note + summary
         └─ taskpack-planner.md    breaks a task into weighted, estimated steps
```

The source uses `dot-claude/` instead of `.claude/` so that Claude Code, when working on the Taskpack repository itself, does not load the kit's skills and settings. The repository's own `.claude/` is for developing Taskpack and is a different thing.

Skills are written in English with trigger phrases in Polish and English; they tell the agent to write workspace content in the workspace language (`taskpack.yaml: lang`). `AGENTS.md` and `CLAUDE.md` exist in both languages. Hook and validation messages are localized in `@taskpack/core` (`messages.ts`).

## What gets installed

`taskpack init` (and `taskpack kit update`) writes into the workspace:

| Path | Ownership |
|---|---|
| `AGENTS.md`, `CLAUDE.md` | Only the block between `<!-- taskpack-kit:begin … -->` and `<!-- taskpack-kit:end -->` is Taskpack's. Your own text above or below it is kept. A file you wrote before the kit existed is kept below the block. |
| `.claude/skills/taskpack-*`, `.claude/agents/taskpack-*` | Taskpack's. `.claude/taskpack-kit.json` records what was installed; if you edit one of these files, `kit update` keeps your version and reports it (`--force` overwrites). Put your own skills under other names. |
| `.claude/settings.json` | Merged. Taskpack owns its hook entries (commands ending in `hook session-start|prompt|guard|after-edit|stop`) and `env.TASKPACK_ACTOR` (an old `env.TASKPACK_HOME` is removed); your permissions, other hooks and settings stay. |
| `.mcp.json` | Merged. Taskpack owns `mcpServers.taskpack`; other servers stay. |

Templates use `{{TASKPACK}}` (`.claude/taskpack`, the workspace shim), `{{HOME}}` (workspace path) and `{{VERSION}}`.

## Moving Taskpack or the workspace

Nothing inside the workspace holds an absolute path. Hooks call `"${CLAUDE_PROJECT_DIR}/.claude/taskpack"`, `.mcp.json` calls `${CLAUDE_PROJECT_DIR:-.}/.claude/taskpack --mcp`, and AGENTS.md tells agents to run `.claude/taskpack` from the workspace.

- The shim finds Node.js ≥ 22 in this order: `$TASKPACK_NODE`, `node` on `PATH`, `node` recorded in `.claude/taskpack-kit.json`, then the nvm, volta, fnm, asdf, mise and Homebrew defaults. So it works without `node` on `PATH` (apps started from the Dock or Finder).
- It then runs the launcher `taskpack.mjs`. The launcher always acts on the workspace it sits in, and finds the repository through `repo` in the same manifest (or `$TASKPACK_REPO`). When that repository is gone, it prints the repair command.

`taskpack kit repair` = `kit update` (records the current `repo` and `node`) + rewriting existing Taskpack entries in the Claude Desktop, Cursor and Codex configs.

The user guide covers what breaks in each case, how you notice, what to run, the overrides and the requirements: [GUIDE.md → Moving Taskpack or your workspace](GUIDE.md#moving-taskpack-or-your-workspace).

## Updating

```sh
pnpm build
pnpm taskpack kit update              # uses TASKPACK_HOME / ~/Taskpack, or --home <dir>
pnpm taskpack kit update --force      # also overwrite kit files you edited
pnpm taskpack kit repair              # after moving Taskpack or the workspace (see above)
```

Run it after pulling a new Taskpack version, after moving the repository, or after `taskpack lang <pl|en>` (AGENTS.md and CLAUDE.md follow the workspace language).

## Skill packages for Claude Desktop / claude.ai

```sh
pnpm kit:build                      # → dist/skills/<skill>.zip, all 8 skills
pnpm kit:mcpb                       # → dist/taskpack.mcpb, the Claude Desktop extension (see GUIDE.md)
```

Upload the zips in Claude (Customize → Skills). Each zip has the skill folder as its root and only the frontmatter keys uploads accept (`name`, `description`; description ≤ 200 characters, checked by a test). The command skills (`taskpack-start`, `taskpack-add`, `taskpack-status`, `taskpack-wrap`) are zipped too: outside Claude Code they are ordinary skills chosen by their description, and their body starts with a note that `$ARGUMENTS` means what the user asked for.

## Editing the kit

- Keep `SKILL.md` under 500 lines; move details to `reference/`. Descriptions ≤ 200 characters (upload limit), with trigger phrases; more triggers go in `when_to_use` (Claude Code only, dropped from the zips).
- Quote YAML values that contain `: `.
- `common/dot-claude/skills/taskpack-workspace/reference/format.md` is the workspace format spec (the contract `@taskpack/core` validates against); it is installed into every workspace.
- Change `en/` and `pl/` together; bump `VERSION`.
