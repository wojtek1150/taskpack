# Taskpack

**A local-first project and task manager that your AI agents can read and write.**

Your projects, tasks, todos, session notes and images live as plain Markdown/YAML files in one folder (`~/Taskpack`). You manage them in a small local web app; Claude Code, Claude Desktop, Codex / ChatGPT desktop and Cursor work on the very same files through a local MCP server, the `taskpack` CLI or direct folder access. Paste `taskpack://<project>` into a chat and the agent gets a compact context pack: the goal, what's done, the next step, decisions, the last sessions and the current images. When it's done, it writes back todos, progress and a session note, and every change is attributed and undoable.

**[Live demo →](https://wojtek1150.github.io/taskpack/)** runs in your browser with sample projects; press “Simulate Claude” to watch an agent session and undo it. Polish version: [README.pl.md](README.pl.md).

![Board](.github/screenshots/board.png)

<table>
  <tr>
    <td><img src=".github/screenshots/project.png" alt="Project page"></td>
    <td><img src=".github/screenshots/task.png" alt="Task with the agent rail"></td>
  </tr>
  <tr>
    <td><img src=".github/screenshots/gallery.png" alt="Gallery: current and all images"></td>
    <td><img src=".github/screenshots/palette.png" alt="Command palette"></td>
  </tr>
</table>

## Why

- **Your data stays yours.** Plain files on your disk, readable without Taskpack, versioned with git (one commit per agent session). No account, no cloud; the app listens on `127.0.0.1` only.
- **Agents pick up where you left off.** Each project carries its own context: a summary (now / blocker / next), tasks with steps, decisions, notes from previous sessions and up to five "current" images that are sent to the agent every time.
- **Works with the tools you already use.** Claude Code (skills, commands, hooks), Claude Desktop (MCP or a one-click extension), Codex / ChatGPT desktop and Cursor (`AGENTS.md` + MCP).
- **Nothing happens behind your back.** Every write records who made it (`by:claude-code`, `by:user`); an agent session can be undone with one click (`git revert` under the hood); agents cannot delete anything.
- **Polish and English**, for the UI, the files and the agent instructions.

## Features

- **Board:** Inbox / To do / In progress / Waiting, drag and drop, weight 1–5 (impact × urgency), due dates, progress, "new from agent" and "question" badges, and a focus strip with the next step and open questions.
- **Projects:** a page per project with an editable summary, todos, tasks, a timeline of notes and agent sessions (with "Undo"), and a gallery split into *Current* (pinned, sent to agents) and *All*.
- **Tasks:** description, steps with a "next" marker, notes and decisions, linked images, and a rail that shows exactly what the agent will receive.
- **Today, Notes, Questions:** deadlines and next steps across projects, a feed of every note and session, and questions agents asked you (answer them from the UI; the agent gets the answer next time).
- **⌘K palette:** search everything (diacritics folded, so `polka` finds `półka`) plus quick actions.
- **Live:** when an agent edits the workspace (MCP, CLI or files), the UI updates within a second and tells you who changed what.

## Quick start

Requires Node.js 22+ and pnpm (`corepack enable`).

```sh
git clone https://github.com/wojtek1150/taskpack.git && cd taskpack
pnpm install && pnpm build
pnpm taskpack init --lang en --example   # creates ~/Taskpack with sample projects and the agent kit
pnpm start                               # http://127.0.0.1:4242
```

`--lang pl` gives you a Polish workspace; drop `--example` to start empty. `TASKPACK_HOME=/path pnpm start` opens another workspace.

## With an agent

```sh
cd ~/Taskpack && claude                          # Claude Code: skills, /taskpack-* commands, hooks and MCP come with the workspace
pnpm taskpack mcp config claude-desktop --write  # Claude Desktop (also: cursor, codex); shows a diff and asks first
pnpm kit:mcpb                                    # or build a one-click Claude Desktop extension → dist/taskpack.mcpb
```

Then just talk: *"we're working on taskpack://<project>, figure out the next step, add the todos and wrap up"*. The agent reads the context, works with you, and writes back todos, task progress, a summary and a session note.

The CLI works for scripts and for any agent with a shell:

```sh
pnpm taskpack status                              # projects, next steps, open questions
pnpm taskpack pack taskpack://<project>           # the context an agent gets
pnpm taskpack --actor claude-code todo add <project> "Order the parts"
pnpm taskpack image add <project> ./sketch.jpg --category drawing --pin
```

`tpk` is a short alias. Full guide (every client, hooks, MCP tools, images, moving the workspace): [agent-kit/GUIDE.md](agent-kit/GUIDE.md). All CLI commands: [packages/cli/README.md](packages/cli/README.md).

## How it works

```
~/Taskpack/
├─ taskpack.yaml                 settings (language, context budget, enabled MCP tools)
├─ AGENTS.md  CLAUDE.md  .claude/  .mcp.json      the agent kit
├─ inbox.md  questions.md
└─ projects/<project>/
   ├─ project.md                 description + Summary (Now / Blocker / Next)
   ├─ todos.md                   a checklist
   ├─ tasks/<task>.md            status, weight, due date, steps, notes, decisions
   ├─ sessions/<date>-<agent>.md what each agent session did
   ├─ notes/
   └─ images/ + images.yaml      captions, categories, pins, task links
```

The format spec is installed into every workspace (`.claude/skills/taskpack-workspace/reference/format.md`). `@taskpack/core` edits these files in place without touching unrelated lines, so your own edits, and those of agents editing files directly, survive.

## Repository

```
apps/server      Express on 127.0.0.1:4242: REST API, live updates (SSE), serves the web app
apps/web         React 19 web app
packages/core    workspace format, validation, read/write operations, context packs, search, images
packages/cli     `taskpack` CLI (also the Claude Code hooks)
packages/mcp     `taskpack-mcp` local MCP server (stdio)
packages/api     types shared by the server and the web app
agent-kit/       instructions, skills, commands, subagents and hooks installed into workspaces
examples/        example workspaces (EN, PL)
e2e/             Playwright tests
```

```sh
pnpm dev         # API on :4242 + Vite on :5173
pnpm test        # Vitest
pnpm test:e2e    # Playwright (run `pnpm exec playwright install chromium` once)
pnpm lint        # Biome
pnpm build:demo  # the in-browser demo for GitHub Pages → apps/web/dist-demo (pnpm test:e2e:demo tests it)
pnpm typecheck
```

## License

[MIT](LICENSE) © 2026 Wojciech Parys
